from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.sale import Sale
from db.models.sale_item import SaleItem
from db.models.product import Product
from schemas.sale import SaleCreate

def create_sale(db: Session, sale_in: SaleCreate, shop_id: UUID) -> Sale:
    try:
        validated_items = []
        total_amount = 0.0

        for item in sale_in.items:
            product = db.query(Product).filter(Product.id == item.product_id).first()
            if not product or product.shop_id != shop_id:
                raise ValueError(f"Product {item.product_id} not found or does not belong to your shop.")
            
            if product.current_stock < item.quantity:
                raise ValueError(
                    f"Insufficient stock for product '{product.name}'. "
                    f"Available: {product.current_stock}, requested: {item.quantity}"
                )
            
            unit_price = item.unit_price if item.unit_price is not None else product.selling_price
            item_total = item.quantity * unit_price
            total_amount += item_total
            validated_items.append((product, item, unit_price))

        # Create Sale Header
        db_sale = Sale(
            shop_id=shop_id,
            total_amount=total_amount,
            payment_method=sale_in.payment_method,
        )
        db.add(db_sale)
        db.flush()  # Obtain db_sale.id

        # Create Sale Items & Deduct Inventory
        for product, item, unit_price in validated_items:
            db_item = SaleItem(
                sale_id=db_sale.id,
                product_id=product.id,
                quantity=item.quantity,
                unit_price=unit_price,
            )
            db.add(db_item)

            # Deduct product stock in the same transaction
            product.current_stock -= item.quantity
            db.add(product)

        db.commit()
        db.refresh(db_sale)
        return db_sale

    except Exception as e:
        db.rollback()
        raise e

def get_sale_by_id(db: Session, sale_id: UUID) -> Optional[Sale]:
    return db.query(Sale).filter(Sale.id == sale_id).first()

def get_sales_by_shop(
    db: Session,
    shop_id: UUID,
    skip: int = 0,
    limit: int = 10
) -> Tuple[List[Sale], int]:
    query = db.query(Sale).filter(Sale.shop_id == shop_id)
    total = query.count()
    items = query.order_by(Sale.created_at.desc()).offset(skip).limit(limit).all()
    return items, total
