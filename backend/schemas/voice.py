from typing import List, Optional, Union
from uuid import UUID
from pydantic import BaseModel, Field
from schemas.quantity import Quantity

class VoiceProductCandidate(BaseModel):
    id: str
    name: str
    selling_price: float
    current_stock: Quantity
    unit: str
    category: Optional[str] = None
    sku: Optional[str] = None
    price_basis_quantity: Optional[Union[float, int]] = Field(1.0, description="Reference quantity for selling price")
    price_basis_unit: Optional[str] = Field(None, description="Reference unit for selling price")
    pricing_status: Optional[str] = Field("VERIFIED", description="Pricing status: VERIFIED, NEEDS_REVIEW, INCOMPLETE, WHOLESALE_ONLY")
    mrp: Optional[float] = Field(None, description="Statutory Maximum Retail Price")
    mrp_basis_quantity: Optional[Union[float, int]] = Field(None, description="Reference quantity for MRP")
    mrp_basis_unit: Optional[str] = Field(None, description="Reference unit for MRP")

class MatchedVoiceItem(BaseModel):
    product_id: str
    name: str
    quantity: Union[int, float] = Field(..., gt=0)
    unit_price: float = Field(..., description="Unit price for display (up to 3 decimals)")
    unit_price_exact: Optional[float] = Field(
        None, description="Precise unit price to send with the sale: quantity x this, rounded to paise, equals total_price")
    total_price: float
    unit: str
    current_stock: Quantity
    is_out_of_stock: bool = False
    is_insufficient_stock: bool = False
    available_stock: Quantity
    # 'spoken': the price came from the speech (kept through cart and sale); 'catalogue': selling price
    price_source: str = "catalogue"
    # What was said when it differs from the stock quantity/unit (e.g. "500 g" sold as 0.5 kg)
    spoken_quantity: Optional[str] = None
    pricing_status: Optional[str] = Field(None, description="Product pricing verification status")
    mrp: Optional[float] = Field(None, description="Maximum Retail Price")
    catalog_line_total: Optional[float] = Field(None, description="Standard catalog line total for comparison if spoken price was agreed")
    # True when the spoken price differs from the catalogue line: a customer request that only a Manager /
    # Owner can approve at checkout (never applied silently)
    needs_price_approval: bool = False

class AmbiguousVoiceItem(BaseModel):
    queried_name: str
    quantity: Union[int, float] = Field(..., gt=0)
    candidates: List[VoiceProductCandidate]
    # Spoken line total, if any, so choosing a candidate keeps the spoken price
    spoken_price: Optional[float] = None
    # The ready line for each candidate the item can be sold as (unit converted, spoken price kept)
    options: List[MatchedVoiceItem] = Field(default_factory=list)

class UnmatchedVoiceItem(BaseModel):
    queried_name: str
    quantity: Union[int, float] = Field(..., gt=0)
    reason: str = "Product not found in shop inventory"

class VoiceProcessRequest(BaseModel):
    simulation_text: Optional[str] = Field(None, description="Simulated spoken transcript for mock mode")
    audio_base64: Optional[str] = Field(None, description="Base64 encoded audio recording")
    audio_content_type: Optional[str] = Field(None, description="Audio MIME type (e.g. audio/webm, audio/wav)")
    language_code: Optional[str] = Field("en-IN", description="Language locale code (e.g. en-IN, hi-IN, te-IN)")
    custom_products: Optional[List[VoiceProductCandidate]] = Field(None, description="Optional custom product catalog override for testing")

class VoiceProcessResponse(BaseModel):
    transcript: str
    detected_language: Optional[str] = "en-IN"
    provider: str
    is_mock: bool
    matched_items: List[MatchedVoiceItem]
    ambiguous_items: List[AmbiguousVoiceItem]
    unmatched_items: List[UnmatchedVoiceItem]
    subtotal: float
    tax: float
    total: float

class VoiceStatusResponse(BaseModel):
    voice_mode: str
    provider: str
    is_mock: bool
    sarvam_configured: bool
    supported_languages: List[dict]
