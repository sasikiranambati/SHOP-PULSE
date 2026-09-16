from typing import Any, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.product import (
    ProductCreate,
    ProductUpdate,
    ProductResponse,
    PaginatedProductResponse,
)
from services import shop as shop_service
from services import product as product_service

router = APIRouter()

def get_user_shop_or_raise(db: Session, user: User):
    shop = shop_service.get_shop_by_owner(db, owner_id=user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must create a shop profile before managing products.",
        )
    return shop

@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ProductResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_product(
    *,
    db: Session = Depends(deps.get_db),
    product_in: ProductCreate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Create a new product for the authenticated user's shop.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    return product_service.create_product(db, product_in=product_in, shop_id=user_shop.id)

@router.get("", response_model=PaginatedProductResponse)
@router.get("/", response_model=PaginatedProductResponse, include_in_schema=False)
def get_products(
    *,
    db: Session = Depends(deps.get_db),
    search: Optional[str] = Query(None, description="Search by product name"),
    category: Optional[str] = Query(None, description="Filter by category"),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get paginated list of products for the authenticated user's shop with search and category filtering.
    """
    shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
    if not shop:
        return PaginatedProductResponse(items=[], total=0, skip=skip, limit=limit)
    
    items, total = product_service.get_products_by_shop(
        db, shop_id=shop.id, search=search, category=category, skip=skip, limit=limit
    )
    return PaginatedProductResponse(items=items, total=total, skip=skip, limit=limit)

@router.get("/low-stock", response_model=PaginatedProductResponse)
def get_low_stock_products(
    *,
    db: Session = Depends(deps.get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get products that need reordering (current_stock <= reorder_level) for the authenticated shop.
    """
    shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
    if not shop:
        return PaginatedProductResponse(items=[], total=0, skip=skip, limit=limit)
    
    items, total = product_service.get_low_stock_products_by_shop(
        db, shop_id=shop.id, skip=skip, limit=limit
    )
    return PaginatedProductResponse(items=items, total=total, skip=skip, limit=limit)

@router.get("/{id}", response_model=ProductResponse)
def get_product(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get product details by ID.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    product = product_service.get_product_by_id(db, product_id=id)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found.",
        )
    if product.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this product.",
        )
    return product

@router.put("/{id}", response_model=ProductResponse)
def update_product(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    product_in: ProductUpdate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Update product details by ID.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    product = product_service.get_product_by_id(db, product_id=id)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found.",
        )
    if product.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this product.",
        )
    return product_service.update_product(db, db_product=product, product_in=product_in)

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    current_user: User = Depends(deps.get_current_user)
) -> Response:
    """
    Delete a product by ID.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    product = product_service.get_product_by_id(db, product_id=id)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found.",
        )
    if product.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this product.",
        )
    product_service.delete_product(db, db_product=product)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
