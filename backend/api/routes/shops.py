from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.shop import ShopCreate, ShopUpdate, ShopResponse
from services import shop as shop_service

router = APIRouter()

@router.post("", response_model=ShopResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ShopResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_shop(
    *,
    db: Session = Depends(deps.get_db),
    shop_in: ShopCreate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Create a new shop profile for the authenticated user.
    Each user can own only one shop.
    """
    existing_shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
    if existing_shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already has a shop profile.",
        )
    
    return shop_service.create_shop(db, shop_in=shop_in, owner_id=current_user.id)

@router.get("/me", response_model=ShopResponse)
def get_my_shop(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Get the authenticated user's shop profile.
    """
    shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shop profile not found for current user.",
        )
    return shop

@router.put("/{id}", response_model=ShopResponse)
def update_shop(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    shop_in: ShopUpdate,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Update a shop profile by ID. Only the authenticated owner can update their shop.
    """
    shop = shop_service.get_shop_by_id(db, shop_id=id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shop not found.",
        )
    
    if shop.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this shop.",
        )
    
    return shop_service.update_shop(db, db_shop=shop, shop_in=shop_in)
