from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.models.supplier import Supplier
from schemas.supplier import SupplierCreate, SupplierUpdate

class DuplicateSupplierError(ValueError):
    """A supplier with the same name (ignoring case and surrounding spaces) already exists in the shop."""


def _name_taken(db: Session, shop_id: UUID, name: str, exclude_id: Optional[UUID] = None) -> bool:
    q = db.query(Supplier).filter(Supplier.shop_id == shop_id,
                                  func.lower(func.trim(Supplier.supplier_name)) == (name or "").strip().lower())
    if exclude_id is not None:
        q = q.filter(Supplier.id != exclude_id)
    return db.query(q.exists()).scalar()


def _commit_unique(db: Session, name: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:  # created concurrently (uq_suppliers_shop_name_ci)
        db.rollback()
        raise DuplicateSupplierError(f"A supplier named '{name.strip()}' already exists in this shop.") from exc


def create_supplier(db: Session, supplier_in: SupplierCreate, shop_id: UUID) -> Supplier:
    if _name_taken(db, shop_id, supplier_in.supplier_name):
        raise DuplicateSupplierError(f"A supplier named '{supplier_in.supplier_name.strip()}' already exists in this shop.")
    db_supplier = Supplier(
        supplier_name=supplier_in.supplier_name,
        phone=supplier_in.phone,
        address=supplier_in.address,
        shop_id=shop_id,
    )
    db.add(db_supplier)
    _commit_unique(db, supplier_in.supplier_name)
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
    new_name = update_data.get("supplier_name")
    if new_name is not None and _name_taken(db, db_supplier.shop_id, new_name, exclude_id=db_supplier.id):
        raise DuplicateSupplierError(f"A supplier named '{new_name.strip()}' already exists in this shop.")
    for field, value in update_data.items():
        setattr(db_supplier, field, value)

    db.add(db_supplier)
    _commit_unique(db, new_name if new_name is not None else db_supplier.supplier_name)
    db.refresh(db_supplier)
    return db_supplier

def delete_supplier(db: Session, db_supplier: Supplier) -> None:
    db.delete(db_supplier)
    db.commit()
