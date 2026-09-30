from typing import List, Optional, Union
from uuid import UUID
from pydantic import BaseModel, Field

class VoiceProductCandidate(BaseModel):
    id: str
    name: str
    selling_price: float
    current_stock: int
    unit: str
    category: Optional[str] = None
    sku: Optional[str] = None

class MatchedVoiceItem(BaseModel):
    product_id: str
    name: str
    quantity: Union[int, float] = Field(..., gt=0)
    unit_price: float
    total_price: float
    unit: str
    current_stock: int
    is_out_of_stock: bool = False
    is_insufficient_stock: bool = False
    available_stock: int

class AmbiguousVoiceItem(BaseModel):
    queried_name: str
    quantity: Union[int, float] = Field(..., gt=0)
    candidates: List[VoiceProductCandidate]

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
