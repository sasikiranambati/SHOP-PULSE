from typing import Any, Optional, List
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
    ProductLookupResponse,
    ProductVerifyRequest,
)
from schemas.pricing_audit import PricingAuditLogResponse
from db.models.shop_member import ShopRole
from services import shop_member as shop_member_service
from services import pricing_audit as pricing_audit_service
from services import shop as shop_service
from services import product as product_service
from services import product_lookup as product_lookup_service

router = APIRouter()

def get_user_shop_or_raise(db: Session, user: User):
    shop = deps.get_user_accessible_shop(db, user)
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
    try:
        return product_service.create_product(
            db,
            product_in=product_in,
            shop_id=user_shop.id,
            acting_user_id=current_user.id,
        )
    except ValueError as e:  # unit / stock validation (e.g. 2.5 pcs, unknown unit)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

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
    # Owner or staff member of the shop (cashiers sell from this catalogue)
    shop = deps.get_user_accessible_shop(db, current_user)
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
    # Owner or staff member of the shop (cashiers sell from this catalogue)
    shop = deps.get_user_accessible_shop(db, current_user)
    if not shop:
        return PaginatedProductResponse(items=[], total=0, skip=skip, limit=limit)
    
    items, total = product_service.get_low_stock_products_by_shop(
        db, shop_id=shop.id, skip=skip, limit=limit
    )
    return PaginatedProductResponse(items=items, total=total, skip=skip, limit=limit)

@router.get("/lookup", response_model=ProductLookupResponse)
def lookup_product(
    *,
    db: Session = Depends(deps.get_db),
    barcode: Optional[str] = Query(None, description="Product barcode or SKU"),
    name: Optional[str] = Query(None, description="Product name"),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Look up product information, purchase rates, selling prices, and MRP.
    Checks shop inventory first, followed by external catalog integration if configured.
    Never exposes API keys or internal credentials to the client.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    return product_lookup_service.lookup_product(
        db=db,
        shop_id=user_shop.id,
        barcode=barcode,
        name=name
    )

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
    if not product or not product.is_active:
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
    if not product or not product.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found.",
        )
    if product.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this product.",
        )
    try:
        return product_service.update_product(
            db,
            db_product=product,
            product_in=product_in,
            acting_user_id=current_user.id,
        )
    except PermissionError as e:  # verified pricing changed by a role without that authority
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:  # unit / stock validation
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

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
    if not product or not product.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found.",
        )
    if product.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this product.",
        )
    # Deactivating a product removes it from sale and from the catalogue: a catalogue-management
    # operation reserved for Managers and Owners (cashiers keep selling, stock and product details)
    member = shop_member_service.get_shop_member(db, shop_id=product.shop_id, user_id=current_user.id)
    if not member or member.role not in (ShopRole.OWNER.value, ShopRole.MANAGER.value):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Managers and Owners can deactivate products.",
        )
    product_service.delete_product(db, db_product=product)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{id}/verify", response_model=ProductResponse)
def verify_product(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    verify_in: Optional[ProductVerifyRequest] = None,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Verify product pricing metadata. Strictly restricted to Manager or Owner roles.
    """
    product = product_service.get_product_by_id(db, product_id=id)
    if not product or not product.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found.",
        )

    # Check shop membership and authorization
    member = shop_member_service.get_shop_member(db, shop_id=product.shop_id, user_id=current_user.id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access products of this shop.",
        )
    if member.role not in [ShopRole.OWNER.value, ShopRole.MANAGER.value]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Managers and Owners are authorized to verify product pricing.",
        )

    try:
        reason = verify_in.reason if verify_in else None
        return product_service.verify_product(db, product=product, acting_user_id=current_user.id, reason=reason)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))


@router.get("/{id}/audit-trail", response_model=List[PricingAuditLogResponse])
def get_product_audit_trail(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Get audit trail for a product. Strictly restricted to Managers and Owners.
    """
    product = product_service.get_product_by_id(db, product_id=id)
    if not product or not product.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found.",
        )

    member = shop_member_service.get_shop_member(db, shop_id=product.shop_id, user_id=current_user.id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access products of this shop.",
        )
    if member.role not in [ShopRole.OWNER.value, ShopRole.MANAGER.value]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Managers and Owners are authorized to review pricing audit history.",
        )

    return pricing_audit_service.get_product_audit_logs(db, shop_id=product.shop_id, product_id=product.id)

