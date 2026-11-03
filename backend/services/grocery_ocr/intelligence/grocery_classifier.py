"""
Grocery taxonomy classification interface and base implementation.
Identifies retail grocery products, categories, brands, and package sizes while flagging non-grocery items.
Supports granular confidence scoring and auditable classification explanations for Phase 5.
"""

import re
from abc import ABC, abstractmethod
from typing import List, Optional
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ClassificationError
from services.grocery_ocr.intelligence.brand_recognizer import BrandRecognizer
from services.grocery_ocr.intelligence.package_size_extractor import PackageSizeExtractor
from services.grocery_ocr.intelligence.product_normalizer import ProductNormalizer
from services.grocery_ocr.intelligence.taxonomy import (
    CATEGORY_NON_GROCERY,
    CATEGORY_OTHER_GROCERY,
    GROCERY_HSN_PREFIXES,
    GROCERY_TAXONOMY_ALIASES,
    NON_GROCERY_PATTERNS,
)
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice_item import ClassificationStatusType, PackageSize

logger = get_logger("intelligence.grocery_classifier")


class ClassificationResult(BaseModel):
    """Granular result of grocery taxonomy classification for an invoice line item."""
    is_grocery: bool = Field(default=True, description="True if item belongs to grocery retail taxonomy")
    category: str = Field(default="Other grocery products", description="Identified grocery category")
    brand: Optional[str] = Field(None, description="Identified manufacturer brand name")
    package_size: Optional[PackageSize] = Field(None, description="Extracted package size")
    raw_product_name: str = Field(default="", description="Original verbatim product text")
    normalized_product_name: str = Field(default="", description="Cleaned, standardized product title")
    status: ClassificationStatusType = Field(default="GROCERY_HIGH_CONFIDENCE", description="Taxonomy certainty status")

    # Granular confidence scores
    confidence: float = Field(default=90.0, ge=0.0, le=100.0, description="Overall classification confidence")
    name_confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Product title normalization confidence")
    brand_confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Brand detection confidence")
    package_size_confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Package size extraction confidence")
    category_confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Category classification confidence")

    explanation: str = Field(default="", description="Human-readable explanation of classification decision")
    review_reasons: List[str] = Field(default_factory=list, description="Reasons for review if ambiguous or uncertain")


class IGroceryClassifier(ABC):
    """Abstract interface for classifying items into grocery categories and identifying brands."""

    @abstractmethod
    def classify(self, item_name: str, hsn: Optional[str] = None) -> ClassificationResult:
        """
        Classifies an item title into grocery categories.

        Args:
            item_name: Extracted item name.
            hsn: Optional printed HSN / SAC code.

        Returns:
            ClassificationResult with granular metrics.

        Raises:
            ClassificationError: If taxonomy evaluation fails.
        """
        pass


