import logging
from decimal import Decimal
from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.sale import Sale
from db.models.sale_item import SaleItem
from db.models.product import Product
from schemas.sale import SaleCreate
from services.money import bill_total, round_currency, to_decimal, to_number
from services.pricing_engine import (
    IncompatiblePricingUnitsError,
    InvalidQuantityError,
    MrpExceededError,
    PriceAssertionError,
    PricingStatusError,
    calculate_line_price,
)
from services.pricing_audit import create_pricing_audit_log
from services.shop_member import ShopRole, get_shop_member
from services.stock import format_quantity, remove_stock, InsufficientStockError, StockError
from services.unit_registry import UnitError

# Same tolerance as the engine's client price assertion
PRICE_MATCH_TOLERANCE = Decimal("0.01")


class SalePriceAuthorizationError(PermissionError):
    """A requested (e.g. spoken) price differs from the catalogue and the user may not approve it."""


def _requested_line(item, product, pricing_result, shop_id, acting_user_id, db):
    """Resolve a customer-requested line price (Voice-to-Bill spoken price).

    Returns (line_total, override) where override is None when the request matches the catalogue line
    (normal checkout) or a dict describing an authorized override. Never applies a different price
    silently: a mismatch needs a Manager / Owner, must be above zero and must not exceed the line MRP."""
    requested = round_currency(to_decimal(item.requested_line_total))
    catalogue = pricing_result.line_total
    if abs(requested - catalogue) <= PRICE_MATCH_TOLERANCE:
        return catalogue, None
    label = f"'{product.name}'"
    if acting_user_id is None:
        raise SalePriceAuthorizationError(
            f"Manager approval required: requested ₹{requested} for {label} differs from the catalogue price ₹{catalogue}.")
    member = get_shop_member(db, shop_id, acting_user_id)
    if not member or member.role not in (ShopRole.OWNER.value, ShopRole.MANAGER.value):
        raise SalePriceAuthorizationError(
            f"Manager approval required: requested ₹{requested} for {label} differs from the catalogue price "
            f"₹{catalogue}. Ask a Manager or Owner to complete this sale, or use the catalogue price.")
    if requested <= 0:
        raise ValueError(f"Requested price for {label} must be greater than zero.")
    if pricing_result.line_mrp_total is not None and requested > pricing_result.line_mrp_total:
        raise MrpExceededError(
            f"Requested price ₹{requested} for {label} exceeds the statutory MRP ₹{pricing_result.line_mrp_total} for this quantity.")
    return requested, {"requested": requested, "catalogue": catalogue}


def _evaluate_line(db: Session, item, shop_id: UUID, acting_user_id: Optional[UUID]):
    """Server-authoritative evaluation of one sale line, shared by checkout and the cart quote.

    Returns (product, pricing_result, line_total, override); raises the same errors checkout reports
    (unknown / inactive product, pricing status, units, MRP, stock, price approval)."""
    product = db.query(Product).filter(Product.id == item.product_id).first()
    if not product:
        raise ValueError(f"Product {item.product_id} not found.")
    if product.shop_id != shop_id:
        raise ValueError(f"Product '{product.name}' does not belong to your shop.")
    if not product.is_active:
        raise ValueError(f"Product '{product.name}' is inactive and cannot be sold.")

    # Resolve pricing basis and units from catalog
    req_unit = item.unit if item.unit and str(item.unit).strip() else product.unit
    basis_qty = product.price_basis_quantity if product.price_basis_quantity is not None else Decimal("1.0")
    basis_unit = product.price_basis_unit if product.price_basis_unit else product.unit
    status = product.pricing_status

    # Server-authoritative calculation via Pricing Engine (with statutory MRP ceiling check)
    pricing_result = calculate_line_price(
        quantity=item.quantity,
        requested_unit=req_unit,
        selling_price=product.selling_price,
        price_basis_quantity=basis_qty,
        price_basis_unit=basis_unit,
        inventory_unit=product.unit,
        product_conversions=None,
        # A requested line price is judged below (match / authorized override), not as an assertion
        client_unit_price=item.unit_price if item.requested_line_total is None else None,
        pricing_status=status,
        product_name=product.name,
        mrp=product.mrp,
        mrp_basis_quantity=getattr(product, "mrp_basis_quantity", None),
        mrp_basis_unit=getattr(product, "mrp_basis_unit", None),
    )

    # Friendly pre-check of stock availability (atomic update enforces it during write)
    stock_qty_float = float(pricing_result.stock_deduction_quantity)
    if (product.current_stock or 0) < stock_qty_float:
        raise InsufficientStockError(
            f"Insufficient stock for product '{product.name}'. "
            f"Available: {format_quantity(product.current_stock)}, "
            f"requested: {format_quantity(pricing_result.stock_deduction_quantity)}"
        )

    line_total, override = pricing_result.line_total, None
    if item.requested_line_total is not None:
        line_total, override = _requested_line(item, product, pricing_result, shop_id, acting_user_id, db)
    return product, pricing_result, line_total, override


