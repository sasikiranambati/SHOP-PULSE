from typing import Optional
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.shop import Shop
from schemas.shop import ShopCreate, ShopUpdate

def get_shop_by_owner(db: Session, owner_id: UUID) -> Optional[Shop]:
    return db.query(Shop).filter(Shop.owner_id == owner_id).first()

def get_shop_by_id(db: Session, shop_id: UUID) -> Optional[Shop]:
    return db.query(Shop).filter(Shop.id == shop_id).first()

def create_shop(db: Session, shop_in: ShopCreate, owner_id: UUID) -> Shop:
    db_shop = Shop(
        shop_name=shop_in.shop_name,
        owner_name=shop_in.owner_name,
        business_type=shop_in.business_type.value if hasattr(shop_in.business_type, 'value') else shop_in.business_type,
        location=shop_in.location,
        owner_id=owner_id,
    )
    db.add(db_shop)
    db.commit()
    db.refresh(db_shop)
    return db_shop

def update_shop(db: Session, db_shop: Shop, shop_in: ShopUpdate) -> Shop:
    update_data = shop_in.model_dump(exclude_unset=True)
    if "business_type" in update_data and update_data["business_type"] is not None:
        if hasattr(update_data["business_type"], 'value'):
            update_data["business_type"] = update_data["business_type"].value
    
    for field, value in update_data.items():
        setattr(db_shop, field, value)
    
    db.add(db_shop)
    db.commit()
    db.refresh(db_shop)
    return db_shop
