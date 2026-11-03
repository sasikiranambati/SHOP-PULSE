from typing import Any, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.forecast import ForecastSummaryResponse
from services import shop as shop_service
from services import forecast as forecast_service

router = APIRouter()


def get_user_shop_or_raise(db: Session, user: User):
    shop = shop_service.get_shop_by_owner(db, owner_id=user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must create a shop profile before accessing demand forecasting.",
        )
    return shop


@router.get("", response_model=ForecastSummaryResponse)
@router.get("/", response_model=ForecastSummaryResponse, include_in_schema=False)
def get_forecast(
    *,
    db: Session = Depends(deps.get_db),
    product_id: Optional[UUID] = Query(None, description="Optional product ID filter"),
    standardized_category: Optional[str] = Query(None, description="Optional canonical category filter"),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Generate statistical demand forecasts and inventory intelligence for the authenticated shop.
    Computes multi-stage demand (Insufficient History, Moving Average 7, Weekday Seasonal),
    days until stockout, stockout risk tiers, and explainable replenishment guidance.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    return forecast_service.generate_shop_forecast(
        db=db,
        shop_id=user_shop.id,
        product_id=product_id,
        standardized_category=standardized_category,
    )
