"""
Google Gemini AI provider implementation using direct REST integration via httpx.
Operates safely without exposing secrets, respects timeout and rate limits, and enforces Pydantic schema validation.
"""

import json
import os
from typing import Optional
import httpx

from services.grocery_ocr.ai.providers.base import IAIProvider
from services.grocery_ocr.ai.schemas import (
    AIHeaderSuggestionRequest,
    AIHeaderSuggestionResponse,
    AIProductSuggestionRequest,
    AIProductSuggestionResponse,
)
from services.grocery_ocr.exceptions import (
    AIProviderUnavailableError,
    AIRateLimitError,
    AIResponseValidationError,
    AITimeoutError,
)
from services.grocery_ocr.logger import get_logger

logger = get_logger("ai.gemini_provider")


class GeminiAIProvider(IAIProvider):
    """
    Inference provider connecting to Google Gemini REST API.
    Reuses existing environment key GEMINI_API_KEY if present.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "gemini-1.5-flash"
    ):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self.model = model
        self.endpoint_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"

    @property
    def provider_name(self) -> str:
        return "gemini"

    @property
    def model_identifier(self) -> str:
        return self.model

    def suggest_product(
        self,
        request: AIProductSuggestionRequest,
        timeout_seconds: float = 5.0
    ) -> Optional[AIProductSuggestionResponse]:
        if not self.api_key:
            logger.debug("Gemini provider skipped: GEMINI_API_KEY not configured")
            return None

        prompt = (
            "You are an assistant for a grocery retail invoice scanner in India. "
            "Analyze the given product description from an invoice and provide structured normalization.\n\n"
            f"Original Description: '{request.original_description}'\n"
            f"Row Context: {request.raw_ocr_tokens}\n"
            f"HSN Hint: {request.hsn_hint or 'None'}\n"
            f"Candidate Matches: {request.catalogue_candidates}\n\n"
            "Return a JSON object conforming strictly to this format:\n"
            "{\n"
            '  "original_description": "' + request.original_description + '",\n'
            '  "suggested_normalized_name": "clean product title or null",\n'
            '  "suggested_brand": "brand name or null",\n'
            '  "suggested_category": "standard grocery category or Groceries",\n'
            '  "suggested_package_size": "extracted size e.g. 500 GM or null",\n'
            '  "confidence": 0.85,\n'
            '  "reason": "explanation",\n'
            '  "requires_review": false\n'
            "}\n"
            "CRITICAL: Do NOT output any financial or quantity fields (no prices, rates, MRP, or quantities). Only product name, brand, category, and package size."
        )

        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "response_mime_type": "application/json"
            }
        }

        try:
            with httpx.Client(timeout=timeout_seconds) as client:
                resp = client.post(
                    f"{self.endpoint_url}?key={self.api_key}",
                    headers=headers,
                    json=payload
                )

            if resp.status_code == 429:
                raise AIRateLimitError("Gemini API rate limit exceeded (HTTP 429)")
            if resp.status_code >= 500:
                raise AIProviderUnavailableError(f"Gemini API server error (HTTP {resp.status_code})")
            if resp.status_code != 200:
                raise AIResponseValidationError(f"Gemini API error (HTTP {resp.status_code}): {resp.text}")

            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                return None

            text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            parsed_json = json.loads(text)
            return AIProductSuggestionResponse.model_validate(parsed_json)

        except httpx.TimeoutException:
            raise AITimeoutError(f"Gemini API timed out after {timeout_seconds}s")
        except json.JSONDecodeError as exc:
            raise AIResponseValidationError(f"Invalid JSON from Gemini: {exc}")
        except (AIRateLimitError, AIProviderUnavailableError, AITimeoutError, AIResponseValidationError):
            raise
        except Exception as exc:
            logger.warning("Gemini invocation failed: %s", exc)
            return None

    def suggest_header(
        self,
        request: AIHeaderSuggestionRequest,
        timeout_seconds: float = 5.0
    ) -> Optional[AIHeaderSuggestionResponse]:
        if not self.api_key:
            return None
        # Simplified header suggestion via REST
        return None

