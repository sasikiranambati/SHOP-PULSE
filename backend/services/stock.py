"""
Fractional stock quantities and atomic stock updates (Phase 4).

Quantities:
  * Stock is kept in the product's own unit. A quantity given in another unit is converted through the
    canonical unit registry when the units are compatible (250 g into a kg product -> 0.25 kg); an
    incompatible or unknown unit is refused, never added as a plain number and never treated as pcs.
  * kg, g, L and ml allow up to 3 decimals; every other unit (pcs, dozen, packages, quintal, tonne) is
    whole-number. Products stored before the registry with a free-text unit it does not know are handled
    conservatively: whole numbers only, no conversion.
  * Prices are always per stock unit; a conversion changes the quantity, never the rate.

Atomic updates:
  * Stock changes are single SQL statements (``current_stock = ROUND(current_stock +/- q, 3)``). A sale's
    statement only matches while ``current_stock >= q``, so concurrent requests can never overwrite each
    other's change or drive stock negative; zero affected rows means insufficient stock. The statement runs
    inside the caller's transaction, so a failure rolls back together with the sale / purchase records.
  * No schema change: on SQLite the existing INTEGER columns store fractional values exactly as written.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional, Sequence

from sqlalchemy import func, update
from sqlalchemy.orm import Session

from db.models.product import Product
from services.money import to_decimal
from services.unit_registry import (
    UNITS, InexactConversionError, IncompatibleUnitsError, ProductUnitConversion, QuantityValidationError, UnitError,
    clean_unit_text, convert_quantity, try_normalize_unit, validate_quantity_unit,
)


class StockError(ValueError):
    """A quantity or unit that cannot be applied to a product's stock (shown to the user as is)."""


class InsufficientStockError(StockError):
    pass


def format_quantity(value: Any) -> str:
    """2.5 -> '2.5', 5.0 -> '5', 0.125 -> '0.125' (no float noise)."""
    d = to_decimal(value)
    if d is None:
        return "0"
    d = d.quantize(Decimal("0.001")).normalize()
    return f"{d:f}"


def quantity_number(value: Any):
    """Stock / quantity for responses and messages: int when whole (5), else up to 3 decimals (2.5).

    Never truncates a fraction; also removes float noise from SQL sums (0.1 + 0.2 -> 0.3)."""
    d = to_decimal(value) or Decimal("0")
    d = d.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    return int(d) if d == d.to_integral_value() else float(d)


def validate_unit_text(unit: Optional[str], *, what: str = "Unit") -> str:
    """Canonical id of a registered unit; StockError for a missing or unknown unit."""
    if unit is None or not str(unit).strip():
        raise StockError(f"{what} is missing. Enter the unit (e.g. kg, g, L, ml, pcs, packet).")
    unit_id = try_normalize_unit(unit)
    if unit_id is None:
        raise StockError(f"{what} '{unit}' is not a registered unit. Correct it (e.g. kg, g, L, ml, pcs, packet).")
    return unit_id


def validate_stock_value(quantity: Any, unit: Optional[str], *, allow_zero: bool = True, label: str = "Stock") -> Decimal:
    """Validate a stock / reorder value for a product unit (fraction only for kg, g, L, ml)."""
    q = to_decimal(quantity)
    if q is None:
        raise StockError(f"{label} must be a number.")
    unit_id = try_normalize_unit(unit) if unit else None
    if unit_id is None:  # legacy free-text unit: whole numbers only
        if q < 0 or q != q.to_integral_value():
            raise StockError(f"{label} must be a whole number of 0 or more for unit '{unit}'.")
        return q
    try:
        return validate_quantity_unit(q, unit_id, allow_zero=allow_zero)
    except QuantityValidationError as exc:
        raise StockError(f"{label}: {exc}") from None


def to_stock_quantity(quantity: Any, given_unit: Optional[str], product: Product,
                      product_conversions: Optional[Sequence[ProductUnitConversion]] = None) -> Decimal:
    """Quantity in the product's stock unit, validated (> 0, fraction rules, at most 3 decimals).

    ``given_unit`` None means the quantity is already in the product's unit. ``product_conversions``
    are explicit conversions printed for this line (e.g. 1 bag = 25 kg from the invoice's pack size);
    without one, package units never convert to another family.
    """
    q = to_decimal(quantity)
    if q is None or q <= 0:
        raise StockError(f"Quantity for '{product.name}' must be greater than 0.")
    product_unit_id = try_normalize_unit(product.unit) if product.unit else None
    if product_unit_id is None:
        # Product stored with a unit the registry does not know: no conversion, whole numbers only
        if given_unit and clean_unit_text(given_unit) != clean_unit_text(product.unit):
            raise StockError(
                f"'{product.name}' is stocked in '{product.unit}', which is not a registered unit, so "
                f"'{given_unit}' cannot be converted to it. Update the product's unit first.")
        if q != q.to_integral_value():
            raise StockError(f"'{product.name}' is counted in whole {product.unit or 'units'}; {format_quantity(q)} is not allowed.")
        return q
    source_id = validate_unit_text(given_unit, what=f"Unit for '{product.name}'") if given_unit else product_unit_id
    try:
        converted = convert_quantity(q, source_id, product_unit_id, product_conversions=product_conversions)
        return validate_quantity_unit(converted, product_unit_id)
    except IncompatibleUnitsError as exc:
        raise StockError(f"'{product.name}' is stocked in {UNITS[product_unit_id].label}: {exc}") from None
    except (QuantityValidationError, InexactConversionError) as exc:
        raise StockError(f"'{product.name}': {exc}") from None
    except UnitError as exc:
        raise StockError(str(exc)) from None


def _round3(expr):
    return func.round(expr, 3)


def add_stock(db: Session, product: Product, quantity: Decimal) -> None:
    """Atomically increase stock by ``quantity`` (product unit)."""
    stmt = (update(Product)
            .where(Product.id == product.id)
            .values(current_stock=_round3(func.coalesce(Product.current_stock, 0) + float(quantity)))
            .execution_options(synchronize_session=False))
    if db.execute(stmt).rowcount != 1:
        raise StockError(f"Stock for '{product.name}' could not be updated.")
    db.expire(product, ["current_stock"])


def remove_stock(db: Session, product: Product, quantity: Decimal) -> None:
    """Atomically decrease stock by ``quantity`` (product unit) only while enough stock is available."""
    q = float(quantity)
    stmt = (update(Product)
            .where(Product.id == product.id, Product.current_stock >= q)
            .values(current_stock=_round3(Product.current_stock - q))
            .execution_options(synchronize_session=False))
    if db.execute(stmt).rowcount != 1:
        db.expire(product, ["current_stock"])
        available = format_quantity(db.query(Product.current_stock).filter(Product.id == product.id).scalar())
        raise InsufficientStockError(
            f"Insufficient stock for product '{product.name}'. Available: {available}, "
            f"requested: {format_quantity(quantity)}")
    db.expire(product, ["current_stock"])