def _error_code(exc: Exception) -> str:
    if isinstance(exc, SalePriceAuthorizationError):
        return "approval_required"
    if isinstance(exc, MrpExceededError):
        return "mrp_exceeded"
    if isinstance(exc, PricingStatusError):
        return "pricing_status"
    if isinstance(exc, InsufficientStockError):
        return "insufficient_stock"
    if isinstance(exc, PriceAssertionError):
        return "price_mismatch"
    if isinstance(exc, (IncompatiblePricingUnitsError, InvalidQuantityError, StockError, UnitError)):
        return "unit"
    if "not found" in str(exc) or "does not belong" in str(exc):
        return "not_found"
    return "invalid"


def quote_sale(db: Session, sale_in: SaleCreate, shop_id: UUID, acting_user_id: Optional[UUID] = None) -> dict:
    """Price the cart exactly as checkout would, line by line, without recording anything.

    Uses the same evaluation as create_sale (pricing engine, status, units, MRP, stock, approval rules), so
    the cart shows the server's totals and reasons; checkout re-validates everything when the sale is sent."""
    member = get_shop_member(db, shop_id, acting_user_id) if acting_user_id else None
    role = member.role if member else None
    can_approve = role in (ShopRole.OWNER.value, ShopRole.MANAGER.value)
    lines, totals = [], []
    for index, item in enumerate(sale_in.items):
        entry = {"index": index, "product_id": item.product_id, "ok": False}
        try:
            # Catalogue evaluation first (status, units, MRP, stock): the line's figures are always known
            base_item = item.model_copy(update={"requested_line_total": None})
            product, result, line_total, _ = _evaluate_line(db, base_item, shop_id, acting_user_id)
            entry.update(
                catalogue_line_total=to_number(result.line_total), line_total=to_number(line_total),
                effective_unit_price=to_number(result.effective_unit_price),
                pricing_basis_quantity=float(result.pricing_basis_quantity), pricing_basis_unit=result.pricing_basis_unit,
                requested_quantity=float(result.requested_quantity), requested_unit=result.requested_unit,
                stock_deduction_quantity=float(result.stock_deduction_quantity), inventory_unit=result.inventory_unit,
                line_mrp_total=to_number(result.line_mrp_total) if result.line_mrp_total is not None else None,
                pricing_status=product.pricing_status,
            )
            if item.requested_line_total is not None:
                requested = round_currency(to_decimal(item.requested_line_total))
                entry["requires_approval"] = abs(requested - result.line_total) > PRICE_MATCH_TOLERANCE
                line_total, _ = _requested_line(item, product, result, shop_id, acting_user_id, db)
                entry["line_total"] = to_number(line_total)
            entry["ok"] = True
            totals.append(to_decimal(entry["line_total"]))
        except (ValueError, PermissionError) as exc:
            entry["code"] = _error_code(exc)
            entry["message"] = str(exc)
            if entry.get("pricing_status") is None:
                found = db.query(Product).filter(Product.id == item.product_id, Product.shop_id == shop_id).first()
                entry["pricing_status"] = found.pricing_status if found else None
        lines.append(entry)
    return {
        "lines": lines,
        "total": to_number(bill_total(totals)),
        "all_ok": all(line["ok"] for line in lines),
        "requires_approval": any(line.get("requires_approval") for line in lines),
        "role": role,
        "can_approve_price_overrides": can_approve,
    }


