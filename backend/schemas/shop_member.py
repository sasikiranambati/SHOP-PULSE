from typing import Optional
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field

class ShopMemberBase(BaseModel):
    role: str = Field("CASHIER", description="Role within shop: OWNER | MANAGER | CASHIER")
    is_active: bool = Field(True, description="Whether membership is active")

class ShopMemberCreate(BaseModel):
    email: Optional[str] = Field(None, description="Email of existing registered user to add")
    user_id: Optional[UUID] = Field(None, description="User ID of existing registered user to add")
    role: str = Field("CASHIER", description="Role to assign: MANAGER | CASHIER")

class ShopMemberUpdate(BaseModel):
    role: Optional[str] = Field(None, description="Updated role: MANAGER | CASHIER")
    is_active: Optional[bool] = Field(None, description="Whether membership is active")

class ShopMemberResponse(ShopMemberBase):
    id: UUID
    shop_id: UUID
    user_id: UUID
    user_email: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class MyMembershipResponse(BaseModel):
    """The signed-in user's own role in their shop (read-only; used by the frontend to show the right actions).

    Authorization is still enforced by every endpoint; these flags only decide what the interface offers."""
    shop_id: UUID
    shop_name: Optional[str] = None
    role: str
    can_verify_pricing: bool
    can_approve_price_overrides: bool
    can_deactivate_products: bool
