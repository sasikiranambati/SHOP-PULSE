"""
Column-Wise Deterministic Extraction Engine for ShopPulse Grocery OCR (Phase 3).
Extracts line item attributes strictly column-by-column according to DocumentTableSchema
or DetectedColumn definitions. Prevents cross-column token bleeding, validates cell
data types, and ensures complete decimal financial precision.
"""

from decimal import Decimal
import re
from typing import Any, Dict, List, Optional, Tuple, Union
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ExtractionError
from services.grocery_ocr.extraction.dynamic_schema_generator import (
    DocumentTableSchema,
    DynamicColumnDefinition,
    ExpectedDataType,
)
from services.grocery_ocr.extraction.numeric_parser import NumericParser
from services.grocery_ocr.extraction.price_extractor import BasePriceExtractor, FinancialExtractionResult
from services.grocery_ocr.extraction.product_extractor import BaseProductExtractor
from services.grocery_ocr.extraction.quantity_extractor import BaseQuantityExtractor, QuantityExtractionResult
from services.grocery_ocr.intelligence.package_size_extractor import BILLING_UNIT_KEYWORDS, PackageSizeExtractor
from services.grocery_ocr.intelligence.product_normalizer import ProductNormalizer
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice_item import PackageSize
from services.grocery_ocr.schemas.table import DetectedColumn, TableCell, TableRow

logger = get_logger("extraction.column_wise_extractor")

# Metadata keywords that identify footer or non-item lines
NON_ITEM_PREFIXES = (
    "bank details", "terms and conditions", "total in words",
    "account number", "for ", "subject to", "our goods", "round off",
    "grand total", "sub total", "cgst total", "sgst total", "igst total",
    "authorised signatory", "authorized signatory", "e. & o.e.",
)


class ExtractedRowRecord(BaseModel):
    """Structured extraction result for a single invoice table row."""
    row_index: int
    raw_product_name: str
    normalized_product_name: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    pack_size: Optional[PackageSize] = None
    quantity: Optional[Decimal] = None
    raw_quantity: Optional[str] = None
    unit: Optional[str] = None
    raw_unit: Optional[str] = None
    purchase_price: Optional[Decimal] = None
    selling_price: Optional[Decimal] = None
    mrp: Optional[Decimal] = None
    discount: Optional[Decimal] = None
    discount_pct: Optional[Decimal] = None
    tax_amount: Optional[Decimal] = None
    gst_rate: Optional[Decimal] = None
    taxable_amount: Optional[Decimal] = None
    printed_amount: Optional[Decimal] = None
    hsn_code: Optional[str] = None
    serial: Optional[int] = None
    confidence: float = 100.0
    warnings: List[str] = Field(default_factory=list)
    cell_provenance: Dict[str, str] = Field(default_factory=dict)
    financial_role_confidence: Dict[str, float] = Field(default_factory=dict)
    is_valid: bool = True


