"""
Abstract base class defining the AI provider interface for ShopPulse OCR.
Provides extensible hooks for Mock, Google Gemini, and Groq LLMs.
"""

from abc import ABC, abstractmethod
from typing import Optional

from services.grocery_ocr.ai.schemas import (
    AIHeaderSuggestionRequest,
    AIHeaderSuggestionResponse,
    AIProductSuggestionRequest,
    AIProductSuggestionResponse,
)


class IAIProvider(ABC):
    """Abstract interface for an AI inference provider."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Name of the provider (e.g. 'mock', 'gemini', 'groq')."""
        pass

    @property
    @abstractmethod
    def model_identifier(self) -> str:
        """Identifier of the specific model (e.g. 'gemini-1.5-flash', 'mock-v1')."""
        pass

    @abstractmethod
    def suggest_product(
        self,
        request: AIProductSuggestionRequest,
        timeout_seconds: float = 5.0
    ) -> Optional[AIProductSuggestionResponse]:
        """Generates structured normalization, brand, and category suggestion for a grocery line item."""
        pass

    @abstractmethod
    def suggest_header(
        self,
        request: AIHeaderSuggestionRequest,
        timeout_seconds: float = 5.0
    ) -> Optional[AIHeaderSuggestionResponse]:
        """Resolves ambiguous invoice column headers to standardized table roles."""
        pass

