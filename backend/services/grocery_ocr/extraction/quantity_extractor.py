"""
Quantity and unit extraction interface and implementation.
Extracts invoice billed quantities and units strictly from designated table columns.
Guarantees that package sizes (e.g. 50 KG in 'CHANA 50 KG') are NEVER confused with invoice quantities.
Never substitutes missing quantities with zero or one.
"""

import re
from abc import ABC, abstractmethod
from decimal import Decimal
from typing import List, Optional, Tuple
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ExtractionError
from services.grocery_ocr.extraction.numeric_parser import NumericParser
from services.grocery_ocr.extraction.unit_normalizer import UnitNormalizer
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.table import DetectedColumn, TableRow

logger = get_logger("extraction.quantity_extractor")


class QuantityExtractionResult(BaseModel):
    """Detailed result of extracting quantity and measurement unit from an invoice row."""
    quantity: Optional[Decimal] = Field(None, description="Purchased quantity as Decimal")
    raw_quantity: Optional[str] = Field(None, description="Original verbatim text from quantity cell")
    unit: Optional[str] = Field(None, description="Normalized measurement unit (e.g. PCS, KG, BOR)")
    raw_unit: Optional[str] = Field(None, description="Original verbatim text from unit cell")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Extraction confidence score")
    issues: List[str] = Field(default_factory=list, description="Audit issues or warnings during extraction")


class IQuantityExtractor(ABC):
    """Abstract interface for extracting purchased quantity and units."""

    @abstractmethod
    def extract_quantity(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> Tuple[Optional[Decimal], Optional[str]]:
        """
        Extracts quantity and unit from a row.

        Returns:
            Tuple of (quantity as Decimal or None, unit string or None).
            NEVER substitutes None with 0 or 1.
        """
        pass

    @abstractmethod
    def extract_quantity_detailed(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> QuantityExtractionResult:
        """
        Extracts full audit details for quantity and unit extraction.
        """
        pass


class BaseQuantityExtractor(IQuantityExtractor):
    """
    Standard quantity and unit extractor.
    Enforces strict None preservation for missing quantities and maintains distinction
    between package size in product titles and invoice billing quantities.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config
        self.numeric_parser = NumericParser(self.config)
        self.unit_normalizer = UnitNormalizer(self.config)

    def extract_quantity(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> Tuple[Optional[Decimal], Optional[str]]:
        res = self.extract_quantity_detailed(row, columns)
        return res.quantity, res.unit

    def extract_quantity_detailed(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> QuantityExtractionResult:
        try:
            qty_cols = [c for c in columns if c.role == "qty"]
            qty_col = next((c for c in qty_cols if any(k in (c.header_text or "").lower() for k in ["qty", "quant", "qnty"])), qty_cols[0] if qty_cols else None)
            unit_col = next((c for c in columns if c.role == "unit"), None)

            raw_qty_text: Optional[str] = None
            raw_unit_text: Optional[str] = None
            inline_unit_text: Optional[str] = None
            issues: List[str] = []
            confidence = 100.0

            # 1. Read quantity from designated column
            if qty_col is not None and qty_col.column_index < len(row.cells):
                cell_text = row.cells[qty_col.column_index].cleaned_text.strip()
                raw_qty_text = cell_text

                # Check if cell has combined qty and unit: e.g. '1 BOR', '10 PCS', '0.5 KG'
                m_inline = re.match(r"^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$", cell_text)
                if m_inline:
                    qty_num_str = m_inline.group(1)
                    inline_unit_text = m_inline.group(2)
                    parsed_num = self.numeric_parser.parse_quantity(qty_num_str)
                else:
                    parsed_num = self.numeric_parser.parse_quantity(cell_text)

                qty_val = parsed_num.value
                confidence = min(confidence, parsed_num.confidence)
                issues.extend(parsed_num.issues)
            else:
                qty_val = None
                confidence = 0.0
                issues.append("No quantity column detected or cell is out of range")

            # 2. Read unit from designated column
            if unit_col is not None and unit_col.column_index < len(row.cells):
                u_text = row.cells[unit_col.column_index].cleaned_text.strip()
                raw_unit_text = u_text
                norm_u = self.unit_normalizer.normalize(u_text)
                final_unit = norm_u.normalized_unit
            elif inline_unit_text:
                raw_unit_text = inline_unit_text
                norm_u = self.unit_normalizer.normalize(inline_unit_text)
                final_unit = norm_u.normalized_unit
            else:
                final_unit = None

            return QuantityExtractionResult(
                quantity=qty_val,
                raw_quantity=raw_qty_text,
                unit=final_unit,
                raw_unit=raw_unit_text,
                confidence=confidence,
                issues=issues,
            )

        except Exception as exc:
            logger.error("Quantity extraction failed on row %d: %s", row.row_index, exc)
            raise ExtractionError(f"Failed to extract quantity: {exc}", details={"row": row.row_index})
