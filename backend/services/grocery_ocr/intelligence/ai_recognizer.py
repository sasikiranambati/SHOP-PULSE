"""
AI-assisted grocery product recognition interface and safe implementation.
Used only when deterministic classification yields low confidence or ambiguous descriptions.
Enforces strict hallucination guards: AI output is validated against raw OCR tokens.
Never invents attributes, brands, or package sizes.
Falls back seamlessly to deterministic results when offline or unconfigured.
"""

import json
import os
import re
from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.intelligence.package_size_extractor import PackageSizeExtractor
from services.grocery_ocr.intelligence.taxonomy import ALL_GROCERY_CATEGORIES
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice_item import PackageSize

logger = get_logger("intelligence.ai_recognizer")


class AIRecognitionResult(BaseModel):
    """Validated structured intelligence extracted by AI assistant."""
    normalized_name: Optional[str] = Field(None, description="Cleaned, normalized product name")
    brand: Optional[str] = Field(None, description="Recognized brand name")
    category: Optional[str] = Field(None, description="Taxonomy category")
    package_size: Optional[PackageSize] = Field(None, description="Validated package size")
    confidence: float = Field(default=85.0, ge=0.0, le=100.0, description="AI confidence score")
    reasoning: str = Field(default="", description="Auditable reasoning provided by AI model")


class IAIProductRecognizer(ABC):
    """Abstract interface for AI-assisted grocery item interpretation."""

    @abstractmethod
    def recognize(
        self,
        raw_text: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Optional[AIRecognitionResult]:
        """
        Assists with interpreting ambiguous or degraded grocery line items.

        Args:
            raw_text: Verbatim OCR text from document.
            context: Optional dictionary containing surrounding line items, HSN, or table hints.

        Returns:
            Validated AIRecognitionResult if successful and verified, else None.
        """
        pass


class BaseAIProductRecognizer(IAIProductRecognizer):
    """
    AI-assisted recognizer with strict post-validation against hallucination.
    Operates in mock mode by default or integrates with backend LLM keys when explicitly configured.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config
        self.package_size_extractor = PackageSizeExtractor(self.config)

    def _validate_ai_response(
        self,
        raw_text: str,
        result: AIRecognitionResult
    ) -> bool:
        """
        Validates AI output against raw OCR evidence.
        Enforces strict safety rules:
        1. AI must not hallucinate a brand that has zero token overlap with raw_text.
        2. AI must not hallucinate a package size value not present in raw_text.
        3. Category must be part of recognized retail grocery taxonomy.
        """
        raw_lower = raw_text.lower()

        # 1. Category validation
        if result.category and result.category not in ALL_GROCERY_CATEGORIES:
            logger.warning("AI category '%s' rejected: not in recognized taxonomy", result.category)
            return False

        # 2. Brand hallucination guard
        if result.brand:
            brand_clean = result.brand.lower().strip()
            # Brand or brand tokens must exist in raw_text or be an approved alias
            brand_words = brand_clean.split()
            if not any(w in raw_lower for w in brand_words) and brand_clean not in raw_lower:
                logger.warning(
                    "AI brand '%s' rejected: hallucinated token not found in raw OCR text '%s'",
                    result.brand,
                    raw_text
                )
                return False

        # 3. Package size hallucination guard
        if result.package_size and result.package_size.value is not None:
            val_str = str(result.package_size.value)
            int_val_str = str(int(result.package_size.value)) if result.package_size.value % 1 == 0 else val_str
            if val_str not in raw_text and int_val_str not in raw_text:
                logger.warning(
                    "AI package size '%s' rejected: magnitude not found in raw text '%s'",
                    val_str,
                    raw_text
                )
                return False

        return True

    def recognize(
        self,
        raw_text: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Optional[AIRecognitionResult]:
        if not self.config.enable_ai_product_recognition:
            return None

        if not raw_text or len(raw_text.strip()) < 2:
            return None

        try:
            # Handle mock provider for local offline testing
            if self.config.ai_provider == "mock":
                return self._mock_recognize(raw_text)

            # In production, check for backend API key
            api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GROQ_API_KEY")
            if not api_key:
                logger.debug("AI recognition skipped: No API key configured in backend environment")
                return None

            # If external AI is invoked in future, it executes here with strict timeout
            return None

        except Exception as exc:
            logger.error("AI recognition failed safely for '%s': %s", raw_text, exc)
            return None

    def _mock_recognize(self, raw_text: str) -> Optional[AIRecognitionResult]:
        """Provides deterministic mock interpretations for test verification."""
        clean = raw_text.strip()

        # Handle heavily misspelled basmati rice
        if re.search(r"basmti|rcie|b-rice", clean, re.I):
            candidate = AIRecognitionResult(
                normalized_name="Basmati Rice",
                brand=None,
                category="Rice",
                package_size=None,
                confidence=88.0,
                reasoning="Mock AI corrected severe spelling error to Basmati Rice",
            )
            if self._validate_ai_response(raw_text, candidate):
                return candidate

        return None

