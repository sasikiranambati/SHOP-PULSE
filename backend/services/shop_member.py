from typing import Optional, List
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.shop import Shop
from db.models.user import User
from db.models.shop_member import ShopMember, ShopRole
from schemas.shop_member import ShopMemberCreate, ShopMemberUpdate


def get_shop_member(db: Session, shop_id: UUID, user_id: UUID) -> Optional[ShopMember]:
    """The user's active membership in the shop, for authorization decisions. Read-only.

    The shop's recorded owner (Shop.owner_id) always has OWNER authority. For shops created before
    memberships existed there may be no stored row: an unsaved OWNER membership is returned instead of
    writing one here, so a lookup never commits (or flushes) in the middle of the caller's transaction
    (e.g. an invoice confirmation that already holds a new supplier). ensure_owner_membership() stores it.
    """
    member = db.query(ShopMember).filter(
        ShopMember.shop_id == shop_id,
        ShopMember.user_id == user_id,
        ShopMember.is_active.is_(True)
    ).first()
    if member:
        return member

    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if shop and shop.owner_id == user_id:
        return ShopMember(shop_id=shop_id, user_id=user_id, role=ShopRole.OWNER.value, is_active=True)
    return None


def ensure_owner_membership(db: Session, shop: Shop) -> None:
    """Store the owner's OWNER membership for a legacy shop that has none (or reactivate it).

    Called only where a stored row is needed (listing members), as its own small transaction."""
    existing = db.query(ShopMember).filter(ShopMember.shop_id == shop.id, ShopMember.user_id == shop.owner_id).first()
    if existing and existing.is_active and existing.role == ShopRole.OWNER.value:
        return
    if existing:
        existing.role = ShopRole.OWNER.value
        existing.is_active = True
    else:
        db.add(ShopMember(shop_id=shop.id, user_id=shop.owner_id, role=ShopRole.OWNER.value, is_active=True))
    try:
        db.commit()
    except Exception:
        db.rollback()  # created concurrently (uq_shop_user_membership): the row exists either way


def list_shop_members(db: Session, shop_id: UUID) -> List[ShopMember]:
    # Ensure shop owner is bootstrapped in members
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if shop and shop.owner_id:
        ensure_owner_membership(db, shop)

    return db.query(ShopMember).filter(
        ShopMember.shop_id == shop_id,
        ShopMember.is_active.is_(True)
    ).all()


def add_shop_member(
    db: Session,
    shop_id: UUID,
    acting_user_id: UUID,
    member_in: ShopMemberCreate
) -> ShopMember:
    acting_member = get_shop_member(db, shop_id, acting_user_id)
    if not acting_member or acting_member.role != ShopRole.OWNER.value:
        raise PermissionError("Only the shop owner can add or invite staff members.")

    requested_role = member_in.role.strip().upper()
    if requested_role not in [ShopRole.MANAGER.value, ShopRole.CASHIER.value]:
        raise ValueError("Staff role must be either MANAGER or CASHIER.")

    # Locate user by user_id or email
    target_user = None
    if member_in.user_id:
        target_user = db.query(User).filter(User.id == member_in.user_id).first()
    elif member_in.email:
        target_user = db.query(User).filter(User.email == member_in.email.strip().lower()).first()

    if not target_user:
        raise ValueError("Target user not found. User must register before being added to a shop.")

    if target_user.id == acting_user_id:
        raise ValueError("Shop owner already holds the highest authority and cannot change own role.")

    existing_membership = db.query(ShopMember).filter(
        ShopMember.shop_id == shop_id,
        ShopMember.user_id == target_user.id
    ).first()

    if existing_membership:
        existing_membership.role = requested_role
        existing_membership.is_active = True
        db.add(existing_membership)
        db.commit()
        db.refresh(existing_membership)
        return existing_membership

    new_membership = ShopMember(
        shop_id=shop_id,
        user_id=target_user.id,
        role=requested_role,
        is_active=True
    )
    db.add(new_membership)
    db.commit()
    db.refresh(new_membership)
    return new_membership


def update_shop_member(
    db: Session,
    shop_id: UUID,
    member_id: UUID,
    acting_user_id: UUID,
    member_in: ShopMemberUpdate
) -> ShopMember:
    acting_member = get_shop_member(db, shop_id, acting_user_id)
    if not acting_member or acting_member.role != ShopRole.OWNER.value:
        raise PermissionError("Only the shop owner can modify staff roles.")

    target = db.query(ShopMember).filter(
        ShopMember.id == member_id,
        ShopMember.shop_id == shop_id
    ).first()

    if not target:
        raise ValueError("Shop membership record not found.")

    if target.role == ShopRole.OWNER.value:
        raise ValueError("Cannot modify or demote shop owner.")

    if member_in.role is not None:
        new_role = member_in.role.strip().upper()
        if new_role not in [ShopRole.MANAGER.value, ShopRole.CASHIER.value]:
            raise ValueError("Role must be MANAGER or CASHIER.")
        target.role = new_role

    if member_in.is_active is not None:
        target.is_active = member_in.is_active

    db.add(target)
    db.commit()
    db.refresh(target)
    return target
