"""
OpenMRP API Client Module.
Securely interfaces with the OpenMRP manufacturing REST API (https://api.openmrp.ai).

CRITICAL SECURITY RULES:
- Never log or expose raw Bearer tokens or API keys.
- Never return API keys in API responses or frontend payloads.
- Always use HTTPS with strict TLS certificate verification (verify=True).
- Redact authorization headers from all error messages.
"""

import logging
import re
import time
from typing import Dict, Any, Optional, List, Tuple
import httpx

from core.config import settings

logger = logging.getLogger(__name__)

OPENMRP_BASE_URL = "https://api.openmrp.ai"
DEFAULT_TIMEOUT_SECONDS = 5.0
CACHE_TTL_SECONDS = 300  # 5 minutes in-memory cache


def redact_secrets(text: str) -> str:
    """Redacts bearer tokens and API keys from error messages and logs."""
    if not text:
        return ""
    # Redact Authorization header values
    cleaned = re.sub(r'(Bearer\s+)[A-Za-z0-9_\-\.]+', r'\1[REDACTED]', text, flags=re.IGNORECASE)
    # Redact mrp_sk_* tokens
    cleaned = re.sub(r'mrp_sk_(?:test|prod)_[A-Za-z0-9]+', '[REDACTED_OPENMRP_KEY]', cleaned)
    return cleaned


class OpenMRPClient:
    """
    HTTP client for the OpenMRP REST API.
    Designed for server-side use only within FastAPI.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        account_id: Optional[str] = None,
        base_url: str = OPENMRP_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS
    ):
        self._api_key = api_key or settings.OPENMRP_API_KEY
        self._account_id = account_id or settings.OPENMRP_ACCOUNT_ID
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._cache: Dict[str, Tuple[float, Any]] = {}

    @property
    def is_configured(self) -> bool:
        """Returns True if an API key has been supplied in the backend configuration."""
        return bool(self._api_key and self._api_key.strip())

    def _get_headers(self) -> Dict[str, str]:
        """Constructs headers for OpenMRP requests."""
        if not self._api_key:
            raise ValueError("OpenMRP API key is not configured in backend environment.")

        headers = {
            "Authorization": f"Bearer {self._api_key.strip()}",
            "Accept": "application/json",
            "User-Agent": "ShopPulse-Backend/1.0",
        }
        if self._account_id:
            headers["OpenMRP-Account"] = self._account_id.strip()
        return headers

    def search_products(self, query: str, limit: int = 10) -> Dict[str, Any]:
        """
        Searches products in the OpenMRP account catalog using the official endpoint:
        GET /v1/catalog/products?q={query}&limit={limit}
        
        Note: OpenMRP is a Material Requirements Planning platform.
        Products in OpenMRP belong to the account's manufacturing catalog and include
        manufacturing unit costs and unit values. OpenMRP does NOT provide Indian statutory
        Maximum Retail Price (MRP).
        """
        if not self.is_configured:
            return {
                "success": False,
                "error": "OPENMRP_NOT_CONFIGURED",
                "message": "OpenMRP API key is not configured.",
                "items": []
            }

        cache_key = f"search:{query.strip().lower()}:{limit}"
        now = time.time()
        if cache_key in self._cache:
            cached_time, cached_data = self._cache[cache_key]
            if now - cached_time < CACHE_TTL_SECONDS:
                return cached_data

        url = f"{self._base_url}/v1/catalog/products"
        params = {"q": query.strip(), "limit": min(limit, 50)}

        try:
            with httpx.Client(timeout=self._timeout, verify=True) as client:
                response = client.get(url, headers=self._get_headers(), params=params)
                
                if response.status_code == 200:
                    data = response.json()
                    # OpenMRP returns { data: [...], ... }
                    raw_items = data.get("data", [])
                    parsed_items = []
                    for p in raw_items:
                        item_details = p.get("item") or {}
                        unit_cost_obj = item_details.get("unit_cost") or {}
                        unit_val_obj = item_details.get("unit_value") or {}
                        parsed_items.append({
                            "id": p.get("id"),
                            "sku": item_details.get("sku"),
                            "name": item_details.get("description") or item_details.get("sku") or p.get("id"),
                            "type": p.get("type"),
                            "unit_cost": unit_cost_obj.get("rate") if isinstance(unit_cost_obj, dict) else None,
                            "unit_value": unit_val_obj.get("rate") if isinstance(unit_val_obj, dict) else None,
                            "mrp": None,  # OpenMRP does NOT provide Indian retail MRP
                            "source": "OPENMRP_CATALOG"
                        })
                    
                    result = {
                        "success": True,
                        "total": len(parsed_items),
                        "items": parsed_items
                    }
                    self._cache[cache_key] = (now, result)
                    return result

                elif response.status_code == 401:
                    logger.warning("OpenMRP authentication failed (HTTP 401). Check OPENMRP_API_KEY.")
                    return {
                        "success": False,
                        "error": "AUTHENTICATION_FAILED",
                        "message": "Authentication with OpenMRP failed. Check backend credentials.",
                        "items": []
                    }
                elif response.status_code == 429:
                    logger.warning("OpenMRP rate limit exceeded (HTTP 429).")
                    return {
                        "success": False,
                        "error": "RATE_LIMITED",
                        "message": "OpenMRP API rate limit reached.",
                        "items": []
                    }
                else:
                    safe_msg = redact_secrets(response.text)
                    logger.warning(f"OpenMRP returned status {response.status_code}: {safe_msg}")
                    return {
                        "success": False,
                        "error": f"HTTP_{response.status_code}",
                        "message": f"OpenMRP returned HTTP {response.status_code}.",
                        "items": []
                    }

        except httpx.TimeoutException:
            logger.warning("OpenMRP request timed out.")
            return {
                "success": False,
                "error": "TIMEOUT",
                "message": "OpenMRP API request timed out.",
                "items": []
            }
        except httpx.RequestError as exc:
            safe_err = redact_secrets(str(exc))
            logger.warning(f"OpenMRP connection error: {safe_err}")
            return {
                "success": False,
                "error": "CONNECTION_ERROR",
                "message": "Could not connect to OpenMRP API.",
                "items": []
            }
        except Exception as exc:
            safe_err = redact_secrets(str(exc))
            logger.error(f"Unexpected error communicating with OpenMRP: {safe_err}")
            return {
                "success": False,
                "error": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during OpenMRP lookup.",
                "items": []
            }


# Singleton client instance
openmrp_client = OpenMRPClient()
