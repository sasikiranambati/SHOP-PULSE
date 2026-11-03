"""
Excel-First Invoice Processing Service for ShopPulse.

Generates a genuine 4-worksheet .xlsx workbook using openpyxl, saves it,
re-opens the workbook, and parses the actual worksheet cells to extract
the final structured grocery invoice data and provide downloadable audit workbooks.

Worksheet Structure:
1. Raw Invoice: Reconstructed invoice table and original OCR cells
2. Grocery Items: Confirmed and classified grocery items with normalized fields
3. Review Required: Ambiguous items, non-grocery rows, arithmetic discrepancies
4. OCR Audit: Bounding boxes, word coordinates, confidence scores, and engine metadata
"""

import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from services.grocery_classifier import GroceryClassification, classify_product

# Persistent directory for generated invoice workbooks
STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage" / "invoices"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)


# Styling helpers
FONT_HEADER = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
FONT_BOLD = Font(name="Calibri", size=11, bold=True)
FONT_REGULAR = Font(name="Calibri", size=10)
FONT_WARN = Font(name="Calibri", size=10, color="9C0006")

FILL_HEADER_PRIMARY = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")  # Navy
FILL_HEADER_GROCERY = PatternFill(start_color="234B3A", end_color="234B3A", fill_type="solid")  # Forest Green
FILL_HEADER_REVIEW = PatternFill(start_color="C00000", end_color="C00000", fill_type="solid")   # Dark Red
FILL_HEADER_AUDIT = PatternFill(start_color="595959", end_color="595959", fill_type="solid")    # Dark Slate
FILL_WARN = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")             # Soft Red
FILL_OK = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")               # Soft Green

THIN_BORDER = Border(
    left=Side(style="thin", color="D9D9D9"),
    right=Side(style="thin", color="D9D9D9"),
    top=Side(style="thin", color="D9D9D9"),
    bottom=Side(style="thin", color="D9D9D9"),
)


def _auto_fit_columns(ws, max_cols: int = 25):
    """Adjusts column widths based on content."""
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col[:100]:
            if cell.value is not None:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = min(max(max_len + 3, 11), 40)


