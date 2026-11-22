from typing import Any, List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from db.models.shop_member import ShopRole
from schemas.shop import ShopCreate, ShopUpdate, ShopResponse
from schemas.shop_member import MyMembershipResponse, ShopMemberCreate, ShopMemberUpdate, ShopMemberResponse
from services import shop as shop_service
from services import shop_member as shop_member_service

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

@router.get("/me/membership", response_model=MyMembershipResponse)
def get_my_membership(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    The signed-in user's role in the shop they own or work in (OWNER, MANAGER or CASHIER). Read-only.
    """
    shop = deps.get_user_accessible_shop(db, current_user)
    member = shop_member_service.get_shop_member(db, shop_id=shop.id, user_id=current_user.id) if shop else None
    if not shop or not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No shop membership for the current user.")
    elevated = member.role in (ShopRole.OWNER.value, ShopRole.MANAGER.value)
    return MyMembershipResponse(
        shop_id=shop.id, shop_name=shop.shop_name, role=member.role,
        can_verify_pricing=elevated, can_approve_price_overrides=elevated, can_deactivate_products=elevated,
    )


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


@router.get("/{id}/members", response_model=List[ShopMemberResponse])
def get_shop_members(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    List staff members of the shop. Accessible by Owner and Manager.
    """
    shop = shop_service.get_shop_by_id(db, shop_id=id)
    if not shop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found.")

    member = shop_member_service.get_shop_member(db, shop_id=id, user_id=current_user.id)
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this shop.")
    if member.role not in [ShopRole.OWNER.value, ShopRole.MANAGER.value]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Managers and Owners can view staff members.")

    members = shop_member_service.list_shop_members(db, shop_id=id)
    res = []
    for m in members:
        u_email = m.user.email if m.user else None
        res.append(ShopMemberResponse(
            id=m.id,
            shop_id=m.shop_id,
            user_id=m.user_id,
            user_email=u_email,
            role=m.role,
            is_active=m.is_active,
            created_at=m.created_at,
            updated_at=m.updated_at,
        ))
    return res


@router.post("/{id}/members", response_model=ShopMemberResponse, status_code=status.HTTP_201_CREATED)
def add_shop_member(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    member_in: ShopMemberCreate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Add or assign a staff member to the shop. Strictly restricted to the Shop Owner.
    """
    shop = shop_service.get_shop_by_id(db, shop_id=id)
    if not shop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found.")

    member = shop_member_service.get_shop_member(db, shop_id=id, user_id=current_user.id)
    if not member or member.role != ShopRole.OWNER.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the shop owner can add or invite staff members."
        )

    try:
        new_m = shop_member_service.add_shop_member(
            db=db,
            shop_id=id,
            acting_user_id=current_user.id,
            member_in=member_in,
        )
        u_email = new_m.user.email if new_m.user else None
        return ShopMemberResponse(
            id=new_m.id,
            shop_id=new_m.shop_id,
            user_id=new_m.user_id,
            user_email=u_email,
            role=new_m.role,
            is_active=new_m.is_active,
            created_at=new_m.created_at,
            updated_at=new_m.updated_at,
        )
    except (PermissionError, ValueError) as e:
        if isinstance(e, PermissionError):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.put("/{id}/members/{member_id}", response_model=ShopMemberResponse)
def update_shop_member(
    *,
    db: Session = Depends(deps.get_db),
    id: UUID,
    member_id: UUID,
    member_in: ShopMemberUpdate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Update a staff member's role or status. Strictly restricted to the Shop Owner.
    """
    shop = shop_service.get_shop_by_id(db, shop_id=id)
    if not shop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found.")

    member = shop_member_service.get_shop_member(db, shop_id=id, user_id=current_user.id)
    if not member or member.role != ShopRole.OWNER.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the shop owner can update staff roles."
        )

    try:
        updated_m = shop_member_service.update_shop_member(
            db=db,
            shop_id=id,
            member_id=member_id,
            acting_user_id=current_user.id,
            member_in=member_in,
        )
        u_email = updated_m.user.email if updated_m.user else None
        return ShopMemberResponse(
            id=updated_m.id,
            shop_id=updated_m.shop_id,
            user_id=updated_m.user_id,
            user_email=u_email,
            role=updated_m.role,
            is_active=updated_m.is_active,
            created_at=updated_m.created_at,
            updated_at=updated_m.updated_at,
        )
    except (PermissionError, ValueError) as e:
        if isinstance(e, PermissionError):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

