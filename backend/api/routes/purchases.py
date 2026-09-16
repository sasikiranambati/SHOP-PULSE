from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.purchase import (
    PurchaseCreate,
    PurchaseResponse,
    PaginatedPurchaseResponse,
)
from services import shop as shop_service
from services import purchase as purchase_service

router = APIRouter()

def get_user_shop_or_raise(db: Session, user: User):
    shop = shop_service.get_shop_by_owner(db, owner_id=user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must create a shop profile before logging stock purchases.",
        )
    return shop

@router.post("", response_model=PurchaseResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=PurchaseResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_purchase(
    *,
    db: Session = Depends(deps.get_db),
    purchase_in: PurchaseCreate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Log a new stock purchase, automatically increasing product inventory.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    try:
        return purchase_service.create_purchase(db, purchase_in=purchase_in, shop_id=user_shop.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.get("", response_model=PaginatedPurchaseResponse)
@router.get("/", response_model=PaginatedPurchaseResponse, include_in_schema=False)
def get_purchases(
    *,
    db: Session = Depends(deps.get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get paginated purchase history for the authenticated user's shop.
    """
    shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
    if not shop:
        return PaginatedPurchaseResponse(items=[], total=0, skip=skip, limit=limit)
    
    items, total = purchase_service.get_purchases_by_shop(
        db, shop_id=shop.id, skip=skip, limit=limit
    )
    return PaginatedPurchaseResponse(items=items, total=total, skip=skip, limit=limit)

@router.get("/{id}", response_model=PurchaseResponse)
def get_purchase(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get purchase details by ID, including item lines.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    purchase = purchase_service.get_purchase_by_id(db, purchase_id=id)
    if not purchase:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Purchase record not found.",
        )
    if purchase.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this purchase record.",
        )
    return purchase
