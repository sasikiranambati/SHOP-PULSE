"""
Excel workbook generator for grocery invoices.
Generates genuine, multi-worksheet XLSX audit workbooks using openpyxl.
Strictly adheres to Phase 7 four-worksheet structure:
  1. Raw Invoice
  2. Grocery Items
  3. Review Required
  4. OCR Audit
Enforces correct Excel cell data types: numeric cells for financial values, blank cells for missing data.
"""

import io
from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Any, Dict, List, Optional
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ExcelGenerationError
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice import ExtractedInvoice
from services.grocery_ocr.schemas.invoice_item import ExtractedInvoiceItem

logger = get_logger("excel.workbook_generator")

# Sheet Names
SHEET_RAW_INVOICE = "Raw Invoice"
SHEET_GROCERY_ITEMS = "Grocery Items"
SHEET_REVIEW_REQUIRED = "Review Required"
SHEET_OCR_AUDIT = "OCR Audit"

# Theme Palette (Professional, non-decorative)
FONT_FAMILY = "Segoe UI"
HEADER_FONT = Font(name=FONT_FAMILY, size=11, bold=True, color="FFFFFF")
DATA_FONT = Font(name=FONT_FAMILY, size=10, bold=False, color="000000")
BOLD_DATA_FONT = Font(name=FONT_FAMILY, size=10, bold=True, color="000000")

FILL_GROCERY = PatternFill(start_color="1F4E38", end_color="1F4E38", fill_type="solid")  # Forest Green
FILL_RAW = PatternFill(start_color="2C3E50", end_color="2C3E50", fill_type="solid")      # Deep Slate Blue
FILL_REVIEW = PatternFill(start_color="8A5A00", end_color="8A5A00", fill_type="solid")   # Amber Brown
FILL_AUDIT = PatternFill(start_color="3D4A54", end_color="3D4A54", fill_type="solid")    # Charcoal Slate

THIN_BORDER = Border(
    left=Side(style="thin", color="E0E0E0"),
    right=Side(style="thin", color="E0E0E0"),
    top=Side(style="thin", color="E0E0E0"),
    bottom=Side(style="thin", color="E0E0E0"),
)


class IWorkbookGenerator(ABC):
    """Abstract interface for generating genuine XLSX workbooks from invoice models."""

    @abstractmethod
    def generate(self, invoice: ExtractedInvoice, output_path: Optional[str] = None) -> bytes:
        """
        Generates a genuine XLSX workbook containing the 4 required audit worksheets.
        """
        pass


