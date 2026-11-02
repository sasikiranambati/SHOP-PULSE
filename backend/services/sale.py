from datetime import datetime, timezone
from typing import Optional, List, Tuple, Dict, Any
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.sale import Sale
from db.models.sale_item import SaleItem
from db.models.product import Product
from db.models.shop_operating_status import ShopOperatingStatus
from schemas.sale import SaleCreate
from services.shop_status import get_shop_status_by_date
from services.stockout import (
    record_stockout_event_if_depleted,
    resolve_active_stockout_events_if_restocked,
)

DISCRETE_UNITS = {"pcs", "pkts", "packets", "bottles", "packs", "trays", "boxes", "bags", "bars", "pkt"}
LARGE_QUANTITY_THRESHOLD = 500


def create_sale(db: Session, sale_in: SaleCreate, shop_id: UUID) -> Sale:
    """
    Records a customer sale with:
      - Closed-day conflict prevention.
      - Cart line merging for repeated product IDs.
      - Unit and bulk quantity validation.
      - Atomic inventory deduction.
      - Stockout event generation on depletion.
      - Server-side UTC timestamps.
      - Reliable cost_price_at_sale recording.
    """
    try:
        now_utc = datetime.now(timezone.utc)
        # Shop-local operating date: explicit from sale_in, or local calendar date
        operating_date = sale_in.operating_date or datetime.now().date()

        # 1. Closed-day conflict check: check operating_date and fallback to now_utc.date() if different
        status_rec = get_shop_status_by_date(db, shop_id=shop_id, operating_date=operating_date)
        if not status_rec and operating_date != now_utc.date():
            status_rec = get_shop_status_by_date(db, shop_id=shop_id, operating_date=now_utc.date())

        if status_rec and not status_rec.is_open:
            raise ValueError(
                "Cannot record sale: shop is explicitly marked as closed for today. "
                "Please update shop status before recording sales."
            )
        if not status_rec:
            # Implicitly record that shop is open today via completed checkout
            implicit_status = ShopOperatingStatus(
                shop_id=shop_id,
                operating_date=operating_date,
                is_open=True,
                notes="Implicitly recorded open via POS checkout",
                created_at=now_utc,
            )
            db.add(implicit_status)

        # 2. Merge repeated product IDs in cart
        merged_items: Dict[UUID, Dict[str, Any]] = {}
        for item in sale_in.items:
            if item.quantity <= 0:
                raise ValueError("Quantity must be greater than zero.")
            
            pid = item.product_id
            if pid not in merged_items:
                merged_items[pid] = {
                    "product_id": pid,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "confirmed_large_quantity": item.confirmed_large_quantity or sale_in.confirmed_large_quantity,
                }
            else:
                merged_items[pid]["quantity"] += item.quantity
                if item.unit_price is not None:
                    merged_items[pid]["unit_price"] = item.unit_price
                if item.confirmed_large_quantity:
                    merged_items[pid]["confirmed_large_quantity"] = True

        # 3. Validate products, stock, and unit constraints
        validated_lines = []
        total_amount = 0.0

        for pid, line in merged_items.items():
            product = db.query(Product).filter(Product.id == pid).first()
            if not product or product.shop_id != shop_id:
                raise ValueError(f"Product {pid} not found or does not belong to your shop.")

            qty = line["quantity"]

            # Validate unit granularity
            p_unit = (product.unit or "pcs").lower()
            if p_unit in DISCRETE_UNITS and not float(qty).is_integer():
                raise ValueError(
                    f"Product '{product.name}' is measured in '{product.unit}' and requires a whole-number quantity."
                )

            # Check for unusually large quantity confirmation
            if qty > LARGE_QUANTITY_THRESHOLD and not line["confirmed_large_quantity"]:
                raise ValueError(
                    f"Unusually large quantity ({qty}) for '{product.name}'. Explicit confirmation required."
                )

            if product.current_stock < qty:
                raise ValueError(
                    f"Insufficient stock for product '{product.name}'. "
                    f"Available: {product.current_stock}, requested: {qty}"
                )

            unit_price = line["unit_price"] if line["unit_price"] is not None else product.selling_price
            item_total = round(qty * unit_price, 2)
            total_amount += item_total

            # Populate cost price if reliable
            cost_price = product.purchase_price if (product.purchase_price and product.purchase_price > 0) else None

            validated_lines.append((product, qty, unit_price, cost_price))

        # 4. Create Sale Header
        db_sale = Sale(
            shop_id=shop_id,
            total_amount=round(total_amount, 2),
            payment_method=sale_in.payment_method,
            status="COMPLETED",
            created_at=now_utc,
        )
        db.add(db_sale)
        db.flush()  # Obtain db_sale.id

        # 5. Create Sale Items, Deduct Inventory, and Trigger Stockout Events
        for product, qty, unit_price, cost_price in validated_lines:
            sale_qty = int(qty) if float(qty).is_integer() else qty
            db_item = SaleItem(
                sale_id=db_sale.id,
                product_id=product.id,
                quantity=sale_qty,
                unit_price=unit_price,
                cost_price_at_sale=cost_price,
                created_at=now_utc,
            )
            db.add(db_item)

            # Deduct inventory
            product.current_stock -= sale_qty
            if product.current_stock <= 0:
                record_stockout_event_if_depleted(
                    db, shop_id=shop_id, product=product, reason="DEPLETED_BY_SALE"
                )
            db.add(product)

        db.commit()
        db.refresh(db_sale)
        return db_sale

    except Exception as e:
        db.rollback()
        raise e


