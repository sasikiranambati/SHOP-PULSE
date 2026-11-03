"""
AI-assisted invoice interpretation and intelligent validation subsystem for ShopPulse Grocery OCR.
"""

from services.grocery_ocr.ai.cache import ProductNormalizationCache
from services.grocery_ocr.ai.providers.base import IAIProvider
from services.grocery_ocr.ai.providers.gemini_provider import GeminiAIProvider
from services.grocery_ocr.ai.providers.groq_provider import GroqAIProvider
from services.grocery_ocr.ai.providers.mock_provider import MockAIProvider
from services.grocery_ocr.ai.schemas import (
    AIAuditEntry,
    AIHeaderSuggestionRequest,
    AIHeaderSuggestionResponse,
    AIProductSuggestionRequest,
    AIProductSuggestionResponse,
    AITelemetry,
)
from services.grocery_ocr.ai.service import AIInterpretationService

__all__ = [
    "AIInterpretationService",
    "IAIProvider",
    "MockAIProvider",
    "GeminiAIProvider",
    "GroqAIProvider",
    "ProductNormalizationCache",
    "AIProductSuggestionRequest",
    "AIProductSuggestionResponse",
    "AIHeaderSuggestionRequest",
    "AIHeaderSuggestionResponse",
    "AIAuditEntry",
    "AITelemetry",
]

