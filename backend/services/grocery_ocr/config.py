"""
Configuration settings for the ShopPulse Grocery OCR Engine.
Manages file limits, decimal precision rules, confidence thresholds, and pipeline options.
"""

from decimal import Decimal
from typing import Any, Optional, Set, Tuple
from pydantic import BaseModel, Field


class GroceryOCRConfig(BaseModel):
    """Configuration settings for grocery OCR processing."""

    # File validation
    max_file_size_bytes: int = Field(
        default=25 * 1024 * 1024,  # 25 MB
        description="Maximum allowed invoice file size in bytes"
    )
    supported_extensions: Set[str] = Field(
        default_factory=lambda: {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".txt"},
        description="Permitted file extensions for invoice processing"
    )
    supported_mime_types: Set[str] = Field(
        default_factory=lambda: {
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/bmp",
            "image/tiff",
        },
        description="Permitted MIME types for invoice processing"
    )

    # Financial & Numeric precision
    currency_decimal_places: int = 2
    quantity_decimal_places: int = 3
    currency_quantize_exp: Decimal = Decimal("0.01")
    quantity_quantize_exp: Decimal = Decimal("0.001")

    # OCR Engine settings
    default_dpi: int = 300
    default_ocr_psm: str = "3"  # Fully automatic page segmentation
    fallback_ocr_psm: str = "6"  # Single uniform block of text
    default_ocr_languages: str = "eng+hin+tel+tam+kan"
    ocr_timeout_seconds: int = 45

    # Confidence scoring thresholds
    high_confidence_threshold: float = 85.0
    medium_confidence_threshold: float = 60.0
    brand_confidence_threshold: float = 75.0
    category_confidence_threshold: float = 75.0
    catalogue_match_threshold: float = 0.85

    # Grocery taxonomy & packaging
    default_category: str = "Groceries"
    known_grocery_units: Tuple[str, ...] = (
        "kg", "g", "gm", "gms", "l", "ltr", "ml", "pcs", "pkt", "box", "bag", "bor", "tin", "can", "pet"
    )

    # Intelligence & AI Recognition settings (Phase 5 & 8)
    enable_ai_product_recognition: bool = True
    enable_ai_assistant: bool = True
    ai_provider: str = "mock"  # "mock" | "gemini" | "groq" | "disabled"
    ai_timeout_seconds: int = 5
    ai_confidence_threshold: float = 75.0
    ai_max_retries: int = 1
    ai_cache_enabled: bool = True
    ai_cache_max_size: int = 1000
    ai_rate_limit_cooldown_seconds: float = 60.0

    # Feature flags for Phase 3 & beyond
    enable_multilingual_ocr: bool = True
    enable_external_mrp_lookup: bool = False
    debug_dir: Optional[Any] = Field(
        default=None,
        description="Optional directory path to persist intermediate preprocessed images for debugging"
    )
    enable_xlsx_roundtrip_validation: bool = True


# Global default configuration instance
default_config = GroceryOCRConfig()
