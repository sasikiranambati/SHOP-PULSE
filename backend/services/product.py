from datetime import datetime, timezone
from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.models.product import Product
from db.models.product_category import ProductCategory
from schemas.product import ProductCreate, ProductUpdate
from core.categories import (
    INDIAN_RETAIL_CATEGORIES,
    CATEGORY_METADATA,
    normalize_product_category,
)
from services.stockout import (
    record_stockout_event_if_depleted,
    resolve_active_stockout_events_if_restocked,
)


def create_product(db: Session, product_in: ProductCreate, shop_id: UUID) -> Product:
    # Category normalization
    raw_cat = product_in.raw_category if product_in.raw_category is not None else product_in.category
    std_cat, needs_rev = normalize_product_category(raw_cat, product_in.name)

    # If caller explicitly provided standardized_category and it's valid
    if product_in.standardized_category and product_in.standardized_category in INDIAN_RETAIL_CATEGORIES:
        std_cat = product_in.standardized_category
        needs_rev = False

    now_utc = datetime.now(timezone.utc)
    is_out_of_stock = product_in.current_stock <= 0

    db_product = Product(
        name=product_in.name,
        category=raw_cat or std_cat,  # Backward compatibility
        standardized_category=std_cat,
        raw_category=raw_cat,
        needs_category_review=needs_rev if product_in.needs_category_review is None else product_in.needs_category_review,
        selling_price=product_in.selling_price,
        purchase_price=product_in.purchase_price,
        mrp=product_in.mrp,
        mrp_source=(product_in.mrp_source or "MANUAL") if product_in.mrp is not None else None,
        mrp_updated_at=now_utc if product_in.mrp is not None else None,
        current_stock=product_in.current_stock,
        reorder_level=product_in.reorder_level,
        last_stockout_at=now_utc if is_out_of_stock else None,
        is_active=product_in.is_active if product_in.is_active is not None else True,
        unit=product_in.unit or "pcs",
        supplier_id=product_in.supplier_id,
        sku=product_in.sku,
        shop_id=shop_id,
    )
    db.add(db_product)
    db.flush()

    if is_out_of_stock:
        record_stockout_event_if_depleted(db, shop_id=shop_id, product=db_product, reason="INITIAL_ZERO_STOCK")

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
    needs_review: Optional[bool] = None,
    skip: int = 0,
    limit: int = 10
) -> Tuple[List[Product], int]:
    query = db.query(Product).filter(Product.shop_id == shop_id)
    
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(Product.name.ilike(search_pattern))
        
    if category:
        # Match either legacy category or standardized_category
        query = query.filter(
            (Product.category.ilike(category)) | (Product.standardized_category.ilike(category))
        )

    if needs_review is not None:
        query = query.filter(Product.needs_category_review == needs_review)
        
    total = query.count()
    items = query.order_by(Product.created_at.desc()).offset(skip).limit(limit).all()
    return items, total


def update_product(db: Session, db_product: Product, product_in: ProductUpdate) -> Product:
    update_data = product_in.model_dump(exclude_unset=True)
    mrp_source = update_data.pop("mrp_source", None)
    if "mrp" in update_data and update_data["mrp"] != db_product.mrp:
        # Track where the MRP came from whenever it changes
        db_product.mrp_source = (mrp_source or "MANUAL") if update_data["mrp"] is not None else None
        db_product.mrp_updated_at = datetime.now(timezone.utc)

    # Category normalization on update
    if "standardized_category" in update_data and update_data["standardized_category"]:
        if update_data["standardized_category"] in INDIAN_RETAIL_CATEGORIES:
            db_product.standardized_category = update_data["standardized_category"]
            db_product.needs_category_review = False
            update_data.pop("standardized_category")
            update_data.pop("needs_category_review", None)
    elif "category" in update_data or "raw_category" in update_data:
        raw_cat = update_data.get("raw_category", update_data.get("category", db_product.raw_category))
        std_cat, needs_rev = normalize_product_category(raw_cat, update_data.get("name", db_product.name))
        db_product.raw_category = raw_cat
        db_product.standardized_category = std_cat
        db_product.needs_category_review = needs_rev

    for field, value in update_data.items():
        setattr(db_product, field, value)

    # Handle stock changes and stockout events
    if db_product.current_stock <= 0:
        record_stockout_event_if_depleted(db, shop_id=db_product.shop_id, product=db_product, reason="MANUAL_COUNT")
    else:
        resolve_active_stockout_events_if_restocked(db, shop_id=db_product.shop_id, product=db_product)
        
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


def get_canonical_categories(db: Session) -> List[dict]:
    """Retrieve canonical category master from database or metadata."""
    db_cats = db.query(ProductCategory).filter(ProductCategory.is_active == True).order_by(ProductCategory.display_order.asc()).all()
    if db_cats:
        return [
            {
                "code": c.code,
                "name": c.name,
                "description": c.description,
                "display_order": c.display_order,
            }
            for c in db_cats
        ]
    return CATEGORY_METADATA