def generate_invoice_workbook(
    invoice_id: str,
    raw_rows: List[Dict[str, Any]],
    columns: List[Any],
    extracted_items: List[Any],
    classifications: List[GroceryClassification],
    raw_ocr_words: List[Dict[str, Any]],
    metadata: Dict[str, Any],
    warnings: List[str],
) -> Path:
    """
    Generates an authentic 4-sheet .xlsx workbook for the invoice and saves it to disk.
    Returns the file path of the saved workbook.
    """
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    # -------------------------------------------------------------------------
    # Sheet 1: Raw Invoice
    # -------------------------------------------------------------------------
    ws_raw = wb.create_sheet(title="Raw Invoice")
    ws_raw.views.sheetView[0].showGridLines = True

    # Metadata Header block
    ws_raw["A1"] = "ShopPulse Invoice Table Reconstruction"
    ws_raw["A1"].font = Font(name="Calibri", size=14, bold=True, color="1F497D")
    ws_raw["A2"] = f"Invoice ID: {invoice_id} | Supplier: {metadata.get('supplier_name') or 'N/A'} | Bill No: {metadata.get('invoice_number') or 'N/A'} | Date: {metadata.get('invoice_date') or 'N/A'}"
    ws_raw["A2"].font = Font(name="Calibri", size=10, italic=True)

    # Table columns header
    col_headers = ["Row #", "Is Item?"] + [getattr(c, "header_text", str(c)) for c in columns] + ["Raw Row Text"]
    ws_raw.append([])  # Row 3 blank
    ws_raw.append(col_headers)  # Row 4
    for cell in ws_raw[4]:
        cell.font = FONT_HEADER
        cell.fill = FILL_HEADER_PRIMARY
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for r_idx, r in enumerate(raw_rows):
        is_item = r.get("is_item", False)
        cells_dict = r.get("cells", {})
        row_vals = [r.get("row_index", r_idx + 1), "YES" if is_item else "NO"]
        for c in columns:
            role = getattr(c, "role", str(c))
            header = getattr(c, "header_text", "")
            key = f"{role}:{header}" if role == "unknown" else role
            row_vals.append(cells_dict.get(key, cells_dict.get(role, "")))
        row_vals.append(r.get("text", ""))
        ws_raw.append(row_vals)
        cur_row = ws_raw[ws_raw.max_row]
        for c_cell in cur_row:
            c_cell.font = FONT_REGULAR
            c_cell.border = THIN_BORDER
    _auto_fit_columns(ws_raw)

    # -------------------------------------------------------------------------
    # Sheet 2: Grocery Items
    # -------------------------------------------------------------------------
    ws_items = wb.create_sheet(title="Grocery Items")
    ws_items.views.sheetView[0].showGridLines = True

    grocery_headers = [
        "Line #", "Original Name", "Normalized Name", "Brand", "Category", "HSN Code",
        "Quantity", "Unit", "Pack Size", "Pack Size Unit", "Purchase Price (Rate)",
        "MRP", "Selling Price", "Discount (₹)", "GST (%)", "Tax Amount (₹)",
        "Printed Total (₹)", "Calculated Total (₹)", "Status"
    ]
    ws_items.append(grocery_headers)
    for cell in ws_items[1]:
        cell.font = FONT_HEADER
        cell.fill = FILL_HEADER_GROCERY
        cell.alignment = Alignment(horizontal="center", vertical="center")

    review_rows_data = []

    for idx, (item, cls) in enumerate(zip(extracted_items, classifications)):
        line_num = idx + 1
        calc_total = (
            round(item.quantity * (item.purchase_price or item.rate or 0), 2)
            if item.quantity is not None and (item.purchase_price or item.rate) is not None
            else None
        )
        row_data = [
            line_num,
            item.product_name,
            cls.normalized_name or item.product_name,
            cls.brand or "",
            cls.category or "Groceries",
            item.hsn_code or "",
            item.quantity,
            item.unit or "",
            cls.pack_size,
            cls.pack_size_unit or "",
            item.purchase_price if item.purchase_price is not None else item.rate,
            item.invoice_mrp or getattr(item, "mrp", None),
            getattr(item, "selling_price", None),
            item.discount,
            item.gst_rate,
            item.tax_amount,
            item.line_total,
            calc_total,
            cls.status,
        ]
        ws_items.append(row_data)
        cur_row = ws_items[ws_items.max_row]
        for c_cell in cur_row:
            c_cell.font = FONT_REGULAR
            c_cell.border = THIN_BORDER

        # Flag for review sheet if ambiguous or non-grocery
        if (
            cls.status in ("GROCERY_REVIEW", "UNKNOWN_REVIEW", "NON_GROCERY")
            or item.arithmetic_status == "MISMATCH"
            or item.purchase_price is None
            or item.quantity is None
            or item.issues
        ):
            review_rows_data.append((line_num, item, cls, calc_total))

    _auto_fit_columns(ws_items)

    # -------------------------------------------------------------------------
    # Sheet 3: Review Required
    # -------------------------------------------------------------------------
    ws_review = wb.create_sheet(title="Review Required")
    ws_review.views.sheetView[0].showGridLines = True

    review_headers = [
        "Line #", "Product Name", "Classification", "Category", "Quantity", "Unit",
        "Purchase Price", "Printed Total", "Calculated Total", "Issues / Warnings"
    ]
    ws_review.append(review_headers)
    for cell in ws_review[1]:
        cell.font = FONT_HEADER
        cell.fill = FILL_HEADER_REVIEW
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for line_num, item, cls, calc_total in review_rows_data:
        issues_text = "; ".join(item.issues + cls.review_reasons)
        if item.arithmetic_status == "MISMATCH":
            issues_text += "; Arithmetic mismatch between Qty × Rate and Printed Total"
        ws_review.append([
            line_num,
            item.product_name,
            cls.status,
            cls.category,
            item.quantity,
            item.unit,
            item.purchase_price,
            item.line_total,
            calc_total,
            issues_text or "Check values before confirming stock",
        ])
        cur_row = ws_review[ws_review.max_row]
        for c_cell in cur_row:
            c_cell.font = FONT_WARN
            c_cell.border = THIN_BORDER
    _auto_fit_columns(ws_review)

    # -------------------------------------------------------------------------
    # Sheet 4: OCR Audit
    # -------------------------------------------------------------------------
    ws_audit = wb.create_sheet(title="OCR Audit")
    ws_audit.views.sheetView[0].showGridLines = True

    audit_headers = ["Word #", "Word Text", "Confidence (%)", "X0", "Y0", "X1", "Y1"]
    ws_audit.append(audit_headers)
    for cell in ws_audit[1]:
        cell.font = FONT_HEADER
        cell.fill = FILL_HEADER_AUDIT
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for w_idx, w in enumerate(raw_ocr_words[:1000]):  # Store up to 1000 words
        ws_audit.append([
            w_idx + 1,
            w.get("text", getattr(w, "text", "")),
            round(w.get("confidence", getattr(w, "conf", 0.0)) or 0.0, 1),
            round(w.get("bbox", {}).get("x0", getattr(w, "x0", 0.0)), 1) if isinstance(w, dict) else round(getattr(w, "x0", 0.0), 1),
            round(w.get("bbox", {}).get("y0", getattr(w, "y0", 0.0)), 1) if isinstance(w, dict) else round(getattr(w, "y0", 0.0), 1),
            round(w.get("bbox", {}).get("x1", getattr(w, "x1", 0.0)), 1) if isinstance(w, dict) else round(getattr(w, "x1", 0.0), 1),
            round(w.get("bbox", {}).get("y1", getattr(w, "y1", 0.0)), 1) if isinstance(w, dict) else round(getattr(w, "y1", 0.0), 1),
        ])
        cur_row = ws_audit[ws_audit.max_row]
        for c_cell in cur_row:
            c_cell.font = FONT_REGULAR
            c_cell.border = THIN_BORDER
    _auto_fit_columns(ws_audit)

    # Save to disk
    file_path = STORAGE_DIR / f"{invoice_id}.xlsx"
    wb.save(str(file_path))
    return file_path


