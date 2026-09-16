from typing import Optional, List
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class PurchaseItemCreate(BaseModel):
    product_id: UUID = Field(..., description="Product ID to purchase")
    quantity: int = Field(..., gt=0, description="Quantity of product purchased (must be > 0)")
    purchase_price: float = Field(..., ge=0, description="Unit purchase price (must be >= 0)")

class PurchaseCreate(BaseModel):
    supplier_id: Optional[UUID] = Field(None, description="Optional Supplier ID")
    items: List[PurchaseItemCreate] = Field(..., min_length=1, description="Purchase item lines")

class PurchaseItemResponse(BaseModel):
    id: UUID
    purchase_id: UUID
    product_id: UUID
    quantity: int
    purchase_price: float
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class PurchaseResponse(BaseModel):
    id: UUID
    shop_id: UUID
    supplier_id: Optional[UUID] = None
    total_amount: float
    items: List[PurchaseItemResponse]
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class PaginatedPurchaseResponse(BaseModel):
    items: List[PurchaseResponse]
    total: int
    skip: int
    limit: int
