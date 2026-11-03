"""
High-fidelity deterministic Mock AI Provider for offline testing and V-Model verification.
Simulates real LLM responses, spelling corrections, and customizable failure modes.
"""

import re
import time
from typing import Any, Dict, Optional

from services.grocery_ocr.ai.providers.base import IAIProvider
from services.grocery_ocr.ai.schemas import (
    AIHeaderSuggestionRequest,
    AIHeaderSuggestionResponse,
    AIProductSuggestionRequest,
    AIProductSuggestionResponse,
)
from services.grocery_ocr.exceptions import (
    AIHallucinationSecurityViolation,
    AIProviderUnavailableError,
    AIRateLimitError,
    AIResponseValidationError,
    AITimeoutError,
)
from services.grocery_ocr.logger import get_logger

logger = get_logger("ai.mock_provider")


class MockAIProvider(IAIProvider):
    """
    Mock AI Provider designed to simulate grocery intelligence and test failure edge cases.
    Zero external network calls, 100% offline and deterministic.
    """

    def __init__(
        self,
        provider_name: str = "mock",
        model_id: str = "mock-grocery-llm-v1",
        simulate_timeout: bool = False,
        simulate_rate_limit: bool = False,
        simulate_unavailable: bool = False,
        simulate_invalid_json: bool = False,
        simulate_missing_fields: bool = False,
        simulate_unexpected_types: bool = False,
        simulate_hallucinated_numerics: bool = False,
        simulate_unsupported_category: bool = False,
    ):
        self._provider_name = provider_name
        self._model_id = model_id
        self.simulate_timeout = simulate_timeout
        self.simulate_rate_limit = simulate_rate_limit
        self.simulate_unavailable = simulate_unavailable
        self.simulate_invalid_json = simulate_invalid_json
        self.simulate_missing_fields = simulate_missing_fields
        self.simulate_unexpected_types = simulate_unexpected_types
        self.simulate_hallucinated_numerics = simulate_hallucinated_numerics
        self.simulate_unsupported_category = simulate_unsupported_category

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @property
    def model_identifier(self) -> str:
        return self._model_id

    def suggest_product(
        self,
        request: AIProductSuggestionRequest,
        timeout_seconds: float = 5.0
    ) -> Optional[AIProductSuggestionResponse]:
        """Provides simulated AI product interpretations and respects simulation flags."""
        # 1. Simulate failure modes
        if self.simulate_timeout:
            raise AITimeoutError(f"Mock AI call timed out after {timeout_seconds}s")

        if self.simulate_rate_limit:
            raise AIRateLimitError("Mock AI provider quota exceeded (HTTP 429)")

        if self.simulate_unavailable:
            raise AIProviderUnavailableError("Mock AI provider endpoint unreachable (HTTP 503)")

        if self.simulate_invalid_json:
            raise AIResponseValidationError("Unparseable JSON response: SyntaxError: Unexpected token < in JSON at position 0")

        if self.simulate_missing_fields:
            raise AIResponseValidationError("Missing required field 'confidence' in LLM payload")

        if self.simulate_unexpected_types:
            raise AIResponseValidationError("Type mismatch: expected float for 'confidence', received 'high'")

        if self.simulate_hallucinated_numerics:
            # Try to construct a dict with forbidden financial fields to test anti-hallucination guard
            # This triggers ValueError in AIProductSuggestionResponse validator
            return AIProductSuggestionResponse.model_validate({
                "original_description": request.original_description,
                "suggested_normalized_name": "Hallucinated Item",
                "suggested_brand": "Fortune",
                "confidence": 0.95,
                "reason": "Hallucinating financial price",
                "purchase_price": 150.00  # FORBIDDEN!
            })

        if self.simulate_unsupported_category:
            return AIProductSuggestionResponse.model_validate({
                "original_description": request.original_description,
                "suggested_normalized_name": "Industrial Plastic Granules",
                "suggested_category": "Spacecraft Metallurgy",  # Non-grocery
                "confidence": 0.90,
                "reason": "Test non-grocery category rejection"
            })

        raw = request.original_description.strip()
        raw_upper = raw.upper()

        # Case 1: "FORTUNE BESAAN 500GM" or variations
        if "BESAAN" in raw_upper or "BESAN" in raw_upper:
            brand = "Fortune" if "FORTUNE" in raw_upper else None
            return AIProductSuggestionResponse(
                original_description=raw,
                suggested_normalized_name="Fortune Besan" if brand else "Besan",
                suggested_brand=brand or "Fortune",
                suggested_category="Besan",
                suggested_package_size="500 GM" if "500" in raw_upper else None,
                confidence=0.92,
                reason="Normalized OCR spelling 'BESAAN' -> 'Besan' and recognized brand",
                requires_review=False
            )

        # Case 2: Severe OCR spelling error: "Ttaa Slat 1kg" -> "Tata Salt"
        if re.search(r"t+a+a*\s+s+l+a+t*", raw, re.I) or "TTASLAT" in raw_upper.replace(" ", ""):
            return AIProductSuggestionResponse(
                original_description=raw,
                suggested_normalized_name="Tata Salt 1kg",
                suggested_brand="Tata",
                suggested_category="Salt",
                suggested_package_size="1 KG",
                confidence=0.90,
                reason="Corrected transposed letters 'Ttaa Slat' to 'Tata Salt'",
                requires_review=False
            )

        # Case 3: Basmati rice spelling error: "Ind Gate B-Rice 5kg" -> "India Gate Basmati Rice"
        if "IND GATE" in raw_upper or "B-RICE" in raw_upper:
            return AIProductSuggestionResponse(
                original_description=raw,
                suggested_normalized_name="India Gate Basmati Rice",
                suggested_brand="India Gate",
                suggested_category="Rice",
                suggested_package_size="5 KG" if "5" in raw_upper else None,
                confidence=0.88,
                reason="Expanded abbreviation 'Ind Gate' and 'B-Rice'",
                requires_review=False
            )

        # Case 4: Unknown / novel grocery product (must be preserved, never discarded!)
        if "AMLA CANDY" in raw_upper:
            return AIProductSuggestionResponse(
                original_description=raw,
                suggested_normalized_name="Amla Candy",
                suggested_brand=None,
                suggested_category="Groceries",
                suggested_package_size="250 GM" if "250" in raw_upper else None,
                confidence=0.72,
                reason="Recognized novel grocery product, brand unspecified",
                requires_review=True  # Human review advised for unknown catalogue product
            )

        # Default fallback suggestion
        return AIProductSuggestionResponse(
            original_description=raw,
            suggested_normalized_name=raw.title(),
            suggested_brand=request.existing_brand_hint,
            suggested_category="Groceries",
            suggested_package_size=None,
            confidence=0.65,
            reason="Generic heuristic normalization",
            requires_review=True
        )

    def suggest_header(
        self,
        request: AIHeaderSuggestionRequest,
        timeout_seconds: float = 5.0
    ) -> Optional[AIHeaderSuggestionResponse]:
        """Resolves ambiguous invoice headers."""
        if self.simulate_timeout:
            raise AITimeoutError("Mock header suggestion timed out")

        raw_upper = request.raw_header.strip().upper()

        if raw_upper in ("PRC", "PRCE", "UN.PR"):
            return AIHeaderSuggestionResponse(
                raw_header=request.raw_header,
                suggested_role="rate",
                confidence=0.91,
                reason="Abbreviation resolved to unit purchase rate"
            )

        if raw_upper in ("NET PAYABLE", "INV TOTAL", "BILL VAL"):
            return AIHeaderSuggestionResponse(
                raw_header=request.raw_header,
                suggested_role="total",
                confidence=0.95,
                reason="Total payable amount header variant"
            )

        if raw_upper in ("ITEM PARTICULARS", "COMMODITY"):
            return AIHeaderSuggestionResponse(
                raw_header=request.raw_header,
                suggested_role="product",
                confidence=0.94,
                reason="Product description column header variant"
            )

        return AIHeaderSuggestionResponse(
            raw_header=request.raw_header,
            suggested_role="unknown",
            confidence=0.40,
            reason="Unrecognized header string"
        )

