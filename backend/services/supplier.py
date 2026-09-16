from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.supplier import Supplier
from schemas.supplier import SupplierCreate, SupplierUpdate

def create_supplier(db: Session, supplier_in: SupplierCreate, shop_id: UUID) -> Supplier:
    db_supplier = Supplier(
        supplier_name=supplier_in.supplier_name,
        phone=supplier_in.phone,
        address=supplier_in.address,
        shop_id=shop_id,
    )
    db.add(db_supplier)
    db.commit()
    db.refresh(db_supplier)
    return db_supplier

def get_supplier_by_id(db: Session, supplier_id: UUID) -> Optional[Supplier]:
    return db.query(Supplier).filter(Supplier.id == supplier_id).first()

def get_suppliers_by_shop(
    db: Session,
    shop_id: UUID,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 10
) -> Tuple[List[Supplier], int]:
    query = db.query(Supplier).filter(Supplier.shop_id == shop_id)
    
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(Supplier.supplier_name.ilike(search_pattern))
        
    total = query.count()
    items = query.order_by(Supplier.created_at.desc()).offset(skip).limit(limit).all()
    return items, total

def update_supplier(db: Session, db_supplier: Supplier, supplier_in: SupplierUpdate) -> Supplier:
    update_data = supplier_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_supplier, field, value)
        
    db.add(db_supplier)
    db.commit()
    db.refresh(db_supplier)
    return db_supplier

def delete_supplier(db: Session, db_supplier: Supplier) -> None:
    db.delete(db_supplier)
    db.commit()
