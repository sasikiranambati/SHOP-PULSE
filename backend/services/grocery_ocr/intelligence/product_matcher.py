"""
Product inventory matching interface and base implementation.
Maps extracted invoice lines to existing store inventory using conservative multi-signal validation.
Strictly rejects cross-matching across different brands or conflicting package sizes.
"""

import difflib
import re
from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Any, List, Optional, Sequence
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ProductMatchingError
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice_item import PackageSize, ProductMatchResult

logger = get_logger("intelligence.product_matcher")


def _get_field(obj: Any, key: str, default: Any = None) -> Any:
    """Safely retrieves a field from either an object attribute or dict key."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


class IProductMatcher(ABC):
    """Abstract interface for matching invoice line items to inventory products."""

    @abstractmethod
    def match_product(
        self,
        product_name: str,
        barcode: Optional[str] = None,
        candidate_pool: Optional[Sequence[Any]] = None,
        brand: Optional[str] = None,
        package_size: Optional[PackageSize] = None,
    ) -> ProductMatchResult:
        """
        Finds the closest matching product in the candidate pool using conservative criteria.

        Args:
            product_name: Raw or normalized product title.
            barcode: Optional barcode / GTIN.
            candidate_pool: Sequence of inventory product entities or dicts.
            brand: Extracted manufacturer brand.
            package_size: Extracted physical package size.

        Returns:
            ProductMatchResult.

        Raises:
            ProductMatchingError: If matching evaluation fails.
        """
        pass


class BaseProductMatcher(IProductMatcher):
    """
    Conservative store inventory matcher.
    Ensures that items with conflicting brands or package sizes never merge into the same catalogue SKU.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    def _normalize_tokens(self, text: str) -> set[str]:
        """Tokenizes text into a set of alphanumeric lowercase words."""
        if not text:
            return set()
        clean = re.sub(r"[^a-zA-Z0-9\s]", " ", text.lower())
        return {w for w in clean.split() if len(w) > 1}

    def _calculate_similarity(self, s1: str, s2: str) -> float:
        """Computes combined token overlap and sequence ratio similarity between 0.0 and 1.0."""
        if not s1 or not s2:
            return 0.0
        s1_clean = re.sub(r"\s+", " ", s1.strip().lower())
        s2_clean = re.sub(r"\s+", " ", s2.strip().lower())
        if s1_clean == s2_clean:
            return 1.0

        seq_ratio = difflib.SequenceMatcher(None, s1_clean, s2_clean).ratio()

        tokens1 = self._normalize_tokens(s1)
        tokens2 = self._normalize_tokens(s2)
        if not tokens1 or not tokens2:
            return seq_ratio

        jaccard = len(tokens1 & tokens2) / len(tokens1 | tokens2)
        # Weighted blend
        return (seq_ratio * 0.4) + (jaccard * 0.6)

    def _is_size_compatible(self, q_size: Optional[PackageSize], cand_size_raw: Any) -> bool:
        """
        Verifies package size compatibility between extracted size and catalogue size.
        If both have package sizes specified, they MUST match in value and unit.
        """
        if not q_size or not cand_size_raw:
            # If one side doesn't specify package size, do not strictly reject solely on size
            return True

        if isinstance(cand_size_raw, PackageSize):
            c_val = cand_size_raw.value
            c_unit = (cand_size_raw.unit or "").lower()
        elif isinstance(cand_size_raw, dict):
            c_val = cand_size_raw.get("value")
            c_unit = str(cand_size_raw.get("unit") or "").lower()
        else:
            # Try to parse string e.g. "1 L", "500 g"
            cand_str = str(cand_size_raw).strip().lower()
            m = re.search(r"(\d+(?:\.\d+)?)\s*([a-zA-Z]+)", cand_str)
            if m:
                c_val = Decimal(m.group(1))
                c_unit = m.group(2)
            else:
                return True

        if q_size.value is not None and c_val is not None:
            try:
                if Decimal(str(q_size.value)) != Decimal(str(c_val)):
                    return False
            except Exception:
                pass

        if q_size.unit and c_unit:
            # Compare normalized unit initials
            q_u = q_size.unit.lower()
            if q_u != c_unit and not (q_u.startswith("g") and c_unit.startswith("g")) and not (q_u.startswith("k") and c_unit.startswith("k")):
                return False

        return True

    def match_product(
        self,
        product_name: str,
        barcode: Optional[str] = None,
        candidate_pool: Optional[Sequence[Any]] = None,
        brand: Optional[str] = None,
        package_size: Optional[PackageSize] = None,
    ) -> ProductMatchResult:
        try:
            if not candidate_pool or not product_name:
                return ProductMatchResult(
                    matched_product_id=None,
                    matched_product_name=None,
                    similarity_score=0.0,
                    match_confidence=0.0,
                    match_method="NO_MATCH",
                    match_explanation="No catalogue candidates provided or empty product name",
                    review_status="NO_MATCH",
                )

            clean_name = product_name.strip().lower()
            target_brand = brand.strip().lower() if brand else None

            # 1. Barcode / GTIN Exact Match
            if barcode and len(barcode.strip()) >= 4:
                b_code = barcode.strip()
                for cand in candidate_pool:
                    cand_sku = str(_get_field(cand, "sku", "") or "").strip()
                    cand_barcode = str(_get_field(cand, "barcode", "") or "").strip()
                    if b_code in (cand_sku, cand_barcode):
                        cand_id = str(_get_field(cand, "id", ""))
                        cand_name = str(_get_field(cand, "name", ""))
                        return ProductMatchResult(
                            matched_product_id=cand_id,
                            matched_product_name=cand_name,
                            similarity_score=1.0,
                            match_confidence=100.0,
                            match_method="GTIN" if len(b_code) in (8, 12, 13, 14) else "SKU",
                            match_explanation=f"Exact barcode/SKU match with catalogue item '{cand_name}'",
                            review_status="CONFIRMED",
                        )

            best_match: Optional[Any] = None
            best_score = 0.0
            best_method = "NO_MATCH"
            best_explanation = ""

            threshold = self.config.catalogue_match_threshold

            for cand in candidate_pool:
                cand_id = str(_get_field(cand, "id", ""))
                cand_name = str(_get_field(cand, "name", "")).strip()
                cand_brand = _get_field(cand, "brand", None)
                cand_brand_str = str(cand_brand).strip().lower() if cand_brand else None
                cand_size = _get_field(cand, "package_size", _get_field(cand, "pack_size", None))

                # Conservative Constraint 1: Brand Compatibility
                # If both invoice item and candidate have brands and they conflict, REJECT match.
                if target_brand and cand_brand_str and target_brand != cand_brand_str:
                    continue

                # Conservative Constraint 2: Package Size Compatibility
                # If both specify package size and they differ, REJECT match.
                if package_size and not self._is_size_compatible(package_size, cand_size):
                    continue

                # Exact Name Match
                if clean_name == cand_name.lower():
                    return ProductMatchResult(
                        matched_product_id=cand_id,
                        matched_product_name=cand_name,
                        similarity_score=1.0,
                        match_confidence=98.0,
                        match_method="EXACT_NAME_BRAND_SIZE",
                        match_explanation=f"Exact name match with compatible brand '{brand}' and package size",
                        review_status="CONFIRMED",
                    )

                # Fuzzy Name Similarity
                score = self._calculate_similarity(clean_name, cand_name)
                if score > best_score:
                    best_score = score
                    best_match = cand

            # Evaluate best fuzzy candidate against threshold
            if best_match and best_score >= threshold:
                cand_id = str(_get_field(best_match, "id", ""))
                cand_name = str(_get_field(best_match, "name", ""))
                confidence = round(best_score * 100, 1)
                review_status = "CONFIRMED" if best_score >= 0.92 else "REVIEW_REQUIRED"
                explanation = (
                    f"Fuzzy match ({best_score:.2f}) with compatible brand and packaging. "
                    f"Matched '{product_name}' to catalogue '{cand_name}'."
                )

                return ProductMatchResult(
                    matched_product_id=cand_id,
                    matched_product_name=cand_name,
                    similarity_score=round(best_score, 4),
                    match_confidence=confidence,
                    match_method="FUZZY_NAME_BRAND_SIZE",
                    match_explanation=explanation,
                    review_status=review_status,
                )

            return ProductMatchResult(
                matched_product_id=None,
                matched_product_name=None,
                similarity_score=round(best_score, 4) if best_score > 0 else 0.0,
                match_confidence=0.0,
                match_method="NO_MATCH",
                match_explanation=f"No compatible catalogue product exceeded threshold {threshold:.2f} (best score was {best_score:.2f})",
                review_status="NO_MATCH",
            )

        except Exception as exc:
            logger.error("Product matching failed for '%s': %s", product_name, exc)
            raise ProductMatchingError(f"Product matching failed: {exc}", details={"name": product_name})
