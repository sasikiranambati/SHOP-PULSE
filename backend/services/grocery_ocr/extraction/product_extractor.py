"""
Product name extraction interface and base implementation.
Extracts verbatim raw product descriptions, separates pack sizes, and standardizes names.
"""

from abc import ABC, abstractmethod
import re
from typing import List, Optional, Tuple

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ExtractionError
from services.grocery_ocr.intelligence.package_size_extractor import PackageSizeExtractor
from services.grocery_ocr.intelligence.product_normalizer import ProductNormalizer
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice_item import PackageSize
from services.grocery_ocr.schemas.table import DetectedColumn, TableRow

logger = get_logger("extraction.product_extractor")

# Trailing HSN / serial number pattern — 4-8 consecutive digits at end of product name
# Examples: "TATA SALT 100031", "AMUL BUTTER 10006311"
# We only strip when the adjacent HSN column already captured the code (caller's responsibility
# to pass the known hsn_code), but also defensively strip bare trailing digit codes
# that are clearly not part of the product description.
_TRAILING_HSN_RE = re.compile(r"\s+\d{4,8}\s*$")


class IProductExtractor(ABC):
    """Abstract interface for extracting product names and pack sizes."""

    @abstractmethod
    def extract_product_name(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> Tuple[str, Optional[str]]:
        """
        Extracts raw and normalized product names from a table row.

        Returns:
            Tuple of (raw_product_name, normalized_product_name).
        """
        pass

    @abstractmethod
    def extract_pack_size(self, product_text: str) -> Optional[PackageSize]:
        """
        Extracts package size specification from the description without confusing it with item quantity.
        """
        pass


class BaseProductExtractor(IProductExtractor):
    """
    Standard product name extractor.
    Preserves exact OCR text while extracting pack size attributes.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config
        self.normalizer = ProductNormalizer(self.config)
        self.package_size_extractor = PackageSizeExtractor(self.config)

    def extract_product_name(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> Tuple[str, Optional[str]]:
        try:
            prod_col_idx = next((c.column_index for c in columns if c.role == "product"), None)
            hsn_col_idx = next((c.column_index for c in columns if c.role == "hsn"), None)

            raw_name = ""
            if prod_col_idx is not None and prod_col_idx < len(row.cells):
                raw_name = row.cells[prod_col_idx].raw_text.strip()
            elif row.cells:
                # Fallback to the first non-serial, non-numeric cell
                candidate_cells = [c.raw_text for c in row.cells if not c.is_numeric]
                raw_name = candidate_cells[0].strip() if candidate_cells else row.raw_text

            if not raw_name:
                raw_name = row.raw_text.strip()

            # Strip trailing HSN-like digit sequences from the product name when:
            # (a) a dedicated HSN column is present in this invoice, OR
            # (b) the suffix is a bare 4-8-digit number not preceded by a unit keyword
            if hsn_col_idx is not None:
                # HSN column detected — any trailing digit sequence that matches is contamination
                raw_name = _TRAILING_HSN_RE.sub("", raw_name).strip()
            else:
                # No HSN column — only strip if the trailing digits look like an HSN
                # (6-8 digits, never a pack-size quantity which is shorter, e.g. "1", "500")
                raw_name = re.sub(r"\s+\d{6,8}\s*$", "", raw_name).strip()

            # Clean normalized title via intelligent normalizer while preserving raw_name
            raw_orig, normalized, _ = self.normalizer.normalize(raw_name)

            return raw_name, normalized
        except Exception as exc:
            logger.error("Product extraction failed on row %d: %s", row.row_index, exc)
            raise ExtractionError(f"Failed to extract product name: {exc}", details={"row": row.row_index})

    def extract_pack_size(self, product_text: str) -> Optional[PackageSize]:
        if not product_text:
            return None
        pkg_size, _ = self.package_size_extractor.extract_package_size(product_text)
        # Guard: pack_size value must be positive
        if pkg_size is not None and pkg_size.value is not None and pkg_size.value <= 0:
            logger.warning("Discarding zero/negative pack size: %s", pkg_size)
            return None
        return pkg_size