def get_sale_by_id(db: Session, sale_id: UUID) -> Optional[Sale]:
    return db.query(Sale).filter(Sale.id == sale_id).first()


def get_sales_by_shop(
    db: Session,
    shop_id: UUID,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 10
) -> Tuple[List[Sale], int]:
    query = db.query(Sale).filter(Sale.shop_id == shop_id)
    if status:
        query = query.filter(Sale.status == status)

    total = query.count()
    items = query.order_by(Sale.created_at.desc()).offset(skip).limit(limit).all()
    return items, total


def cancel_sale(
    db: Session,
    sale_id: UUID,
    shop_id: UUID,
    reason: str
) -> Sale:
    """
    Cancels a completed sale (e.g. checkout mistake, aborted payment).
    - Preserves transaction and item records.
    - Atomically restores inventory to products.
    - Closes active stockout events if stock becomes positive.
    - Idempotent: safe to call repeatedly.
    - Requires shop ownership.
    """
    sale = get_sale_by_id(db, sale_id=sale_id)
    if not sale:
        raise ValueError("Sale record not found.")
    if sale.shop_id != shop_id:
        raise PermissionError("Not authorized to cancel this sale record.")

    # Idempotent: already cancelled
    if sale.status == "CANCELLED":
        return sale

    if sale.status == "REFUNDED":
        raise ValueError("Cannot cancel a sale that has already been refunded.")

    # Atomically restore inventory
    for item in sale.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if product:
            product.current_stock += item.quantity
            resolve_active_stockout_events_if_restocked(db, shop_id=shop_id, product=product)
            db.add(product)

    sale.status = "CANCELLED"
    sale.cancelled_at = datetime.now(timezone.utc)
    sale.cancellation_reason = reason
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


def refund_sale(
    db: Session,
    sale_id: UUID,
    shop_id: UUID,
    reason: str,
    restock_items: bool = True
) -> Sale:
    """
    Refunds a completed sale (e.g. customer return after checkout).
    - Preserves transaction and item records.
    - Optionally restores inventory (restock_items=True; False if goods are damaged/perishable).
    - Idempotent: safe to call repeatedly.
    - Requires shop ownership.
    """
    sale = get_sale_by_id(db, sale_id=sale_id)
    if not sale:
        raise ValueError("Sale record not found.")
    if sale.shop_id != shop_id:
        raise PermissionError("Not authorized to refund this sale record.")

    # Idempotent: already refunded
    if sale.status == "REFUNDED":
        return sale

    if sale.status == "CANCELLED":
        raise ValueError("Cannot refund a sale that has already been cancelled.")

    if restock_items:
        for item in sale.items:
            product = db.query(Product).filter(Product.id == item.product_id).first()
            if product:
                product.current_stock += item.quantity
                resolve_active_stockout_events_if_restocked(db, shop_id=shop_id, product=product)
                db.add(product)

    sale.status = "REFUNDED"
    sale.cancelled_at = datetime.now(timezone.utc)
    formatted_reason = f"REFUND: {reason}" if not reason.startswith("REFUND:") else reason
    sale.cancellation_reason = formatted_reason
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale
