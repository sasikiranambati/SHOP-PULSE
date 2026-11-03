"""
Groq AI provider implementation using OpenAI-compatible REST endpoint.
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

logger = get_logger("ai.groq_provider")


class GroqAIProvider(IAIProvider):
    """Inference provider for Groq models (e.g. llama3-70b-8192, mixtral-8x7b-32768)."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "llama-3.1-8b-instant"
    ):
        self.api_key = api_key or os.getenv("GROQ_API_KEY")
        self.model = model
        self.endpoint_url = "https://api.groq.com/openai/v1/chat/completions"

    @property
    def provider_name(self) -> str:
        return "groq"

    @property
    def model_identifier(self) -> str:
        return self.model

    def suggest_product(
        self,
        request: AIProductSuggestionRequest,
        timeout_seconds: float = 5.0
    ) -> Optional[AIProductSuggestionResponse]:
        if not self.api_key:
            return None

        prompt = (
            "Analyze this grocery invoice line item description and output JSON with keys: "
            "original_description, suggested_normalized_name, suggested_brand, suggested_category, "
            "suggested_package_size, confidence (0.0 to 1.0), reason, requires_review.\n"
            f"Description: '{request.original_description}'\n"
            "Do not include prices, rates, or quantities."
        )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are a grocery catalog expert. Respond ONLY with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1
        }

        try:
            with httpx.Client(timeout=timeout_seconds) as client:
                resp = client.post(self.endpoint_url, headers=headers, json=payload)

            if resp.status_code == 429:
                raise AIRateLimitError("Groq rate limit exceeded (HTTP 429)")
            if resp.status_code >= 500:
                raise AIProviderUnavailableError(f"Groq server error (HTTP {resp.status_code})")
            if resp.status_code != 200:
                raise AIResponseValidationError(f"Groq API error (HTTP {resp.status_code})")

            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            parsed_json = json.loads(content)
            return AIProductSuggestionResponse.model_validate(parsed_json)

        except httpx.TimeoutException:
            raise AITimeoutError(f"Groq request timed out after {timeout_seconds}s")
        except json.JSONDecodeError as exc:
            raise AIResponseValidationError(f"Invalid JSON from Groq: {exc}")
        except (AIRateLimitError, AIProviderUnavailableError, AITimeoutError, AIResponseValidationError):
            raise
        except Exception as exc:
            logger.warning("Groq invocation error: %s", exc)
            return None

    def suggest_header(
        self,
        request: AIHeaderSuggestionRequest,
        timeout_seconds: float = 5.0
    ) -> Optional[AIHeaderSuggestionResponse]:
        return None

