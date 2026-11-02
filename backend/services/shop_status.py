from datetime import date, datetime, timezone
from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.shop_operating_status import ShopOperatingStatus
from schemas.shop_status import ShopOperatingStatusCreate, ShopOperatingStatusUpdate


def get_shop_status_by_date(
    db: Session,
    shop_id: UUID,
    operating_date: date
) -> Optional[ShopOperatingStatus]:
    """Retrieve operating status for a specific shop on a specific date."""
    return db.query(ShopOperatingStatus).filter(
        ShopOperatingStatus.shop_id == shop_id,
        ShopOperatingStatus.operating_date == operating_date
    ).first()


def record_or_upsert_shop_status(
    db: Session,
    shop_id: UUID,
    status_in: ShopOperatingStatusCreate
) -> Tuple[ShopOperatingStatus, bool]:
    """
    Records or updates a shop's operating status for a specific date.
    Returns (status_record, is_newly_created).
    Ensures idempotency and enforces the unique (shop_id, operating_date) constraint.
    """
    existing = get_shop_status_by_date(db, shop_id=shop_id, operating_date=status_in.operating_date)
    now_utc = datetime.now(timezone.utc)

    if existing:
        existing.is_open = status_in.is_open
        existing.opening_time = status_in.opening_time
        existing.closing_time = status_in.closing_time
        existing.closure_reason = status_in.closure_reason
        existing.notes = status_in.notes
        existing.updated_at = now_utc
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing, False

    db_status = ShopOperatingStatus(
        shop_id=shop_id,
        operating_date=status_in.operating_date,
        is_open=status_in.is_open,
        opening_time=status_in.opening_time,
        closing_time=status_in.closing_time,
        closure_reason=status_in.closure_reason,
        notes=status_in.notes,
        created_at=now_utc,
    )
    db.add(db_status)
    db.commit()
    db.refresh(db_status)
    return db_status, True


def update_shop_status(
    db: Session,
    db_status: ShopOperatingStatus,
    status_update: ShopOperatingStatusUpdate
) -> ShopOperatingStatus:
    """Updates fields on an existing ShopOperatingStatus record."""
    update_data = status_update.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(db_status, field, val)
    db_status.updated_at = datetime.now(timezone.utc)
    db.add(db_status)
    db.commit()
    db.refresh(db_status)
    return db_status


def get_shop_status_history(
    db: Session,
    shop_id: UUID,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 100
) -> Tuple[List[ShopOperatingStatus], int]:
    """Retrieve paginated operating calendar history scoped to the shop."""
    query = db.query(ShopOperatingStatus).filter(ShopOperatingStatus.shop_id == shop_id)
    if start_date:
        query = query.filter(ShopOperatingStatus.operating_date >= start_date)
    if end_date:
        query = query.filter(ShopOperatingStatus.operating_date <= end_date)

    total = query.count()
    items = query.order_by(ShopOperatingStatus.operating_date.desc()).offset(skip).limit(limit).all()
    return items, total
