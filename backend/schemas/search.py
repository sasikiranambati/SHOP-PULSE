from typing import List, Optional
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class ProductSearchHit(BaseModel):
    id: UUID
    name: str
    category: Optional[str] = None
    sku: Optional[str] = None
    unit: Optional[str] = None
    current_stock: int
    selling_price: float

    model_config = ConfigDict(from_attributes=True)


class PurchaseSearchHit(BaseModel):
    """A purchase (supplier invoice) recorded in ShopPulse."""
    id: UUID
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    supplier_name: Optional[str] = None
    total_amount: float
    item_count: int
    created_at: Optional[datetime] = None
    # Set when the purchase matched because one of its lines is this product
    matched_product: Optional[str] = None


class SaleSearchHit(BaseModel):
    """A recorded sale (customer bill)."""
    id: UUID
    bill_number: str
    total_amount: float
    payment_method: str
    item_count: int
    created_at: Optional[datetime] = None
    # Set when the sale matched because one of its lines is this product
    matched_product: Optional[str] = None


class SearchTotals(BaseModel):
    products: int = 0
    purchases: int = 0
    sales: int = 0


class SearchResponse(BaseModel):
    query: str
    products: List[ProductSearchHit] = []
    purchases: List[PurchaseSearchHit] = []
    sales: List[SaleSearchHit] = []
    totals: SearchTotals = SearchTotals()
