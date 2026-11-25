"""
Invoice line -> physical quantity -> cost per standard unit, through the EXISTING unit registry and
universal pricing engine. This module holds no pricing arithmetic of its own: it turns the values
printed on an invoice line into the inputs the engine already understands.

Example (2 bags of Basmati Rice, 25 kg per bag, Rs 2,350 per bag, line Rs 4,700):
    purchase quantity = 2 bag                 (as printed)
    pack size         = 25 kg per bag         (as printed; never assumed)
    conversion        = ProductUnitConversion(bag -> kg, 25)       (unit registry)
    physical quantity = convert_quantity(2, bag, kg, [conversion]) = 50 kg
    cost              = calculate_purchase_cost(2 bag at 2350 per 1 bag) -> line cost 4700.00
    per standard unit = calculate_purchase_cost(..., basis 25 kg) -> Rs 94.000 per kg

Rules:
- A pack size is only used when it was extracted (a printed value); it is never inferred.
- Only mass and volume pack sizes give a physical quantity (kg / L are the standard units).
- A package unit (bag, packet, jar, ...) converts through an explicit ProductUnitConversion; a count
  unit (pcs, nos) cannot by registry rule, so its physical quantity is shown but stock stays in pieces.
- Purchase cost, selling price and MRP are separate: only the purchase rate is used here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, List, Optional

from services.money import to_decimal
from services.pricing_engine import PricingEngineError, calculate_purchase_cost
from services.unit_registry import (
    FAMILIES,
    UNITS,
    ProductUnitConversion,
    UnitError,
    convert_quantity,
    try_normalize_unit,
)

# Display / costing unit per measure family: rice is costed per kg, oil per L
STANDARD_UNIT = {"mass": "kg", "volume": "L"}
# Tolerance when checking which quantity the printed rate refers to (paise rounding on the invoice)
RATE_BASIS_TOLERANCE = Decimal("1.00")


@dataclass
class PackCosting:
    purchase_quantity: Optional[Decimal]
    purchase_unit: Optional[str]            # canonical unit id
    pack_size: Optional[Decimal] = None     # content of ONE purchase unit, e.g. 25
    pack_unit: Optional[str] = None         # canonical unit id of the pack size, e.g. 'kg'
    physical_quantity: Optional[Decimal] = None   # in standard_unit, e.g. 50
    standard_unit: Optional[str] = None           # 'kg' / 'L' (or the purchase unit without a pack)
    cost_per_standard_unit: Optional[Decimal] = None
    line_cost: Optional[Decimal] = None           # engine line cost (quantity x rate), before tax/discount
    rate_basis_unit: Optional[str] = None         # unit the printed rate is quoted per (usually purchase unit)
    # PACK_CONVERTED: package unit with a measure pack (stock can be kept in kg/L)
    # COUNT_ONLY: count unit with a measure pack (physical quantity informational; stock stays in pieces)
    # NONE: no usable pack size
    conversion_status: str = "NONE"
    conversions: List[ProductUnitConversion] = field(default_factory=list)
    issues: List[str] = field(default_factory=list)
    needs_review: bool = False


def _measure_family(unit_id: Optional[str]) -> Optional[str]:
    if not unit_id:
        return None
    fam = FAMILIES[UNITS[unit_id].family]
    return fam.id if fam.kind == "measure" else None


def _kind(unit_id: str) -> str:
    return FAMILIES[UNITS[unit_id].family].kind


def pack_conversions(purchase_unit: Any, pack_size: Any, pack_unit: Any) -> List[ProductUnitConversion]:
    """The explicit conversion '1 <package unit> = <pack size> <pack unit>' when it is valid, else []."""
    unit_id = try_normalize_unit(purchase_unit) if purchase_unit else None
    pack_id = try_normalize_unit(pack_unit) if pack_unit else None
    size = to_decimal(pack_size)
    if not unit_id or not pack_id or size is None or size <= 0:
        return []
    if _kind(unit_id) != "package" or not _measure_family(pack_id):
        return []
    try:
        return [ProductUnitConversion.create(unit_id, pack_id, size)]
    except UnitError:
        return []


def cost_invoice_line(
    quantity: Any,
    unit: Any,
    rate: Any,
    pack_size: Any = None,
    pack_unit: Any = None,
    line_amount: Any = None,
    discount: Any = None,
    tax: Any = None,
    product_name: Optional[str] = None,
) -> PackCosting:
    """Physical quantity and cost per standard unit of one invoice line (see module docstring)."""
    q = to_decimal(quantity)
    unit_id = try_normalize_unit(unit) if unit else None
    r = to_decimal(rate)
    result = PackCosting(purchase_quantity=q, purchase_unit=unit_id)
    if q is None or q <= 0 or unit_id is None or r is None or r < 0:
        return result  # nothing reliable to cost; the line is already flagged for its missing values

    size = to_decimal(pack_size)
    pack_id = try_normalize_unit(pack_unit) if pack_unit else None
    family = _measure_family(pack_id)
    name = product_name or "Product"

    try:
        if size is None or size <= 0 or not family:
            # No usable pack size: cost per purchase unit (kg / L lines are already physical)
            fam = _measure_family(unit_id)
            std = STANDARD_UNIT[fam] if fam else unit_id
            res = calculate_purchase_cost(q, unit_id, r, 1, unit_id, product_name=name)
            per_std = calculate_purchase_cost(q, unit_id, r, convert_quantity(1, unit_id, std), std,
                                              product_name=name).unit_cost if fam else res.unit_cost
            result.physical_quantity = convert_quantity(q, unit_id, std) if fam else q
            result.standard_unit = std
            result.cost_per_standard_unit = per_std
            result.line_cost = res.line_cost
            result.rate_basis_unit = unit_id
            return result

        std = STANDARD_UNIT[family]
        result.pack_size, result.pack_unit, result.standard_unit = size, pack_id, std
        pack_in_std = convert_quantity(size, pack_id, std)  # 500 g -> 0.5 kg (exact)

        if _kind(unit_id) == "package":
            conv = pack_conversions(unit_id, size, pack_id)
            result.conversions = conv
            result.conversion_status = "PACK_CONVERTED"
            physical = convert_quantity(q, unit_id, std, product_conversions=conv)
        elif _kind(unit_id) == "count":
            # pcs / nos never convert across families in the registry: shown, not used for stock
            conv = []
            result.conversion_status = "COUNT_ONLY"
            physical = convert_quantity(q, unit_id, "pcs") * pack_in_std
        else:
            # A measure unit with a pack size ('2 kg' of '1 kg packs'): the quantity is already physical
            result.physical_quantity = convert_quantity(q, unit_id, std)
            res = calculate_purchase_cost(q, unit_id, r, 1, unit_id, product_name=name)
            result.line_cost, result.rate_basis_unit = res.line_cost, unit_id
            result.cost_per_standard_unit = calculate_purchase_cost(
                q, unit_id, r, convert_quantity(1, unit_id, std), std, product_name=name).unit_cost
            return result
        result.physical_quantity = physical

        # Which quantity does the printed rate refer to? Per purchase unit (usual) or per kg / L
        amt = to_decimal(line_amount)
        pre_tax = None
        if amt is not None:
            pre_tax = amt + (to_decimal(discount) or Decimal("0")) - (to_decimal(tax) or Decimal("0"))
        per_unit_fits = pre_tax is not None and abs(q * r - pre_tax) <= RATE_BASIS_TOLERANCE
        per_measure_fits = pre_tax is not None and abs(physical * r - pre_tax) <= RATE_BASIS_TOLERANCE
        if per_measure_fits and not per_unit_fits:
            # e.g. 2 bag x 25 kg at Rs 47 = Rs 2,350: the rate is per kg
            result.rate_basis_unit = std
            res = calculate_purchase_cost(physical, std, r, 1, std, product_name=name)
            result.cost_per_standard_unit = res.unit_cost
            result.line_cost = res.line_cost
            result.issues.append(
                f"The rate {r.normalize():f} matches a price per {UNITS[std].label} "
                f"({physical.normalize():f} {std} x {r.normalize():f} = line amount), not per {UNITS[unit_id].label}. "
                "Please confirm.")
            result.needs_review = True
            return result

        result.rate_basis_unit = unit_id
        # Rate per 1 purchase unit -> line cost; rate per pack content -> cost per standard unit
        res = calculate_purchase_cost(q, unit_id, r, 1, unit_id, product_conversions=conv or None, product_name=name)
        result.line_cost = res.line_cost
        result.cost_per_standard_unit = calculate_purchase_cost(
            pack_in_std, std, r, pack_in_std, std, product_name=name).unit_cost
        if result.conversion_status == "COUNT_ONLY":
            result.issues.append(
                f"Each {UNITS[unit_id].label} holds {size.normalize():f} {pack_id}; stock is counted in "
                f"{UNITS[unit_id].label} (a count unit cannot be converted to {std}).")
        return result
    except (PricingEngineError, UnitError) as exc:
        result.issues.append(f"Cost per unit could not be worked out: {exc}")
        result.needs_review = True
        return result
