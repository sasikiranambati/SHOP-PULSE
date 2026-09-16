from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.models.product import Product
from schemas.product import ProductCreate, ProductUpdate

def create_product(db: Session, product_in: ProductCreate, shop_id: UUID) -> Product:
    db_product = Product(
        name=product_in.name,
        category=product_in.category,
        selling_price=product_in.selling_price,
        purchase_price=product_in.purchase_price,
        current_stock=product_in.current_stock,
        reorder_level=product_in.reorder_level,
        unit=product_in.unit,
        supplier_id=product_in.supplier_id,
        sku=product_in.sku,
        shop_id=shop_id,
    )
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product

def get_product_by_id(db: Session, product_id: UUID) -> Optional[Product]:
    return db.query(Product).filter(Product.id == product_id).first()

def get_products_by_shop(
    db: Session,
    shop_id: UUID,
    search: Optional[str] = None,
    category: Optional[str] = None,
    skip: int = 0,
    limit: int = 10
) -> Tuple[List[Product], int]:
    query = db.query(Product).filter(Product.shop_id == shop_id)
    
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(Product.name.ilike(search_pattern))
        
    if category:
        query = query.filter(Product.category.ilike(category))
        
    total = query.count()
    items = query.order_by(Product.created_at.desc()).offset(skip).limit(limit).all()
    return items, total

def update_product(db: Session, db_product: Product, product_in: ProductUpdate) -> Product:
    update_data = product_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_product, field, value)
        
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product

def delete_product(db: Session, db_product: Product) -> None:
    db.delete(db_product)
    db.commit()

def get_low_stock_products_by_shop(
    db: Session,
    shop_id: UUID,
    skip: int = 0,
    limit: int = 10
) -> Tuple[List[Product], int]:
    query = db.query(Product).filter(
        Product.shop_id == shop_id,
        Product.current_stock <= Product.reorder_level
    )
    total = query.count()
    items = query.order_by(Product.current_stock.asc()).offset(skip).limit(limit).all()
    return items, total