class BaseGroceryClassifier(IGroceryClassifier):
    """
    Intelligent grocery taxonomy classifier.
    Combines rule-based category aliases, HSN code verification, brand recognition,
    package size extraction, and non-grocery suppression.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config
        self.brand_recognizer = BrandRecognizer(self.config)
        self.package_size_extractor = PackageSizeExtractor(self.config)
        self.product_normalizer = ProductNormalizer(self.config)

        # Precompile taxonomy regexes
        self._compiled_aliases = [
            (re.compile(pattern, re.IGNORECASE), canonical, cat)
            for pattern, canonical, cat in GROCERY_TAXONOMY_ALIASES
        ]
        self._compiled_non_grocery = [
            re.compile(pattern, re.IGNORECASE)
            for pattern in NON_GROCERY_PATTERNS
        ]

    def classify(self, item_name: str, hsn: Optional[str] = None) -> ClassificationResult:
        try:
            if not item_name or len(item_name.strip()) < 2:
                return ClassificationResult(
                    is_grocery=False,
                    category=CATEGORY_OTHER_GROCERY,
                    brand=None,
                    package_size=None,
                    raw_product_name=item_name or "",
                    normalized_product_name=item_name or "",
                    status="UNKNOWN_REVIEW_REQUIRED",
                    confidence=20.0,
                    name_confidence=30.0,
                    category_confidence=20.0,
                    explanation="Product description is missing or too short to classify",
                    review_reasons=["Product name is too short or missing"],
                )

            # Step 1: Normalize product title
            raw_name, norm_name, name_conf = self.product_normalizer.normalize(item_name)

            # Step 2: Check for Non-Grocery patterns (freight, labour, hardware, stationery)
            for non_groc_pat in self._compiled_non_grocery:
                if non_groc_pat.search(norm_name) or non_groc_pat.search(raw_name):
                    return ClassificationResult(
                        is_grocery=False,
                        category=CATEGORY_NON_GROCERY,
                        brand=None,
                        package_size=None,
                        raw_product_name=raw_name,
                        normalized_product_name=norm_name,
                        status="NON_GROCERY",
                        confidence=95.0,
                        name_confidence=name_conf,
                        category_confidence=95.0,
                        explanation=f"Item matched non-grocery pattern '{non_groc_pat.pattern}'",
                        review_reasons=[],
                    )

            # Step 3: Extract Package Size
            pkg_size, text_after_pkg = self.package_size_extractor.extract_package_size(norm_name)
            pkg_conf = pkg_size.confidence if pkg_size else 0.0

            # Step 4: Extract Brand strictly from description
            brand, brand_conf, brand_evidence = self.brand_recognizer.recognize_brand(norm_name)

            # Step 5: Classify Category
            detected_category: Optional[str] = None
            category_conf = 0.0
            explanation_parts: List[str] = []

            # 5a. Check HSN code if available
            if hsn and len(hsn.strip()) >= 2:
                clean_hsn = re.sub(r"\D", "", hsn)
                for prefix, (cat, desc) in GROCERY_HSN_PREFIXES.items():
                    if clean_hsn.startswith(prefix):
                        detected_category = cat
                        category_conf = 92.0
                        explanation_parts.append(f"HSN {hsn} mapped to {cat} ({desc})")
                        break

            # 5b. Match taxonomy aliases in description
            target_text = text_after_pkg if text_after_pkg else norm_name
            for pat, canonical_name, cat in self._compiled_aliases:
                if pat.search(target_text) or pat.search(norm_name):
                    detected_category = cat
                    category_conf = max(category_conf, 90.0)
                    explanation_parts.append(f"Matched keyword '{pat.pattern}' in category '{cat}'")
                    break

            # 5c. If not matched by alias, check if brand provides strong category context
            if not detected_category:
                if brand in ("Aashirvaad", "Rajdhani"):
                    detected_category = "Atta"
                    category_conf = 70.0
                elif brand in ("Fortune", "Gemini", "Saffola", "Dhara"):
                    detected_category = "Cooking oils"
                    category_conf = 70.0
                elif brand in ("India Gate", "Daawat", "Kohinoor"):
                    detected_category = "Rice"
                    category_conf = 70.0
                elif brand in ("Everest", "MDH", "Catch"):
                    detected_category = "Spices"
                    category_conf = 70.0
                elif brand in ("Parle", "Britannia"):
                    detected_category = "Biscuits"
                    category_conf = 70.0
                elif brand in ("Tata",) and "salt" in norm_name.lower():
                    detected_category = "Salt"
                    category_conf = 95.0

            # 5d. Final fallback
            if not detected_category:
                detected_category = CATEGORY_OTHER_GROCERY
                category_conf = 45.0
                explanation_parts.append("No specific category pattern matched; defaulted to Other grocery")

            # Step 6: Determine 4-tier Classification Status
            review_reasons: List[str] = []
            if category_conf >= self.config.category_confidence_threshold:
                status: ClassificationStatusType = "GROCERY_HIGH_CONFIDENCE"
            elif category_conf >= 50.0 or brand is not None:
                status = "GROCERY_REVIEW_REQUIRED"
                review_reasons.append("Category confidence is moderate or requires confirmation")
            else:
                status = "UNKNOWN_REVIEW_REQUIRED"
                review_reasons.append("Low taxonomy confidence; unfamiliar product description")

            if brand:
                explanation_parts.insert(0, f"Detected brand '{brand}' ({brand_conf:.1f}%)")
            if pkg_size:
                explanation_parts.append(f"Detected pack size {pkg_size.raw_text}")

            explanation = "; ".join(explanation_parts)

            overall_confidence = round(
                (name_conf * 0.3) + (category_conf * 0.4) + (max(brand_conf, 50.0) * 0.3),
                1
            )

            return ClassificationResult(
                is_grocery=True,
                category=detected_category,
                brand=brand,
                package_size=pkg_size,
                raw_product_name=raw_name,
                normalized_product_name=norm_name,
                status=status,
                confidence=overall_confidence,
                name_confidence=name_conf,
                brand_confidence=brand_conf,
                package_size_confidence=pkg_conf,
                category_confidence=category_conf,
                explanation=explanation,
                review_reasons=review_reasons,
            )

        except Exception as exc:
            logger.error("Grocery classification failed for '%s': %s", item_name, exc)
            raise ClassificationError(f"Classification failed: {exc}", details={"item_name": item_name})
