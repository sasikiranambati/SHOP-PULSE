from datetime import datetime, timezone
from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.stockout_event import StockoutEvent
from db.models.product import Product


def record_stockout_event_if_depleted(
    db: Session,
    shop_id: UUID,
    product: Product,
    reason: str = "DEPLETED_BY_SALE"
) -> Optional[StockoutEvent]:
    """
    Checks if a product's current stock has depleted to <= 0.
    If so, sets last_stockout_at on the product and logs an active StockoutEvent
    if one is not already open.
    """
    if product.current_stock <= 0:
        now_utc = datetime.now(timezone.utc)
        if product.last_stockout_at is None:
            product.last_stockout_at = now_utc
            db.add(product)

        # Check if an active stockout event already exists
        existing_active = db.query(StockoutEvent).filter(
            StockoutEvent.shop_id == shop_id,
            StockoutEvent.product_id == product.id,
            StockoutEvent.ended_at.is_(None)
        ).first()

        if not existing_active:
            event = StockoutEvent(
                shop_id=shop_id,
                product_id=product.id,
                started_at=now_utc,
                reason=reason
            )
            db.add(event)
            return event
    return None


def resolve_active_stockout_events_if_restocked(
    db: Session,
    shop_id: UUID,
    product: Product
) -> int:
    """
    Checks if a product has restocked to > 0.
    If so, clears last_stockout_at and closes any open StockoutEvents.
    Returns the number of resolved events.
    """
    if product.current_stock > 0:
        product.last_stockout_at = None
        db.add(product)

        active_events = db.query(StockoutEvent).filter(
            StockoutEvent.shop_id == shop_id,
            StockoutEvent.product_id == product.id,
            StockoutEvent.ended_at.is_(None)
        ).all()

        now_utc = datetime.now(timezone.utc)
        for ev in active_events:
            ev.ended_at = now_utc
            db.add(ev)

        return len(active_events)
    return 0


def get_stockout_events_by_shop(
    db: Session,
    shop_id: UUID,
    product_id: Optional[UUID] = None,
    active_only: bool = False,
    skip: int = 0,
    limit: int = 50
) -> Tuple[List[StockoutEvent], int]:
    """Retrieves paginated stockout events scoped to the authenticated shop."""
    query = db.query(StockoutEvent).filter(StockoutEvent.shop_id == shop_id)
    if product_id:
        query = query.filter(StockoutEvent.product_id == product_id)
    if active_only:
        query = query.filter(StockoutEvent.ended_at.is_(None))

    total = query.count()
    items = query.order_by(StockoutEvent.started_at.desc()).offset(skip).limit(limit).all()
    return items, total
