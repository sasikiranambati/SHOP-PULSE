from typing import Optional, List
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field
from schemas.quantity import Quantity

class SaleItemCreate(BaseModel):
    product_id: UUID = Field(..., description="Product ID to sell")
    quantity: Quantity = Field(..., gt=0, description="Quantity to sell (> 0; fractional only for kg, g, L, ml)")
    unit: Optional[str] = Field(None, description="Requested unit of the quantity (defaults to product inventory unit if omitted)")
    unit_price: Optional[float] = Field(None, ge=0, description="Optional client price assertion. Validated against catalog pricing; never replaces server-authoritative calculation.")
    requested_line_total: Optional[float] = Field(
        None, ge=0,
        description="Customer-requested price for the whole line (e.g. spoken in Voice-to-Bill: '3 for 100'). "
                    "Applied only when it matches the catalogue price, or with Manager / Owner authorization "
                    "within MRP (audited); otherwise the sale is refused.")

class SaleCreate(BaseModel):
    items: List[SaleItemCreate] = Field(..., min_length=1, description="Sale item lines")
    payment_method: str = Field("cash", description="Payment method (cash, upi, card, credit)")
    customer_name: Optional[str] = Field(None, description="Optional counter customer name")

class SaleItemResponse(BaseModel):
    id: UUID
    sale_id: UUID
    product_id: UUID
    quantity: Quantity
    unit_price: float
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class SaleResponse(BaseModel):
    id: UUID
    shop_id: UUID
    total_amount: float
    payment_method: str
    items: List[SaleItemResponse]
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class PaginatedSaleResponse(BaseModel):
    items: List[SaleResponse]
    total: int
    skip: int
    limit: int


class SaleQuoteLine(BaseModel):
    """Server price check of one cart line (no sale recorded, nothing written)."""
    index: int
    product_id: UUID
    ok: bool = Field(..., description="The line can be sold as requested by this user")
    code: Optional[str] = Field(None, description="Why not: pricing_status | mrp_exceeded | insufficient_stock | unit | "
                                                  "price_mismatch | approval_required | not_found | invalid")
    message: Optional[str] = None
    line_total: Optional[float] = Field(None, description="What the line would be charged (requested price if approvable)")
    catalogue_line_total: Optional[float] = None
    effective_unit_price: Optional[float] = Field(None, description="Catalogue rate per single pricing-basis unit")
    pricing_basis_quantity: Optional[float] = None
    pricing_basis_unit: Optional[str] = None
    requested_quantity: Optional[float] = None
    requested_unit: Optional[str] = None
    stock_deduction_quantity: Optional[float] = None
    inventory_unit: Optional[str] = None
    line_mrp_total: Optional[float] = None
    requires_approval: bool = Field(False, description="A requested price differs from the catalogue")
    pricing_status: Optional[str] = None


class SaleQuoteResponse(BaseModel):
    lines: List[SaleQuoteLine]
    total: float = Field(..., description="Sum of the lines that can be sold as requested")
    all_ok: bool
    requires_approval: bool
    role: Optional[str] = None
    can_approve_price_overrides: bool = False
