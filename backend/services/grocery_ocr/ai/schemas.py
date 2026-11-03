"""
Pydantic schemas for AI-assisted invoice interpretation, validation, and audit tracking.
Enforces strict schema constraints, rejected data types, and privacy-safe input models.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from services.grocery_ocr.intelligence.taxonomy import ALL_GROCERY_CATEGORIES


class AIProductSuggestionRequest(BaseModel):
    """
    Privacy-safe minimal input context for product interpretation.
    Excludes customer, supplier phone/address, or unrelated invoice details.
    """
    original_description: str = Field(..., min_length=1, description="Verbatim OCR product description")
    raw_ocr_tokens: List[str] = Field(default_factory=list, description="Surrounding words from the reconstructed row")
    hsn_hint: Optional[str] = Field(None, description="HSN / SAC code hint from the invoice row")
    existing_brand_hint: Optional[str] = Field(None, description="Deterministic brand candidate, if any")
    catalogue_candidates: List[str] = Field(default_factory=list, description="Names of potential catalogue matches")

    model_config = ConfigDict(frozen=True)


class AIProductSuggestionResponse(BaseModel):
    """
    Strictly validated structured response for AI product suggestion.
    Rejects any fabricated or unsupported classifications.
    """
    original_description: str = Field(..., min_length=1, description="Original verbatim product text")
    suggested_normalized_name: Optional[str] = Field(None, description="Cleaned, normalized product name")
    suggested_brand: Optional[str] = Field(None, description="Recognized grocery brand name")
    suggested_category: Optional[str] = Field(None, description="Standard retail grocery category")
    suggested_package_size: Optional[str] = Field(None, description="Extracted package size, e.g. '500 GM', '1 KG'")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Normalized AI confidence in range 0.0 to 1.0")
    reason: str = Field(..., min_length=1, description="Auditable explanation of the AI suggestion")
    requires_review: bool = Field(default=False, description="Whether manual review is advised")

    # Anti-hallucination forbidden fields check:
    # Under no circumstances may AI output financial or quantity fields!
    @model_validator(mode="before")
    @classmethod
    def reject_financial_hallucinations(cls, values: Any) -> Any:
        if isinstance(values, dict):
            forbidden = [
                "quantity", "qty", "purchase_price", "rate", "price",
                "selling_price", "mrp", "discount", "gst_amount",
                "tax_amount", "printed_amount", "calculated_amount"
            ]
            for key in forbidden:
                if key in values and values[key] is not None:
                    raise ValueError(
                        f"Security violation: AI output attempted to supply or override financial field '{key}'"
                    )

            # Ensure confidence is numeric
            conf = values.get("confidence")
            if conf is not None:
                if isinstance(conf, str):
                    try:
                        conf = float(conf)
                        values["confidence"] = conf
                    except ValueError:
                        raise ValueError(f"Confidence must be a float, got {type(conf).__name__}")

            # Check category against recognized retail taxonomy if provided
            cat = values.get("suggested_category")
            if cat is not None and cat not in ALL_GROCERY_CATEGORIES and cat != "Groceries":
                # Normalize common aliases if close, or reject
                aliases = {
                    "grocery": "Groceries",
                    "groceries": "Groceries",
                    "oil": "Cooking oils",
                    "cooking oil": "Cooking oils",
                    "pulse": "Dal and pulses",
                    "pulses": "Dal and pulses",
                    "spice": "Spices",
                    "dry fruit": "Dry fruits",
                    "dairy": "Dairy products",
                }
                if cat.lower() in aliases:
                    values["suggested_category"] = aliases[cat.lower()]
                else:
                    raise ValueError(f"Unsupported grocery category '{cat}'. Must be one of recognized taxonomy.")

        return values

    model_config = ConfigDict(extra="forbid")


class AIHeaderSuggestionRequest(BaseModel):
    """Minimal context for ambiguous table header interpretation."""
    raw_header: str = Field(..., min_length=1, description="Verbatim header text")
    column_samples: List[str] = Field(default_factory=list, description="Sample cell values from this column")

    model_config = ConfigDict(frozen=True)


class AIHeaderSuggestionResponse(BaseModel):
    """Structured response for ambiguous header role resolution."""
    raw_header: str = Field(..., min_length=1)
    suggested_role: Literal["product", "qty", "unit", "rate", "mrp", "total", "hsn", "tax", "discount", "unknown"] = Field(...)
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: str = Field(..., min_length=1)

    model_config = ConfigDict(extra="forbid")


class AIAuditEntry(BaseModel):
    """
    Complete audit record for every AI interaction.
    Tracks model, timestamps, input summaries, acceptance decisions, and review flags.
    Does not log API keys or customer/vendor private info.
    """
    decision_id: str = Field(..., description="Unique deterministic UUID for this decision")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 UTC timestamp"
    )
    invoice_id: Optional[str] = Field(None, description="Invoice reference ID")
    stage: str = Field(..., description="Processing stage, e.g. product_normalization, header_interpretation")
    input_summary: Dict[str, Any] = Field(default_factory=dict, description="Sanitized, privacy-safe input summary")
    ai_suggestion: Dict[str, Any] = Field(default_factory=dict, description="Raw suggestion returned by the AI")
    model_id: str = Field(default="mock-grocery-llm-v1", description="Model identifier")
    provider: str = Field(default="mock", description="AI provider used: mock | gemini | groq")
    accepted: bool = Field(default=False, description="Whether the suggestion passed validation and was accepted")
    rejection_reason: Optional[str] = Field(None, description="Reason if suggestion was rejected by validation")
    requires_manual_review: bool = Field(default=False, description="Whether manual human review was mandated")

    model_config = ConfigDict(from_attributes=True)


class AITelemetry(BaseModel):
    """Operational metrics for AI service invocations, latency, and fallback rates."""
    request_count: int = Field(default=0, ge=0)
    total_response_time_ms: float = Field(default=0.0, ge=0.0)
    failure_count: int = Field(default=0, ge=0)
    fallback_count: int = Field(default=0, ge=0)
    cache_hit_count: int = 0
    correction_count: int = 0

    @property
    def average_response_time_ms(self) -> float:
        if self.request_count == 0:
            return 0.0
        return round(self.total_response_time_ms / self.request_count, 2)

    @property
    def failure_rate(self) -> float:
        if self.request_count == 0:
            return 0.0
        return round(self.failure_count / self.request_count, 4)

    @property
    def fallback_rate(self) -> float:
        if self.request_count == 0:
            return 0.0
        return round(self.fallback_count / self.request_count, 4)

    def record_success(self, duration_ms: float, was_corrected: bool = False, was_cache_hit: bool = False):
        self.request_count += 1
        self.total_response_time_ms += duration_ms
        if was_corrected:
            self.correction_count += 1
        if was_cache_hit:
            self.cache_hit_count += 1

    def record_failure(self, duration_ms: float = 0.0):
        self.request_count += 1
        self.total_response_time_ms += duration_ms
        self.failure_count += 1
        self.fallback_count += 1

