from typing import Optional, List
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class SupplierBase(BaseModel):
    supplier_name: str = Field(..., min_length=1, description="Name of the supplier")
    phone: Optional[str] = Field(None, description="Phone number of the supplier")
    address: Optional[str] = Field(None, description="Address of the supplier")

class SupplierCreate(SupplierBase):
    pass

class SupplierUpdate(BaseModel):
    supplier_name: Optional[str] = Field(None, min_length=1)
    phone: Optional[str] = None
    address: Optional[str] = None

class SupplierResponse(SupplierBase):
    id: UUID
    shop_id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class PaginatedSupplierResponse(BaseModel):
    items: List[SupplierResponse]
    total: int
    skip: int
    limit: int