def create_sale(db: Session, sale_in: SaleCreate, shop_id: UUID, acting_user_id: Optional[UUID] = None) -> Sale:
    try:
        validated_items = []
        line_amounts = []

        # ---------------------------------------------------------------------
        # Phase 1: Pre-validation & Server-Authoritative Pricing Calculation
        # ---------------------------------------------------------------------
        for item in sale_in.items:
            product, pricing_result, line_total, override = _evaluate_line(db, item, shop_id, acting_user_id)
            line_amounts.append(line_total)
            validated_items.append((product, pricing_result, line_total, override))

        # ---------------------------------------------------------------------
        # Phase 2: Create Sale Header
        # ---------------------------------------------------------------------
        total_amt = bill_total(line_amounts)
        db_sale = Sale(
            shop_id=shop_id,
            total_amount=to_number(total_amt),
            payment_method=sale_in.payment_method,
        )
        db.add(db_sale)
        db.flush()  # Obtain db_sale.id

        # ---------------------------------------------------------------------
        # Phase 3: Create Sale Items & Deduct Inventory Atomically
        # ---------------------------------------------------------------------
        for product, result, line_total, override in validated_items:
            # Price per single basis unit, as for catalogue lines; for an override it reproduces the agreed line
            unit_price = result.effective_unit_price if override is None else line_total / result.normalized_quantity
            db_item = SaleItem(
                sale_id=db_sale.id,
                product_id=product.id,
                quantity=float(result.stock_deduction_quantity),
                unit_price=to_number(unit_price) if override is None else float(unit_price),
            )
            db.add(db_item)
            if override is not None:
                # Immutable audit record in the same transaction as the sale
                create_pricing_audit_log(
                    db=db,
                    shop_id=shop_id,
                    acting_user_id=acting_user_id,
                    action_type="SALE_PRICE_OVERRIDE",
                    product_id=product.id,
                    previous_status=product.pricing_status,
                    new_status=product.pricing_status,
                    previous_selling_price=to_number(result.effective_unit_price),
                    new_selling_price=float(unit_price),
                    previous_mrp=product.mrp,
                    new_mrp=product.mrp,
                    reason=(f"Sale {str(db_sale.id)[:8]}: requested ₹{override['requested']} instead of catalogue "
                            f"₹{override['catalogue']} for {format_quantity(result.requested_quantity)} "
                            f"{result.requested_unit} (customer-requested price)")[:255],
                )

            # Atomic conditional stock deduction:
            # UPDATE products SET current_stock = ROUND(current_stock - q, 3) WHERE id = :id AND current_stock >= q
            # Concurrent sales cannot oversell; rowcount != 1 raises InsufficientStockError
            remove_stock(db, product, result.stock_deduction_quantity)

        # ---------------------------------------------------------------------
        # Phase 4: Commit Entire Transaction Once
        # ---------------------------------------------------------------------
        db.commit()
        db.refresh(db_sale)

        # Trigger inventory alerts for products dropping below thresholds
        try:
            from datetime import datetime, timezone
            from db.models.shop import Shop
            from services.notification import create_notification
            from schemas.notification import NotificationCreate

            shop = db.query(Shop).filter(Shop.id == shop_id).first()
            if shop and shop.owner_id:
                today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                for product, *_ in validated_items:
                    reorder = product.reorder_level or 0
                    if product.current_stock <= 0:
                        create_notification(
                            db,
                            NotificationCreate(
                                user_id=shop.owner_id,
                                shop_id=shop_id,
                                title=f"Out of Stock: {product.name}",
                                message=f"{product.name} is out of stock (0 {product.unit or 'units'} remaining).",
                                category="inventory",
                                priority="critical",
                                product_id=product.id,
                                transaction_id=db_sale.id,
                                deep_link=f"/inventory?id={product.id}",
                                event_key=f"out_of_stock:{product.id}:{today_str}"
                            ),
                            cooldown_hours=12
                        )
                    elif product.reorder_level and product.current_stock <= reorder:
                        create_notification(
                            db,
                            NotificationCreate(
                                user_id=shop.owner_id,
                                shop_id=shop_id,
                                title=f"Low Stock Alert: {product.name}",
                                message=f"{product.name} dropped to {format_quantity(product.current_stock)} {product.unit or 'units'} (threshold: {format_quantity(reorder)} {product.unit or 'units'}).",
                                category="inventory",
                                priority="high",
                                product_id=product.id,
                                transaction_id=db_sale.id,
                                deep_link=f"/inventory?id={product.id}",
                                event_key=f"low_stock:{product.id}:{today_str}"
                            ),
                            cooldown_hours=12
                        )
        except Exception:
            # The sale is already committed; a failed alert must not fail the request or leave the
            # session unusable for building the response
            logging.getLogger(__name__).warning("Post-sale notification failed", exc_info=True)
            db.rollback()

        return db_sale

    except Exception as e:
        db.rollback()
        raise e

def get_sale_by_id(db: Session, sale_id: UUID) -> Optional[Sale]:
    return db.query(Sale).filter(Sale.id == sale_id).first()

def get_sales_by_shop(
    db: Session,
    shop_id: UUID,
    skip: int = 0,
    limit: int = 10
) -> Tuple[List[Sale], int]:
    query = db.query(Sale).filter(Sale.shop_id == shop_id)
    total = query.count()
    items = query.order_by(Sale.created_at.desc()).offset(skip).limit(limit).all()
    return items, total
