from typing import Any, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.shop_status import (
    ShopOperatingStatusCreate,
    ShopOperatingStatusUpdate,
    ShopOperatingStatusResponse,
    PaginatedShopOperatingStatusResponse,
)
from services import shop as shop_service
from services import shop_status as shop_status_service

router = APIRouter()


def get_user_shop_or_raise(db: Session, user: User):
    shop = shop_service.get_shop_by_owner(db, owner_id=user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must create a shop profile before managing shop operating status.",
        )
    return shop


@router.post("", response_model=ShopOperatingStatusResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ShopOperatingStatusResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def record_shop_status(
    *,
    db: Session = Depends(deps.get_db),
    status_in: ShopOperatingStatusCreate,
    response: Response,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Record or idempotently update the operating status for a shop on a given date.
    Returns 201 if created, 200 if updated/already exists.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    record, is_new = shop_status_service.record_or_upsert_shop_status(
        db, shop_id=user_shop.id, status_in=status_in
    )
    if not is_new:
        response.status_code = status.HTTP_200_OK
    return record


@router.get("/date/{operating_date}", response_model=ShopOperatingStatusResponse)
def get_shop_status_for_date(
    *,
    db: Session = Depends(deps.get_db),
    operating_date: date,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Retrieve operating status of the authenticated shop for a specific date.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    record = shop_status_service.get_shop_status_by_date(
        db, shop_id=user_shop.id, operating_date=operating_date
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Operating status for date {operating_date} not found.",
        )
    return record


@router.put("/date/{operating_date}", response_model=ShopOperatingStatusResponse)
def update_shop_status_for_date(
    *,
    db: Session = Depends(deps.get_db),
    operating_date: date,
    status_update: ShopOperatingStatusUpdate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Update an existing operating status record for a specific date.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    existing = shop_status_service.get_shop_status_by_date(
        db, shop_id=user_shop.id, operating_date=operating_date
    )
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Operating status for date {operating_date} does not exist. Use POST to record status.",
        )
    return shop_status_service.update_shop_status(db, db_status=existing, status_update=status_update)


@router.get("", response_model=PaginatedShopOperatingStatusResponse)
@router.get("/", response_model=PaginatedShopOperatingStatusResponse, include_in_schema=False)
def get_shop_status_history(
    *,
    db: Session = Depends(deps.get_db),
    start_date: Optional[date] = Query(None, description="Start date filter (inclusive)"),
    end_date: Optional[date] = Query(None, description="End date filter (inclusive)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=365),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Retrieve operating status calendar history for the authenticated shop across an optional date range.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    items, total = shop_status_service.get_shop_status_history(
        db, shop_id=user_shop.id, start_date=start_date, end_date=end_date, skip=skip, limit=limit
    )
    return PaginatedShopOperatingStatusResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )
