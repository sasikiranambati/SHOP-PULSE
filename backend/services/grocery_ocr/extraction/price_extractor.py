"""
Price and financial value extraction interface and implementation.
Extracts monetary rates, MRP, discounts, taxes, and printed line amounts.
Strictly relies on column roles and geometric evidence; never infers financial role from numeric magnitude.
Preserves Python Decimal throughout; never defaults missing prices to zero.
"""

from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Dict, List, Optional
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ExtractionError
from services.grocery_ocr.extraction.numeric_parser import NumericParser
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.table import DetectedColumn, TableRow

logger = get_logger("extraction.price_extractor")


class FinancialExtractionResult(BaseModel):
    """Detailed result of extracting financial values from an invoice row."""
    purchase_price: Optional[Decimal] = Field(None, description="Purchase rate per unit")
    selling_price: Optional[Decimal] = Field(None, description="Selling price per unit")
    mrp: Optional[Decimal] = Field(None, description="Maximum Retail Price (MRP)")
    discount: Optional[Decimal] = Field(None, description="Discount amount")
    discount_pct: Optional[Decimal] = Field(None, description="Discount percentage")
    tax_amount: Optional[Decimal] = Field(None, description="Tax / GST amount")
    gst_rate: Optional[Decimal] = Field(None, description="GST rate percentage")
    taxable_amount: Optional[Decimal] = Field(None, description="Taxable amount before tax")
    printed_amount: Optional[Decimal] = Field(None, description="Printed line total amount")

    # Audit & Provenance
    raw_financial_cells: Dict[str, str] = Field(default_factory=dict, description="Verbatim raw text per field")
    financial_role_confidence: Dict[str, float] = Field(default_factory=dict, description="Confidence per role assignment")
    is_ambiguous_rate: bool = Field(default=False, description="True if column was generic RATE without role clarification")
    issues: List[str] = Field(default_factory=list, description="Audit issues encountered during extraction")


class IPriceExtractor(ABC):
    """Abstract interface for extracting financial price and total fields from table rows."""

    @abstractmethod
    def extract_prices(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> Dict[str, Optional[Decimal]]:
        """
        Extracts all price columns as Decimal values.

        Returns:
            Dict containing 'purchase_price', 'selling_price', 'mrp', 'discount',
            'tax_amount', 'gst_rate', 'printed_amount', etc. Missing values are None.
        """
        pass

    @abstractmethod
    def extract_financials_detailed(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> FinancialExtractionResult:
        """
        Extracts financial values with complete audit telemetry and confidence metrics.
        """
        pass


class BasePriceExtractor(IPriceExtractor):
    """
    Standard financial extractor.
    Enforces column-role mapping safety and Decimal arithmetic.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config
        self.numeric_parser = NumericParser(self.config)

    def extract_prices(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> Dict[str, Optional[Decimal]]:
        res = self.extract_financials_detailed(row, columns)
        return {
            "purchase_price": res.purchase_price,
            "selling_price": res.selling_price,
            "mrp": res.mrp,
            "discount": res.discount,
            "discount_pct": res.discount_pct,
            "tax_amount": res.tax_amount,
            "gst_rate": res.gst_rate,
            "taxable_amount": res.taxable_amount,
            "printed_amount": res.printed_amount,
        }

    def extract_financials_detailed(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
    ) -> FinancialExtractionResult:
        try:
            result = FinancialExtractionResult()
            rate_columns = [c for c in columns if c.role in ("rate", "purchase_price")]
            is_generic_rate = any("rate" in c.header_text.lower() and "purchase" not in c.header_text.lower() for c in rate_columns)

            for col in columns:
                if col.column_index >= len(row.cells):
                    continue

                raw_cell = row.cells[col.column_index].cleaned_text.strip()
                if not raw_cell:
                    continue

                parsed = self.numeric_parser.parse_currency(raw_cell)
                if not parsed.is_valid or parsed.value is None:
                    continue

                val = parsed.value
                conf = parsed.confidence * (col.confidence / 100.0)

                if col.role in ("rate", "purchase_price") and result.purchase_price is None:
                    result.purchase_price = val
                    result.raw_financial_cells["purchase_price"] = raw_cell
                    # If inferred from generic RATE header, reflect in confidence
                    if is_generic_rate:
                        result.financial_role_confidence["purchase_price"] = min(conf, 75.0)
                        result.is_ambiguous_rate = True
                        result.issues.append("Rate column does not explicitly specify Purchase vs Selling price")
                    else:
                        result.financial_role_confidence["purchase_price"] = conf

                elif col.role == "selling_price" and result.selling_price is None:
                    result.selling_price = val
                    result.raw_financial_cells["selling_price"] = raw_cell
                    result.financial_role_confidence["selling_price"] = conf

                elif col.role == "mrp" and result.mrp is None:
                    result.mrp = val
                    result.raw_financial_cells["mrp"] = raw_cell
                    result.financial_role_confidence["mrp"] = conf

                elif col.role == "discount":
                    if col.is_percent or parsed.is_percentage or "%" in raw_cell:
                        result.discount_pct = val
                        result.raw_financial_cells["discount_pct"] = raw_cell
                        result.financial_role_confidence["discount_pct"] = conf
                    else:
                        result.discount = val
                        result.raw_financial_cells["discount"] = raw_cell
                        result.financial_role_confidence["discount"] = conf

                elif col.role == "discount_pct" and result.discount_pct is None:
                    result.discount_pct = val
                    result.raw_financial_cells["discount_pct"] = raw_cell
                    result.financial_role_confidence["discount_pct"] = conf

                elif col.role == "tax_amount" and result.tax_amount is None:
                    result.tax_amount = val
                    result.raw_financial_cells["tax_amount"] = raw_cell
                    result.financial_role_confidence["tax_amount"] = conf

                elif col.role == "gst_rate" and result.gst_rate is None:
                    result.gst_rate = val
                    result.raw_financial_cells["gst_rate"] = raw_cell
                    result.financial_role_confidence["gst_rate"] = conf

                elif col.role == "taxable" and result.taxable_amount is None:
                    result.taxable_amount = val
                    result.raw_financial_cells["taxable_amount"] = raw_cell
                    result.financial_role_confidence["taxable_amount"] = conf

                elif col.role == "total" and result.printed_amount is None:
                    result.printed_amount = val
                    result.raw_financial_cells["printed_amount"] = raw_cell
                    result.financial_role_confidence["printed_amount"] = conf

            # Reconcile faint/dropped decimal points on selling price or MRP
            if result.selling_price is not None:
                if result.mrp is not None and result.selling_price > result.mrp * 5:
                    candidate_sp = result.selling_price / Decimal("100")
                    if candidate_sp <= result.mrp * Decimal("1.2"):
                        result.selling_price = candidate_sp
                elif result.purchase_price is not None and result.selling_price > result.purchase_price * 5:
                    candidate_sp = result.selling_price / Decimal("100")
                    if candidate_sp >= result.purchase_price * Decimal("0.8") and candidate_sp <= result.purchase_price * Decimal("2.5"):
                        result.selling_price = candidate_sp

            if result.mrp is not None and result.purchase_price is not None and result.mrp > result.purchase_price * 5:
                candidate_mrp = result.mrp / Decimal("100")
                if candidate_mrp >= result.purchase_price * Decimal("0.8") and candidate_mrp <= result.purchase_price * Decimal("3.0"):
                    result.mrp = candidate_mrp

            return result

        except Exception as exc:
            logger.error("Price extraction failed on row %d: %s", row.row_index, exc)
            raise ExtractionError(f"Failed to extract prices: {exc}", details={"row": row.row_index})
