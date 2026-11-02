from typing import Optional, List
from datetime import date, time, datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class ShopOperatingStatusBase(BaseModel):
    operating_date: date = Field(..., description="Operating calendar date (YYYY-MM-DD)")
    is_open: bool = Field(True, description="Whether the shop is open on this date")
    opening_time: Optional[time] = Field(None, description="Opening time (HH:MM:SS)")
    closing_time: Optional[time] = Field(None, description="Closing time (HH:MM:SS)")
    closure_reason: Optional[str] = Field(
        None,
        max_length=64,
        description="Reason for closure (e.g. WEEKLY_OFF, FESTIVAL, PERSONAL, EMERGENCY, PUBLIC_HOLIDAY)"
    )
    notes: Optional[str] = Field(None, max_length=255, description="Optional notes or holiday details")

class ShopOperatingStatusCreate(ShopOperatingStatusBase):
    pass

class ShopOperatingStatusUpdate(BaseModel):
    is_open: Optional[bool] = Field(None, description="Whether the shop is open on this date")
    opening_time: Optional[time] = Field(None, description="Opening time (HH:MM:SS)")
    closing_time: Optional[time] = Field(None, description="Closing time (HH:MM:SS)")
    closure_reason: Optional[str] = Field(None, max_length=64, description="Reason for closure")
    notes: Optional[str] = Field(None, max_length=255, description="Optional notes")

class ShopOperatingStatusResponse(ShopOperatingStatusBase):
    id: UUID
    shop_id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class PaginatedShopOperatingStatusResponse(BaseModel):
    items: List[ShopOperatingStatusResponse]
    total: int
    skip: int
    limit: int