class BaseWorkbookGenerator(IWorkbookGenerator):
    """
    Genuine openpyxl workbook generator.
    Populates all 4 worksheets with precise types, column formatting, and auto-filters.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    def generate(self, invoice: ExtractedInvoice, output_path: Optional[str] = None) -> bytes:
        logger.debug("Generating genuine XLSX workbook for invoice %s (%d items)", invoice.invoice_id, len(invoice.items))
        try:
            wb = openpyxl.Workbook()

            # Create the 4 mandatory sheets in order
            ws_raw = wb.active
            ws_raw.title = SHEET_RAW_INVOICE
            ws_grocery = wb.create_sheet(title=SHEET_GROCERY_ITEMS)
            ws_review = wb.create_sheet(title=SHEET_REVIEW_REQUIRED)
            ws_audit = wb.create_sheet(title=SHEET_OCR_AUDIT)

            # Build worksheets
            self._build_raw_invoice_sheet(ws_raw, invoice)
            self._build_grocery_items_sheet(ws_grocery, invoice)
            self._build_review_required_sheet(ws_review, invoice)
            self._build_ocr_audit_sheet(ws_audit, invoice)

            # Ensure Sheet 2 (Grocery Items) is the active tab when opened in Excel
            wb.active = ws_grocery

            buf = io.BytesIO()
            wb.save(buf)
            content = buf.getvalue()

            if output_path:
                with open(output_path, "wb") as f:
                    f.write(content)
                logger.info("Saved generated XLSX workbook directly to %s", output_path)

            return content

        except Exception as exc:
            logger.error("Excel generation failed for invoice %s: %s", invoice.invoice_id, exc)
            raise ExcelGenerationError(f"Failed to generate XLSX workbook: {exc}", details={"invoice_id": invoice.invoice_id})

    # --------------------------------------------------------------------------
    # SHEET 1: Raw Invoice
    # --------------------------------------------------------------------------
    def _build_raw_invoice_sheet(self, ws: Any, invoice: ExtractedInvoice) -> None:
        headers = [
            "Page Number",
            "Original Product Description",
            "Original OCR Text",
            "Reconstructed Row",
            "Original Headers",
            "Extracted Cells",
            "OCR Confidence",
            "Reconstruction Confidence",
        ]
        self._write_header_row(ws, headers, FILL_RAW)

        detected_tables = invoice.metadata.tables_detected or []
        header_summary = ""
        if detected_tables:
            header_summary = " | ".join(c.header_text for c in detected_tables[0].columns)

        for idx, item in enumerate(invoice.items, start=1):
            cell_summary = " | ".join(f"{k}: {v}" for k, v in item.raw_cells.items()) if item.raw_cells else ""
            row_data = [
                item.source_page or 1,
                item.raw_product_name,
                item.raw_row_text or item.raw_product_name,
                item.source_row_index if item.source_row_index is not None else idx,
                header_summary,
                cell_summary,
                self._format_num_for_excel(item.ocr_confidence, is_currency=False),
                self._format_num_for_excel(item.extraction_confidence, is_currency=False),
            ]
            ws.append(row_data)

        self._finalize_sheet_formatting(ws, num_cols=len(headers), is_data_empty=len(invoice.items) == 0)

    # --------------------------------------------------------------------------
    # SHEET 2: Grocery Items
    # --------------------------------------------------------------------------
    def _build_grocery_items_sheet(self, ws: Any, invoice: ExtractedInvoice) -> None:
        headers = [
            "S.No.",
            "Original Product Name",
            "Normalized Product Name",
            "Brand",
            "Category",
            "HSN",
            "Package Size",
            "Quantity",
            "Unit",
            "Purchase Price",
            "Selling Price",
            "MRP",
            "Discount",
            "GST Percentage",
            "GST Amount",
            "Printed Amount",
            "Calculated Amount",
            "Validation Status",
        ]
        self._write_header_row(ws, headers, FILL_GROCERY)

        for idx, item in enumerate(invoice.items, start=1):
            pkg_str = ""
            if item.package_size:
                pkg_str = item.package_size.raw_text or f"{item.package_size.value} {item.package_size.unit or ''}".strip()

            row_data = [
                idx,
                item.raw_product_name,
                item.normalized_product_name or item.raw_product_name,
                item.brand or "",
                item.category or "Groceries",
                item.hsn_code or "",
                pkg_str,
                self._format_num_for_excel(item.quantity, is_currency=False),
                item.unit or "",
                self._format_num_for_excel(item.purchase_price, is_currency=True),
                self._format_num_for_excel(item.selling_price, is_currency=True),
                self._format_num_for_excel(item.mrp, is_currency=True),
                self._format_num_for_excel(item.discount, is_currency=True),
                self._format_num_for_excel(item.gst_rate, is_currency=False),
                self._format_num_for_excel(item.tax_amount, is_currency=True),
                self._format_num_for_excel(item.printed_amount, is_currency=True),
                self._format_num_for_excel(item.calculated_amount, is_currency=True),
                item.validation_status,
            ]
            ws.append(row_data)

            # Apply cell numeric formatting to data row
            r_idx = ws.max_row
            ws.cell(row=r_idx, column=8).number_format = "#,##0.000" if item.quantity is not None else "@"
            for col_c in (10, 11, 12, 13, 15, 16, 17):
                ws.cell(row=r_idx, column=col_c).number_format = "#,##0.00"
            ws.cell(row=r_idx, column=14).number_format = "0.00"

        self._finalize_sheet_formatting(ws, num_cols=len(headers), is_data_empty=len(invoice.items) == 0)

    # --------------------------------------------------------------------------
    # SHEET 3: Review Required
    # --------------------------------------------------------------------------
    def _build_review_required_sheet(self, ws: Any, invoice: ExtractedInvoice) -> None:
        headers = [
            "Original Product Name",
            "Extracted Values",
            "Missing Fields",
            "Uncertain Fields",
            "Confidence",
            "Validation Warnings",
            "Review Reason",
        ]
        self._write_header_row(ws, headers, FILL_REVIEW)

        review_count = 0
        for item in invoice.items:
            # Check review criteria
            needs_review = (
                item.review_status == "REVIEW_REQUIRED"
                or item.validation_status in ("WARNING", "MISMATCH", "INVALID", "NEEDS_REVIEW", "INSUFFICIENT_DATA")
                or item.classification_status in ("GROCERY_REVIEW_REQUIRED", "UNKNOWN_REVIEW_REQUIRED")
                or len(item.validation_issues) > 0
                or getattr(item, "rounding_difference", None) is not None and abs(item.rounding_difference) > Decimal("0.05")
            )

            if needs_review:
                review_count += 1
                missing_fields = []
                if item.quantity is None:
                    missing_fields.append("Quantity")
                if item.purchase_price is None:
                    missing_fields.append("Purchase Price")
                if item.unit is None:
                    missing_fields.append("Unit")

                uncertain_fields = []
                if item.financial_role_confidence.get("purchase_price", 100.0) < 75.0:
                    uncertain_fields.append("Rate (Generic Header)")
                if item.classification_status != "GROCERY_HIGH_CONFIDENCE":
                    uncertain_fields.append("Taxonomy Category")

                extracted_summary = (
                    f"Qty: {item.quantity or '-'} {item.unit or ''}; "
                    f"Rate: ₹{item.purchase_price or '-'}; "
                    f"MRP: ₹{item.mrp or '-'}; "
                    f"Printed: ₹{item.printed_amount or '-'}"
                )

                review_reason = item.classification_explanation or (
                    item.validation_issues[0] if item.validation_issues else "Verification required"
                )

                row_data = [
                    item.raw_product_name,
                    extracted_summary,
                    ", ".join(missing_fields) if missing_fields else "None",
                    ", ".join(uncertain_fields) if uncertain_fields else "None",
                    self._format_num_for_excel(item.extraction_confidence, is_currency=False),
                    " | ".join(item.validation_issues) if item.validation_issues else "",
                    review_reason,
                ]
                ws.append(row_data)

        if review_count == 0:
            ws.append([
                "All items verified",
                "Complete",
                "None",
                "None",
                100.0,
                "No discrepancies detected",
                "Ready for approval",
            ])

        self._finalize_sheet_formatting(ws, num_cols=len(headers), is_data_empty=False)

    # --------------------------------------------------------------------------
    # SHEET 4: OCR Audit
    # --------------------------------------------------------------------------
    def _build_ocr_audit_sheet(self, ws: Any, invoice: ExtractedInvoice) -> None:
        headers = [
            "Page Number",
            "OCR Engine",
            "Original OCR Text",
            "Word Coordinates",
            "Column Mapping",
            "Extraction Confidence",
            "Processing Warnings",
        ]
        self._write_header_row(ws, headers, FILL_AUDIT)

        engine_name = invoice.metadata.engine_name or "TesseractOCR"
        warnings_str = " | ".join(invoice.metadata.warnings) if invoice.metadata.warnings else "None"

        col_mapping_str = ""
        if invoice.metadata.tables_detected:
            cols = invoice.metadata.tables_detected[0].columns
            col_mapping_str = ", ".join(f"{c.header_text} -> {c.role}" for c in cols)

        for item in invoice.items:
            row_data = [
                item.source_page or 1,
                engine_name,
                item.raw_row_text or item.raw_product_name,
                f"Row {item.source_row_index or '-'}",
                col_mapping_str or "Default Grid",
                self._format_num_for_excel(item.ocr_confidence, is_currency=False),
                warnings_str,
            ]
            ws.append(row_data)

        if not invoice.items:
            ws.append([1, engine_name, "No OCR text extracted", "-", "-", 0.0, warnings_str])

        self._finalize_sheet_formatting(ws, num_cols=len(headers), is_data_empty=False)

    # --------------------------------------------------------------------------
    # Formatting Helpers
    # --------------------------------------------------------------------------
    def _write_header_row(self, ws: Any, headers: List[str], fill: PatternFill) -> None:
        ws.append(headers)
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = fill
            cell.font = HEADER_FONT
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=False)
            cell.border = THIN_BORDER

    def _finalize_sheet_formatting(self, ws: Any, num_cols: int, is_data_empty: bool) -> None:
        # Freeze header row
        ws.freeze_panes = "A2"

        # Apply borders, data fonts, and auto-filters
        max_r = ws.max_row
        if max_r > 1 and not is_data_empty:
            ws.auto_filter.ref = f"A1:{get_column_letter(num_cols)}{max_r}"

        for row in ws.iter_rows(min_row=2, max_row=max_r, min_col=1, max_col=num_cols):
            for cell in row:
                cell.font = DATA_FONT
                cell.border = THIN_BORDER

        # Auto-fit column widths with dynamic padding
        for col in ws.iter_cols(min_col=1, max_col=num_cols):
            max_len = 0
            for cell in col:
                val_str = str(cell.value or "")
                max_len = max(max_len, len(val_str))
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

    def _format_num_for_excel(self, val: Any, is_currency: bool = False) -> Optional[float]:
        """
        Converts Decimal to Python float for openpyxl numeric cell storage.
        Preserves None for empty values. Never converts None into 0.0!
        """
        if val is None:
            return None
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, Decimal):
            return float(val)
        try:
            return float(str(val))
        except (ValueError, TypeError):
            return None
