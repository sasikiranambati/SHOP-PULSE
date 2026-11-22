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
    SaleQuoteResponse,
)
from services import shop as shop_service
from services import sale as sale_service

router = APIRouter()

def get_user_shop_or_raise(db: Session, user: User):
    shop = deps.get_user_accessible_shop(db, user)
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
        return sale_service.create_sale(db, sale_in=sale_in, shop_id=user_shop.id, acting_user_id=current_user.id)
    except sale_service.SalePriceAuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.post("/quote", response_model=SaleQuoteResponse)
def quote_sale(
    *,
    db: Session = Depends(deps.get_db),
    sale_in: SaleCreate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Price a cart exactly as checkout would (pricing engine, status, units, MRP, stock, price approval),
    without recording a sale or changing stock. The sale itself is validated again when it is sent.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    return sale_service.quote_sale(db, sale_in=sale_in, shop_id=user_shop.id, acting_user_id=current_user.id)


@router.get("", response_model=PaginatedSaleResponse)
@router.get("/", response_model=PaginatedSaleResponse, include_in_schema=False)
def get_sales(
    *,
    db: Session = Depends(deps.get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=500),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get paginated sales history for the authenticated user's shop.
    """
    # Owner or staff member of the shop
    shop = deps.get_user_accessible_shop(db, current_user)
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
