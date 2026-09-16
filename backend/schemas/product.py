from typing import Optional, List
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, computed_field

class ProductBase(BaseModel):
    name: str = Field(..., min_length=1, description="Product name")
    category: Optional[str] = Field(None, description="Product category")
    selling_price: float = Field(..., ge=0, description="Selling price (must be >= 0)")
    purchase_price: Optional[float] = Field(0.0, ge=0, description="Purchase price (must be >= 0)")
    current_stock: int = Field(0, ge=0, description="Current stock quantity (must be >= 0)")
    reorder_level: Optional[int] = Field(0, ge=0, description="Reorder level (must be >= 0)")
    unit: Optional[str] = Field("pcs", description="Unit of measurement")
    supplier_id: Optional[UUID] = Field(None, description="Supplier ID")
    sku: Optional[str] = Field(None, description="SKU or Barcode")

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1)
    category: Optional[str] = None
    selling_price: Optional[float] = Field(None, ge=0)
    purchase_price: Optional[float] = Field(None, ge=0)
    current_stock: Optional[int] = Field(None, ge=0)
    reorder_level: Optional[int] = Field(None, ge=0)
    unit: Optional[str] = None
    supplier_id: Optional[UUID] = None
    sku: Optional[str] = None

class ProductResponse(ProductBase):
    id: UUID
    shop_id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @computed_field
    @property
    def stock_status(self) -> str:
        r_level = self.reorder_level if self.reorder_level is not None else 0
        if self.current_stock <= 0:
            return "Critical"
        if self.current_stock <= r_level:
            if r_level > 0 and self.current_stock <= (r_level // 2):
                return "Critical"
            return "Low Stock"
        return "In Stock"

    model_config = ConfigDict(from_attributes=True)

class PaginatedProductResponse(BaseModel):
    items: List[ProductResponse]
    total: int
    skip: int
    limit: int
