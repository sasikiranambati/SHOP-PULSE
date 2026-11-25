"""
Column-Wise Deterministic Extraction Engine for ShopPulse Grocery OCR (Phase 3).
Extracts line item attributes strictly column-by-column according to DocumentTableSchema
or DetectedColumn definitions. Prevents cross-column token bleeding, validates cell
data types, and ensures complete decimal financial precision.
"""

from decimal import ROUND_HALF_UP, Decimal
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

# "0/12" = cases / loose pieces; "2+1" = paid + free
_CASES_SLASH_PIECES_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*$")
_PLUS_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*$")
# Quantity headings that mean loose pieces (as opposed to a total quantity)
_LOOSE_PIECES_HEADER_RE = re.compile(r"\b(?:pcs|pieces|ea|loose|units?)\b", re.I)
# Informational promotional bundle heading printed above the paid and free lines
_BUNDLE_HEADING_RE = re.compile(r"\(?\s*with\s+free\s+product", re.I)

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
    # Separately printed financial parts (CGST, SGST/UTGST, scheme / other discounts, ...)
    components: Dict[str, Decimal] = Field(default_factory=dict)
    # Line-level reasons for manual review and possible readings (never applied automatically)
    review_reasons: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    # Quantity structure printed on the invoice (cases / units per case / loose pieces / free)
    quantity_details: Dict[str, Any] = Field(default_factory=dict)
    derived_fields: List[str] = Field(default_factory=list)
    is_free_item: bool = False
    is_bundle_header: bool = False
    barcode: Optional[str] = None


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

        # Pack Size Extraction: a printed Pack / Size column is the explicit value and wins over a size
        # read from the product description; neither is ever assumed
        pack_size = None
        pack_cell = self._cell_text(row, columns, "pack_size")
        if pack_cell:
            pack_size = self.product_extractor.extract_pack_size(pack_cell)
            if pack_size is not None:
                cell_provenance["pack_size"] = pack_cell
        if pack_size is None:
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
        components: Dict[str, Decimal] = {}
        review_reasons: List[str] = []
        suggestions: List[str] = []
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
            components = dict(getattr(fin_res, "components", {}) or {})
            review_reasons.extend(getattr(fin_res, "review_reasons", []) or [])
            suggestions.extend(getattr(fin_res, "suggestions", []) or [])
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

        # 2b. Quantity structure: cases / units per case / loose pieces, "cases/pieces" (0/12) and
        # "paid+free" (2+1). Pieces are calculated only when the relationship is printed explicitly.
        qty, qty_details, derived_fields, qty_reasons, barcode = self._resolve_quantity_structure(
            row, columns, qty, raw_qty)
        review_reasons.extend(qty_reasons)
        if qty_details.get("raw_quantity") and raw_qty is None:
            raw_qty = qty_details["raw_quantity"]

        # 2c. Promotional bundle heading ("... (With Free Product)" with "0+0" / "2+1" and no rate):
        # informational only; reported to the caller, never a stock line.
        plus_form = bool(qty_details.get("paid_plus_free") or qty_details.get("cases_plus_form"))
        if _BUNDLE_HEADING_RE.search(raw_name) or (
                plus_form and p_price is None and tax_amt is None and prn_amt is None):
            return ExtractedRowRecord(
                row_index=row.row_index, raw_product_name=raw_name, normalized_product_name=norm_name,
                quantity=None, raw_quantity=raw_qty, taxable_amount=taxable_val, printed_amount=prn_amt,
                quantity_details=qty_details, is_bundle_header=True, warnings=warnings,
                review_reasons=["Bundle heading: informational, not a stock line"])

        # Values that lie across a column boundary: their column is uncertain -> review
        for cell in row.cells:
            reason = getattr(cell, "review_reason", None) or ""
            if getattr(cell, "review_required", False) and "boundary" in reason:
                review_reasons.append(reason)

        # Must have at least one numeric signal (qty, price, or amount) to be an item
        if qty is None and p_price is None and prn_amt is None:
            return None

        # 2d. Printed free item: rate 0.00 and no amount, with a quantity. Kept as its own line with
        # the zero rate; no cost is invented or redistributed.
        is_free_item = bool(
            p_price is not None and p_price == 0 and qty is not None and qty > 0
            and (prn_amt is None or prn_amt == 0) and (taxable_val is None or taxable_val == 0))

        # 4. Possibly faint decimal point in the quantity ('10' printed as '1.0'): the printed
        # reading is KEPT; the alternative is only suggested and the line is flagged for review.
        if qty is not None and p_price is not None and prn_amt is not None and qty >= Decimal("10"):
            shifted_qty = (qty / Decimal("10")).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
            gross_shifted = (shifted_qty * p_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            net_shifted = gross_shifted - (disc_val or Decimal("0.00")) + (tax_amt or Decimal("0.00"))
            gross_orig = (qty * p_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            net_orig = gross_orig - (disc_val or Decimal("0.00")) + (tax_amt or Decimal("0.00"))
            if abs(net_shifted - prn_amt) <= Decimal("1.50") and abs(net_orig - prn_amt) > Decimal("5.00"):
                note = (f"Quantity {qty.normalize():f} may be {shifted_qty.normalize():f} (faint decimal point): "
                        f"{shifted_qty.normalize():f} x ₹{p_price} matches the printed amount ₹{prn_amt}")
                logger.info("Possible faint decimal in quantity for '%s': %s", raw_name, note)
                warnings.append(f"Possible faint decimal in quantity: {qty} may be {shifted_qty} (not applied)")
                suggestions.append(note)
                review_reasons.append("Quantity does not match the printed amount; a decimal point may be missing")
                qty_details["suggested_quantity"] = shifted_qty.normalize()

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
            components=components,
            review_reasons=review_reasons,
            suggestions=suggestions,
            quantity_details=qty_details,
            derived_fields=derived_fields,
            is_free_item=is_free_item,
            barcode=barcode,
        )

    # ------------------------------------------------------------------------------------------
    # Quantity structure (R5)
    # ------------------------------------------------------------------------------------------

    def _cell_text(self, row: TableRow, columns: List[DetectedColumn], role: str) -> Optional[str]:
        col = next((c for c in columns if c.role == role), None)
        if col is None or col.column_index >= len(row.cells):
            return None
        txt = row.cells[col.column_index].cleaned_text.strip()
        return txt or None

    def _resolve_quantity_structure(
        self,
        row: TableRow,
        columns: List[DetectedColumn],
        qty: Optional[Decimal],
        raw_qty: Optional[str],
    ) -> Tuple[Optional[Decimal], Dict[str, Any], List[str], List[str], Optional[str]]:
        """Return (quantity, details, derived_fields, review_reasons, barcode).

        * "a/b" in the quantity cell = a cases / b loose pieces (e.g. "0/12").
        * "a+b" in the quantity cell = a paid + b free units; quantity is the paid a, the free b is
          reported (never added to stock automatically).
        * Cases + units-per-case + pieces columns: total pieces = cases x units per case + pieces,
          calculated ONLY when all three are read and the quantity column holds loose pieces;
          the result is marked as calculated so it is always reviewed.
        * A 'UPC' value of 8+ digits is a barcode, not units per case.
        """
        details: Dict[str, Any] = {}
        derived: List[str] = []
        reasons: List[str] = []
        barcode: Optional[str] = None
        qp = self.numeric_parser.parse_quantity

        qty_txt = (raw_qty or self._cell_text(row, columns, "qty") or "").strip()
        cases_txt = self._cell_text(row, columns, "cases")
        upc_txt = self._cell_text(row, columns, "units_per_case")
        qty_col = next((c for c in columns if c.role == "qty"), None)

        loose = qty
        cases: Optional[Decimal] = None
        if qty_txt:
            details["raw_quantity"] = qty_txt
            m_slash = _CASES_SLASH_PIECES_RE.match(qty_txt)
            m_plus = _PLUS_RE.match(qty_txt)
            if m_slash:
                cases, loose = Decimal(m_slash.group(1)), Decimal(m_slash.group(2))
                details["quantity_format"] = "cases/pieces"
            elif m_plus:
                paid, free = Decimal(m_plus.group(1)), Decimal(m_plus.group(2))
                details.update(paid_plus_free=True, free_quantity=free, paid_quantity=paid)
                loose = paid  # line arithmetic uses the paid units; the received quantity is paid + free
                if free > 0:
                    reasons.append(f"Promotion printed as '{qty_txt}': {paid.normalize():f} paid + {free.normalize():f} free "
                                   f"= {(paid + free).normalize():f} units received. Please confirm before stock is posted; "
                                   "the printed rate and amount are kept (no cost is redistributed).")
        if cases_txt:
            details["raw_cases"] = cases_txt
            if _PLUS_RE.match(cases_txt):
                details["cases_plus_form"] = True
            else:
                parsed_cases = qp(cases_txt).value
                if parsed_cases is not None:
                    cases = parsed_cases
        units: Optional[Decimal] = None
        if upc_txt:
            digits = re.sub(r"\D", "", upc_txt)
            if len(digits) >= 8:
                barcode = digits  # a printed barcode, not a pack count
            else:
                units = qp(upc_txt).value
        if cases is not None:
            details["cases"] = cases
        if units is not None:
            details["units_per_case"] = units
        if loose is not None:
            details["loose_pieces"] = loose

        qty_is_loose_pieces = details.get("quantity_format") == "cases/pieces" or (
            qty_col is not None and _LOOSE_PIECES_HEADER_RE.search(qty_col.header_text or ""))
        quantity = loose
        if cases is not None and cases > 0:
            if units is not None and units > 0 and qty_is_loose_pieces:
                quantity = (cases * units + (loose or Decimal("0"))).quantize(Decimal("0.001"))
                derived.append("quantity")
                reasons.append(
                    f"Quantity calculated from the invoice: {cases.normalize():f} case(s) x "
                    f"{units.normalize():f} per case + {(loose or Decimal('0')).normalize():f} loose = "
                    f"{quantity.normalize():f}. Please check it.")
            else:
                quantity = None if qty_is_loose_pieces else loose
                reasons.append(
                    f"{cases.normalize():f} case(s) printed but the number of units per case is not clear; "
                    "please enter the total quantity.")
        return quantity, details, derived, reasons, barcode


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
