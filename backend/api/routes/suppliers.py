from typing import Any, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.supplier import (
    SupplierCreate,
    SupplierUpdate,
    SupplierResponse,
    PaginatedSupplierResponse,
)
from services import shop as shop_service
from services import supplier as supplier_service

router = APIRouter()

def get_user_shop_or_raise(db: Session, user: User):
    shop = shop_service.get_shop_by_owner(db, owner_id=user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must create a shop profile before managing suppliers.",
        )
    return shop

@router.post("", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_supplier(
    *,
    db: Session = Depends(deps.get_db),
    supplier_in: SupplierCreate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Create a new supplier for the authenticated user's shop.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    return supplier_service.create_supplier(db, supplier_in=supplier_in, shop_id=user_shop.id)

@router.get("", response_model=PaginatedSupplierResponse)
@router.get("/", response_model=PaginatedSupplierResponse, include_in_schema=False)
def get_suppliers(
    *,
    db: Session = Depends(deps.get_db),
    search: Optional[str] = Query(None, description="Search by supplier name"),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get paginated list of suppliers for the authenticated user's shop.
    """
    shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
    if not shop:
        return PaginatedSupplierResponse(items=[], total=0, skip=skip, limit=limit)
    
    items, total = supplier_service.get_suppliers_by_shop(
        db, shop_id=shop.id, search=search, skip=skip, limit=limit
    )
    return PaginatedSupplierResponse(items=items, total=total, skip=skip, limit=limit)

@router.get("/{id}", response_model=SupplierResponse)
def get_supplier(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get supplier details by ID.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    supplier = supplier_service.get_supplier_by_id(db, supplier_id=id)
    if not supplier:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier not found.",
        )
    if supplier.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this supplier.",
        )
    return supplier

@router.put("/{id}", response_model=SupplierResponse)
def update_supplier(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    supplier_in: SupplierUpdate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Update supplier details by ID.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    supplier = supplier_service.get_supplier_by_id(db, supplier_id=id)
    if not supplier:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier not found.",
        )
    if supplier.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this supplier.",
        )
    return supplier_service.update_supplier(db, db_supplier=supplier, supplier_in=supplier_in)

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    current_user: User = Depends(deps.get_current_user)
) -> Response:
    """
    Delete a supplier by ID.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    supplier = supplier_service.get_supplier_by_id(db, supplier_id=id)
    if not supplier:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier not found.",
        )
    if supplier.shop_id != user_shop.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this supplier.",
        )
    supplier_service.delete_supplier(db, db_supplier=supplier)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
