"""
Thread-safe LRU cache for safe, reusable product description normalizations.
Guarantees fast retrieval, reduces redundant AI calls, and strictly avoids caching sensitive invoice data.
"""

from collections import OrderedDict
import hashlib
import threading
from typing import Optional

from services.grocery_ocr.ai.schemas import AIProductSuggestionResponse
from services.grocery_ocr.logger import get_logger

logger = get_logger("ai.cache")


class ProductNormalizationCache:
    """
    In-memory LRU cache storing approved AI product suggestions.
    Keys are canonicalized hashes of product descriptions.
    Values are pure product domain intelligence (never prices, quantities, or invoices).
    """

    def __init__(self, max_size: int = 1000):
        self.max_size = max_size
        self._cache: OrderedDict[str, AIProductSuggestionResponse] = OrderedDict()
        self._lock = threading.Lock()

    def _normalize_key(self, text: str) -> str:
        """Computes a deterministic hash for trimmed, lowercase text."""
        cleaned = " ".join(text.strip().lower().split())
        return hashlib.sha256(cleaned.encode("utf-8")).hexdigest()

    def get(self, text: str) -> Optional[AIProductSuggestionResponse]:
        """Retrieves a cached suggestion if present."""
        if not text:
            return None
        key = self._normalize_key(text)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                logger.debug("AI cache hit for description: '%s'", text)
                return self._cache[key]
        return None

    def set(self, text: str, response: AIProductSuggestionResponse) -> None:
        """Stores an approved suggestion, evicting the oldest entry if capacity is exceeded."""
        if not text or not response:
            return
        key = self._normalize_key(text)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            else:
                if len(self._cache) >= self.max_size:
                    self._cache.popitem(last=False)
            self._cache[key] = response
            logger.debug("AI cache stored suggestion for: '%s'", text)

    def clear(self) -> None:
        """Clears all entries in the cache."""
        with self._lock:
            self._cache.clear()

    def __bool__(self) -> bool:
        """Cache instance is always considered truthy even when empty."""
        return True

    def __len__(self) -> int:
        with self._lock:
            return len(self._cache)
