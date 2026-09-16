from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from db.models.sale import Sale
from db.models.sale_item import SaleItem
from db.models.product import Product
from schemas.dashboard import DashboardResponse, TopProductResponse
from schemas.product import ProductResponse
from schemas.sale import SaleResponse

def get_dashboard_data(db: Session, shop_id: UUID) -> DashboardResponse:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_naive = today_start.replace(tzinfo=None)

    # 1. Total sales amount today
    today_sales_val = (
        db.query(func.coalesce(func.sum(Sale.total_amount), 0.0))
        .filter(
            Sale.shop_id == shop_id,
            (Sale.created_at >= today_start) | (Sale.created_at >= today_start_naive)
        )
        .scalar()
    )
    today_sales = float(today_sales_val or 0.0)

    # 2. Total active products count
    products_count = (
        db.query(func.count(Product.id))
        .filter(Product.shop_id == shop_id)
        .scalar() or 0
    )

    # 3. Total low stock count
    low_stock_count = (
        db.query(func.count(Product.id))
        .filter(
            Product.shop_id == shop_id,
            Product.current_stock <= Product.reorder_level
        )
        .scalar() or 0
    )

    # 4. Total items sold today
    items_sold_today_val = (
        db.query(func.coalesce(func.sum(SaleItem.quantity), 0))
        .join(Sale, SaleItem.sale_id == Sale.id)
        .filter(
            Sale.shop_id == shop_id,
            (Sale.created_at >= today_start) | (Sale.created_at >= today_start_naive)
        )
        .scalar()
    )
    items_sold_today = int(items_sold_today_val or 0)

    # 5. Top products by quantity sold
    top_products_raw = (
        db.query(Product, func.sum(SaleItem.quantity).label("total_sold"))
        .join(SaleItem, SaleItem.product_id == Product.id)
        .join(Sale, SaleItem.sale_id == Sale.id)
        .filter(Sale.shop_id == shop_id)
        .group_by(Product.id)
        .order_by(func.sum(SaleItem.quantity).desc())
        .limit(5)
        .all()
    )

    top_products = [
        TopProductResponse(
            id=p.id,
            name=p.name,
            category=p.category,
            selling_price=p.selling_price,
            purchase_price=p.purchase_price,
            current_stock=p.current_stock,
            reorder_level=p.reorder_level,
            unit=p.unit,
            supplier_id=p.supplier_id,
            sku=p.sku,
            shop_id=p.shop_id,
            created_at=p.created_at,
            updated_at=p.updated_at,
            total_sold=int(total_sold or 0)
        )
        for p, total_sold in top_products_raw
    ]

    # 6. Low stock products (up to 5)
    low_stock_products_raw = (
        db.query(Product)
        .filter(
            Product.shop_id == shop_id,
            Product.current_stock <= Product.reorder_level
        )
        .limit(5)
        .all()
    )
    low_stock_products = [ProductResponse.model_validate(p) for p in low_stock_products_raw]

    # 7. Recent sales (up to 5)
    recent_sales_raw = (
        db.query(Sale)
        .filter(Sale.shop_id == shop_id)
        .order_by(Sale.created_at.desc())
        .limit(5)
        .all()
    )
    recent_sales = [SaleResponse.model_validate(s) for s in recent_sales_raw]

    return DashboardResponse(
        today_sales=today_sales,
        products_count=products_count,
        low_stock_count=low_stock_count,
        items_sold_today=items_sold_today,
        top_products=top_products,
        low_stock_products=low_stock_products,
        recent_sales=recent_sales
    )
