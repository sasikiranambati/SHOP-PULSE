from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.sale import (
    SaleCreate,
    SaleResponse,
    PaginatedSaleResponse,
)
from services import shop as shop_service
from services import sale as sale_service

router = APIRouter()

def get_user_shop_or_raise(db: Session, user: User):
    shop = shop_service.get_shop_by_owner(db, owner_id=user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must create a shop profile before recording sales.",
        )
    return shop

@router.post("", response_model=SaleResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=SaleResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_sale(
    *,
    db: Session = Depends(deps.get_db),
    sale_in: SaleCreate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Record a new customer sale, automatically calculating total amount and deducting product inventory.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    try:
        return sale_service.create_sale(db, sale_in=sale_in, shop_id=user_shop.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.get("", response_model=PaginatedSaleResponse)
@router.get("/", response_model=PaginatedSaleResponse, include_in_schema=False)
def get_sales(
    *,
    db: Session = Depends(deps.get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get paginated sales history for the authenticated user's shop.
    """
    shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
    if not shop:
        return PaginatedSaleResponse(items=[], total=0, skip=skip, limit=limit)
    
    items, total = sale_service.get_sales_by_shop(
        db, shop_id=shop.id, skip=skip, limit=limit
    )
    return PaginatedSaleResponse(items=items, total=total, skip=skip, limit=limit)

@router.get("/{id}", response_model=SaleResponse)
def get_sale(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get sale details by ID, including item lines.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    sale = sale_service.get_sale_by_id(db, sale_id=id)
    if not sale:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sale record not found.",
        )
    if sale.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this sale record.",
        )
    return sale
