from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.dashboard import DashboardResponse
from services import shop as shop_service
from services import dashboard as dashboard_service

router = APIRouter()

@router.get("", response_model=DashboardResponse)
@router.get("/", response_model=DashboardResponse, include_in_schema=False)
def get_dashboard(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Fetch comprehensive dashboard information for the authenticated shop owner.
    Single endpoint optimized for mobile devices.
    """
    shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must create a shop profile before accessing dashboard.",
        )
    return dashboard_service.get_dashboard_data(db, shop_id=shop.id)
