from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from schemas.product import ProductResponse
from schemas.sale import SaleResponse

class TopProductResponse(ProductResponse):
    total_sold: int = 0

class DashboardResponse(BaseModel):
    today_sales: float = 0.0
    products_count: int = 0
    low_stock_count: int = 0
    items_sold_today: int = 0
    top_products: List[TopProductResponse] = []
    low_stock_products: List[ProductResponse] = []
    recent_sales: List[SaleResponse] = []

    model_config = ConfigDict(from_attributes=True)
