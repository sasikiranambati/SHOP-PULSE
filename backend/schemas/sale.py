from typing import Optional, List
from datetime import date, datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class SaleItemCreate(BaseModel):
    product_id: UUID = Field(..., description="Product ID to sell")
    quantity: float = Field(..., gt=0, description="Quantity to sell (must be > 0)")
    unit_price: Optional[float] = Field(None, ge=0, description="Optional custom unit price")
    confirmed_large_quantity: Optional[bool] = Field(False, description="Explicit confirmation for quantities > 500")

class SaleCreate(BaseModel):
    items: List[SaleItemCreate] = Field(..., min_length=1, description="Sale item lines")
    payment_method: str = Field("cash", description="Payment method (cash, upi, card, credit)")
    confirmed_large_quantity: Optional[bool] = Field(False, description="Explicit confirmation for bulk cart lines")
    operating_date: Optional[date] = Field(None, description="Shop-local operating date (YYYY-MM-DD); defaults to local date")


class SaleItemResponse(BaseModel):
    id: UUID
    sale_id: UUID
    product_id: UUID
    quantity: float
    unit_price: float
    cost_price_at_sale: Optional[float] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class SaleResponse(BaseModel):
    id: UUID
    shop_id: UUID
    total_amount: float
    payment_method: str
    status: Optional[str] = "COMPLETED"
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None
    items: List[SaleItemResponse]
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class PaginatedSaleResponse(BaseModel):
    items: List[SaleResponse]
    total: int
    skip: int
    limit: int

class SaleCancelRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=255, description="Reason for cancelling the sale")

class SaleRefundRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=255, description="Reason for refunding the sale")
    restock_items: bool = Field(True, description="Whether to restore items to inventory stock")