class ColumnWiseExtractor:
    """
    Column-Wise Deterministic Extraction Engine.
    Executes schema-driven, non-bleeding extraction for invoice table rows.
    """

    def __init__(
        self,
        config: Optional[GroceryOCRConfig] = None,
        product_extractor: Optional[BaseProductExtractor] = None,
        quantity_extractor: Optional[BaseQuantityExtractor] = None,
        price_extractor: Optional[BasePriceExtractor] = None,
        numeric_parser: Optional[NumericParser] = None,
    ):
        self.config = config or default_config
        self.product_extractor = product_extractor or BaseProductExtractor(self.config)
        self.quantity_extractor = quantity_extractor or BaseQuantityExtractor(self.config)
        self.price_extractor = price_extractor or BasePriceExtractor(self.config)
        self.numeric_parser = numeric_parser or NumericParser(self.config)
        self.package_size_extractor = PackageSizeExtractor(self.config)
        self.normalizer = ProductNormalizer(self.config)

    def extract_row(
        self,
        row: TableRow,
        schema_or_columns: Union[DocumentTableSchema, List[DetectedColumn]],
    ) -> Optional[ExtractedRowRecord]:
        """
        Extracts structured fields for a single row strictly within column boundaries.
        Returns None if row is not an item row (header, summary, empty, or metadata).
        """
        if (
            row.is_header
            or row.is_summary
            or row.is_continuation
            or not row.cells
        ):
            return None

        # Normalize columns input
        if isinstance(schema_or_columns, DocumentTableSchema):
            columns = schema_or_columns.to_detected_columns()
            schema = schema_or_columns
        else:
            columns = schema_or_columns
            schema = None

        warnings: List[str] = []
        cell_provenance: Dict[str, str] = {}

        # 1. Product Name Extraction
        raw_name, norm_name = self.product_extractor.extract_product_name(row, columns)
        if not raw_name or len(raw_name.strip()) < 2:
            return None

        lower_name = raw_name.lower().strip()
        if any(lower_name.startswith(pfx) for pfx in NON_ITEM_PREFIXES):
            return None

        # Pack Size Extraction
        pack_size = self.product_extractor.extract_pack_size(raw_name)
        if pack_size and pack_size.unit and pack_size.unit.lower() in BILLING_UNIT_KEYWORDS:
            logger.debug("Discarding pack_size %s %s (billing unit)", pack_size.value, pack_size.unit)
            pack_size = None

        # 2. Quantity & Unit Extraction
        if hasattr(self.quantity_extractor, "extract_quantity_detailed"):
            qty_res = self.quantity_extractor.extract_quantity_detailed(row, columns)
            qty = qty_res.quantity
            raw_qty = qty_res.raw_quantity
            unit = qty_res.unit
            raw_unit = qty_res.raw_unit
            if qty_res.issues:
                warnings.extend(qty_res.issues)
        else:
            qty, unit = self.quantity_extractor.extract_quantity(row, columns)
            raw_qty = str(qty) if qty is not None else None
            raw_unit = unit

        # 3. Financial Fields Extraction
        fin_conf: Dict[str, float] = {}
        if hasattr(self.price_extractor, "extract_financials_detailed"):
            fin_res = self.price_extractor.extract_financials_detailed(row, columns)
            p_price = fin_res.purchase_price
            s_price = fin_res.selling_price
            mrp_val = fin_res.mrp
            disc_val = fin_res.discount
            disc_pct_val = fin_res.discount_pct
            tax_amt = fin_res.tax_amount
            gst_rt = fin_res.gst_rate
            taxable_val = fin_res.taxable_amount
            prn_amt = fin_res.printed_amount
            cell_provenance.update(fin_res.raw_financial_cells)
            fin_conf = fin_res.financial_role_confidence
            if fin_res.issues:
                warnings.extend(fin_res.issues)
        else:
            prices = self.price_extractor.extract_prices(row, columns)
            p_price = prices.get("purchase_price")
            s_price = prices.get("selling_price")
            mrp_val = prices.get("mrp")
            disc_val = prices.get("discount")
            disc_pct_val = prices.get("discount_pct")
            tax_amt = prices.get("tax_amount")
            gst_rt = prices.get("gst_rate")
            taxable_val = prices.get("taxable_amount")
            prn_amt = prices.get("printed_amount")

        # Must have at least one numeric signal (qty, price, or amount) to be an item
        if qty is None and p_price is None and prn_amt is None:
            return None

        # 4. Faint Decimal Dot Repair in Quantities
        if qty is not None and p_price is not None and prn_amt is not None and qty >= Decimal("10"):
            shifted_qty = (qty / Decimal("10")).quantize(Decimal("0.001"))
            gross_shifted = (shifted_qty * p_price).quantize(Decimal("0.01"))
            net_shifted = gross_shifted - (disc_val or Decimal("0.00")) + (tax_amt or Decimal("0.00"))
            gross_orig = (qty * p_price).quantize(Decimal("0.01"))
            net_orig = gross_orig - (disc_val or Decimal("0.00")) + (tax_amt or Decimal("0.00"))
            if abs(net_shifted - prn_amt) <= Decimal("1.50") and abs(net_orig - prn_amt) > Decimal("5.00"):
                logger.info(
                    "Repaired faint OCR decimal in quantity: shifted from %s to %s for '%s'",
                    qty, shifted_qty, raw_name
                )
                warnings.append(f"Repaired faint decimal in quantity: shifted from {qty} to {shifted_qty}")
                qty = shifted_qty
                raw_qty = str(shifted_qty)

        # 5. Extract Serial & HSN Code if columns present
        hsn_col_idx = next((c.column_index for c in columns if c.role == "hsn"), None)
        hsn_code: Optional[str] = None
        if hsn_col_idx is not None and hsn_col_idx < len(row.cells):
            hsn_txt = row.cells[hsn_col_idx].cleaned_text.strip()
            hsn_match = re.search(r"\b\d{4,8}\b", hsn_txt)
            if hsn_match:
                hsn_code = hsn_match.group(0)

        serial_col_idx = next((c.column_index for c in columns if c.role == "serial"), None)
        serial_val: Optional[int] = None
        if serial_col_idx is not None and serial_col_idx < len(row.cells):
            s_txt = row.cells[serial_col_idx].cleaned_text.strip()
            s_match = re.search(r"^\d+", s_txt)
            if s_match:
                serial_val = int(s_match.group(0))

        # 6. Schema Cell-Level Expected Data Type Validation
        if schema:
            for dyn_col in schema.columns:
                c_idx = dyn_col.column_index
                if c_idx < len(row.cells):
                    cell = row.cells[c_idx]
                    valid, issue = self.validate_cell_data_type(cell.cleaned_text, dyn_col.expected_data_type)
                    if not valid and issue:
                        warnings.append(f"Column '{dyn_col.header_text}' (index {c_idx}): {issue}")

        # Compute confidence score
        conf_scores = [c.confidence for c in columns if c.role != "unknown"]
        avg_conf = sum(conf_scores) / len(conf_scores) if conf_scores else 80.0

        return ExtractedRowRecord(
            row_index=row.row_index,
            raw_product_name=raw_name,
            normalized_product_name=norm_name,
            pack_size=pack_size,
            quantity=qty,
            raw_quantity=raw_qty,
            unit=unit,
            raw_unit=raw_unit,
            purchase_price=p_price,
            selling_price=s_price,
            mrp=mrp_val,
            discount=disc_val,
            discount_pct=disc_pct_val,
            tax_amount=tax_amt,
            gst_rate=gst_rt,
            taxable_amount=taxable_val,
            printed_amount=prn_amt,
            hsn_code=hsn_code,
            serial=serial_val,
            confidence=round(avg_conf, 1),
            warnings=warnings,
            cell_provenance=cell_provenance,
            financial_role_confidence=fin_conf,
            is_valid=True,
        )

    def extract_rows(
        self,
        rows: List[TableRow],
        schema_or_columns: Union[DocumentTableSchema, List[DetectedColumn]],
    ) -> List[ExtractedRowRecord]:
        """
        Extracts structured records across all data rows in an invoice table.
        """
        extracted: List[ExtractedRowRecord] = []
        for row in rows:
            record = self.extract_row(row, schema_or_columns)
            if record is not None:
                extracted.append(record)
        return extracted

    def validate_cell_data_type(
        self,
        cell_text: str,
        expected_type: ExpectedDataType,
    ) -> Tuple[bool, Optional[str]]:
        """
        Validates cell text against expected data type from DocumentTableSchema.
        """
        txt = cell_text.strip()
        if not txt or txt in ("-", "--", ".", "|", "NA", "N/A"):
            return True, None

        if expected_type == ExpectedDataType.INTEGER_SERIAL:
            cleaned = re.sub(r"[\.\s]", "", txt)
            if not cleaned.isdigit():
                return False, f"Expected integer serial number, got '{txt}'"

        elif expected_type == ExpectedDataType.DECIMAL_QUANTITY:
            cleaned = re.sub(r"[^\d.]", "", txt)
            if not cleaned or not any(ch.isdigit() for ch in cleaned):
                return False, f"Expected numeric quantity, got '{txt}'"

        elif expected_type == ExpectedDataType.DECIMAL_CURRENCY:
            cleaned = re.sub(r"[^\d.]", "", txt)
            if not cleaned or not any(ch.isdigit() for ch in cleaned):
                return False, f"Expected decimal currency, got '{txt}'"

        elif expected_type == ExpectedDataType.PERCENTAGE:
            cleaned = re.sub(r"[^\d.]", "", txt)
            if cleaned and any(ch.isdigit() for ch in cleaned):
                try:
                    val = float(cleaned)
                    if not (0.0 <= val <= 100.0):
                        return False, f"Percentage {val}% is outside valid 0-100 range"
                except ValueError:
                    return False, f"Invalid percentage format '{txt}'"

        elif expected_type == ExpectedDataType.HSN_CODE:
            cleaned = re.sub(r"\D", "", txt)
            if not (2 <= len(cleaned) <= 8):
                return False, f"HSN code should be 2 to 8 digits, got '{txt}'"

        return True, None