def parse_invoice_workbook(workbook_path: Path) -> List[Dict[str, Any]]:
    """
    Reopens the generated .xlsx workbook using openpyxl, reads the actual worksheet
    cells from 'Grocery Items', and extracts structured invoice data directly from Excel.
    """
    if not workbook_path.exists():
        raise FileNotFoundError(f"Invoice workbook not found at {workbook_path}")

    wb = openpyxl.load_workbook(str(workbook_path), data_only=True)
    if "Grocery Items" not in wb.sheetnames:
        raise ValueError("Workbook is missing required 'Grocery Items' worksheet")

    ws = wb["Grocery Items"]
    parsed_items: List[Dict[str, Any]] = []

    # Map header names to column index
    header_row = [cell.value for cell in ws[1]]
    header_map = {str(h).strip(): idx for idx, h in enumerate(header_row) if h is not None}

    def _val(row, name, default=None):
        idx = header_map.get(name)
        if idx is not None and idx < len(row):
            val = row[idx].value
            return val if val is not None else default
        return default

    def _float_or_none(row, name):
        v = _val(row, name)
        if v is None or v == "":
            return None
        try:
            return float(v)
        except (ValueError, TypeError):
            return None

    # Parse rows starting from row 2
    for r_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
        orig_name = _val(row, "Original Name")
        if not orig_name:
            continue

        item_dict = {
            "row_index": r_idx,
            "line_number": _val(row, "Line #", r_idx - 1),
            "product_name": str(orig_name).strip(),
            "normalized_name": _val(row, "Normalized Name", orig_name),
            "brand": _val(row, "Brand") or None,
            "category": _val(row, "Category", "Groceries"),
            "hsn_code": str(_val(row, "HSN Code") or "").strip() or None,
            "quantity": _float_or_none(row, "Quantity"),
            "unit": str(_val(row, "Unit") or "").strip() or None,
            "pack_size": _float_or_none(row, "Pack Size"),
            "pack_size_unit": str(_val(row, "Pack Size Unit") or "").strip() or None,
            "purchase_price": _float_or_none(row, "Purchase Price (Rate)"),
            "mrp": _float_or_none(row, "MRP"),
            "selling_price": _float_or_none(row, "Selling Price"),
            "discount": _float_or_none(row, "Discount (₹)"),
            "gst_rate": _float_or_none(row, "GST (%)"),
            "tax_amount": _float_or_none(row, "Tax Amount (₹)"),
            "line_total": _float_or_none(row, "Printed Total (₹)"),
            "calculated_total": _float_or_none(row, "Calculated Total (₹)"),
            "status": str(_val(row, "Status", "GROCERY_CONFIDENT")).strip(),
        }
        parsed_items.append(item_dict)

    wb.close()
    return parsed_items


def get_invoice_workbook_path(invoice_id: str) -> Optional[Path]:
    """Returns the path of the saved Excel workbook for the given invoice_id if present."""
    path = STORAGE_DIR / f"{invoice_id}.xlsx"
    return path if path.exists() else None
