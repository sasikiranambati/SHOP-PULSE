from enum import Enum
from typing import Optional
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class BusinessType(str, Enum):
    GROCERY_KIRANA = "Grocery/Kirana"
    BAKERY = "Bakery"
    MEDICAL_PHARMACY = "Medical/Pharmacy"
    TEA_COFFEE_SHOP = "Tea/Coffee Shop"
    SWEET_SHOP = "Sweet Shop"
    FRUIT_VEGETABLE_STORE = "Fruit & Vegetable Store"
    MOBILE_ELECTRONICS_ACCESSORIES = "Mobile & Electronics Accessories"
    STATIONERY_BOOK_STORE = "Stationery & Book Store"
    HARDWARE_STORE = "Hardware Store"
    ELECTRICAL_STORE = "Electrical Store"
    COSMETICS_PERSONAL_CARE = "Cosmetics & Personal Care"
    HOUSEHOLD_GENERAL_STORE = "Household & General Store"
    PLANT_GARDENING_STORE = "Plant & Gardening Store"
    OTHER_RETAIL_STORE = "Other Retail Store"

class ShopBase(BaseModel):
    shop_name: str = Field(..., min_length=1, description="Name of the shop")
    owner_name: str = Field(..., min_length=1, description="Name of the shop owner")
    business_type: BusinessType
    location: Optional[str] = Field(None, description="Location/Address of the shop")

class ShopCreate(ShopBase):
    pass

class ShopUpdate(BaseModel):
    shop_name: Optional[str] = Field(None, min_length=1)
    owner_name: Optional[str] = Field(None, min_length=1)
    business_type: Optional[BusinessType] = None
    location: Optional[str] = None

class ShopResponse(ShopBase):
    id: UUID
    owner_id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
