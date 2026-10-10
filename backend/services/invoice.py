"""
Invoice scanning orchestration.

Upload -> file type detection -> text/words (digital PDF words, OCR words for images and
scanned PDFs, or plain text) -> table reconstruction (services/invoice_table.py)
-> inventory matching -> MRP resolution (services/mrp_lookup.py) -> API response.

Stock is only changed by confirm_and_update_stock(), in one transaction.
"""

import io
import logging
import re
import uuid
import zlib
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from services import ocr as ocr_service
from services import invoice_table as table
from services import mrp_lookup
from services.product_matching import best_name_match, normalize_gtin, normalize_name
from db.models.product import Product
from db.models.purchase import Purchase
from db.models.purchase_item import PurchaseItem
from db.models.supplier import Supplier
from schemas.invoice import (
    CanonicalInvoiceItemSchema,
    DetectedColumnSchema,
    DiagnosticInfo,
    InvoiceConfirmRequest,
    InvoiceConfirmResponse,
    InvoiceExtractResponse,
    InvoiceTotalsSchema,
    MrpLookupSchema,
    TotalCheckSchema,
)

logger = logging.getLogger(__name__)

MAX_PDF_PAGES = 5
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}
IMAGE_SIGNATURES = (b"\xff\xd8", b"\x89PNG", b"RIFF", b"BM", b"II*\x00", b"MM\x00*")


class InvoiceConflictError(ValueError):
    """The same supplier invoice was already added to stock."""


class InvoiceValidationError(ValueError):
    """The confirm request is incomplete (e.g. a new product without a selling price)."""


# --------------------------------------------------------------------------
# Backward-compatible helpers (kept for existing callers/tests)
# --------------------------------------------------------------------------


def _f(value: Optional[Decimal]) -> Optional[float]:
    """Decimal -> float at the API boundary (all arithmetic is done in Decimal before this)."""
    return None if value is None else float(value)


def parse_smart_price_py(tok: Optional[str], allow_zero: bool = False) -> Optional[float]:
    value = table.parse_number(tok).value
    if value is None:
        return None
    if value < 0:
        return _f(value)
    if not allow_zero and value == 0:
        return None
    return _f(value)


def resolve_item_arithmetic_py(
    qty: Optional[float], rate: Optional[float], total: Optional[float], tax: Optional[float] = None
) -> Dict[str, Any]:
    """Validation only: printed values are returned unchanged; problems come back as issues."""
    rec = table.reconcile_line(qty, rate, total, tax_amount=tax)
    return {
        "quantity": qty,
        "rate": rate,
        "purchase_price": rate,
        "line_total": _f(rec.line_total),
        "line_total_source": rec.line_total_source,
        "calculated_amount": _f(rec.calculated_amount),
        "amount_difference": _f(rec.amount_difference),
        "status": rec.status,
        "issues": rec.issues,
        "suggestions": rec.suggestions,
        "suggested_rate": _f(rec.suggested_rate),
    }


def is_conflicting_pair_py(type_a: str, type_b: str) -> bool:
    core = table.CORE_ROLES | {"product"}
    return type_a != type_b and type_a in core and type_b in core


def detect_columns_from_header_words_py(words: List[Dict[str, Any]], max_w: float = 0.0) -> List[table.Column]:
    row = table.Row(table.words_from_ocr(words))
    idx, cols = table.detect_header([row], text_mode=False)
    if idx is not None:
        return cols
    med_h = table._median_height([row])
    return sorted(table._header_columns_for_row(row, med_h, False), key=lambda c: c.x0)


# --------------------------------------------------------------------------
# PDF handling
# --------------------------------------------------------------------------


def extract_text_from_pdf_stream(pdf_bytes: bytes) -> str:
    """
    Last-resort text extraction straight from PDF content streams (Tj/TJ operators,
    raw or FlateDecode). Used only when pdfplumber cannot read the file.
    """
    all_lines: List[str] = []
    candidate_streams = []
    for s in re.findall(b"stream[\r\n]+(.*?)[\r\n]+endstream", pdf_bytes, re.DOTALL):
        for attempt in (lambda b: zlib.decompress(b), lambda b: zlib.decompress(b, -15), lambda b: b):
            try:
                candidate_streams.append(attempt(s))
                break
            except Exception:
                continue
    if not candidate_streams:
        candidate_streams.append(pdf_bytes)

    token_pattern = re.compile(
        r"\((.*?)\)\s*(?:Tj|'|\")|\[(.*?)\]\s*TJ|T\*|([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+T[dD]", re.DOTALL
    )
    for raw_stream in candidate_streams:
        stream_text = raw_stream.decode("latin1", errors="ignore")
        for block in re.findall(r"BT(.*?)ET", stream_text, re.DOTALL):
            parts: List[str] = []
            for match in token_pattern.finditer(block):
                full = match.group(0)
                if match.group(1) is not None:
                    txt = match.group(1).replace(r"\(", "(").replace(r"\)", ")").strip()
                    if txt:
                        parts.append(txt)
                elif match.group(2) is not None:
                    combined = "".join(re.findall(r"\((.*?)\)", match.group(2))).strip()
                    if combined:
                        parts.append(combined)
                elif full.startswith("T*") or (match.group(4) and abs(float(match.group(4))) > 0.001):
                    if parts:
                        all_lines.append("    ".join(parts))
                        parts = []
            if parts:
                all_lines.append("    ".join(parts))
    return "\n".join(all_lines)


def _read_pdf(pdf_bytes: bytes) -> Tuple[List[List[table.Word]], List[bytes], Optional[str]]:
    """Returns (word lists of digital pages, PNG renders of image-only pages, error)."""
    try:
        import pdfplumber
    except ImportError:
        return [], [], "pdfplumber is not installed"
    digital: List[List[table.Word]] = []
    scanned: List[bytes] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages[:MAX_PDF_PAGES]:
                words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
                if len(words) >= 3:
                    digital.append([table.Word(w["text"], float(w["x0"]), float(w["top"]), float(w["x1"]),
                                               float(w["bottom"])) for w in words])
                elif page.images:
                    buf = io.BytesIO()
                    page.to_image(resolution=300).original.save(buf, format="PNG")
                    scanned.append(buf.getvalue())
    except Exception as exc:
        return [], [], f"{type(exc).__name__}: {exc}"
    return digital, scanned, None


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


class _Extraction:
    def __init__(self) -> None:
        self.items: List[table.ExtractedLine] = []
        self.columns: List[table.Column] = []
        self.header_text: Optional[str] = None
        self.rows: List[Dict[str, Any]] = []
        self.warnings: List[str] = []
        self.text_lines: List[str] = []
        self.layout_lines: List[str] = []  # rows rebuilt from word positions (one visual line each)
        self.ocr_confidence: Optional[float] = None
        self.ocr_psm: Optional[str] = None
        self.language_data: Optional[str] = None
        self.deskew_angle: Optional[float] = None
        self.pages = 0
        self.totals_row: Dict[str, Decimal] = {}

    def add(self, res: table.TableResult) -> None:
        self.items.extend(res.items)
        # A multi-page invoice prints its TOTAL row on the last page
        if res.totals_row:
            self.totals_row = dict(res.totals_row)
        if res.columns:
            self.columns = res.columns
        self.header_text = self.header_text or res.header_text
        self.rows.extend(res.rows)
        self.warnings.extend(res.warnings)


def _extract_from_rows(ext: _Extraction, rows: List[table.Row], text_mode: bool, method: str) -> table.TableResult:
    res = table.extract_table(rows, text_mode, method, fallback_columns=ext.columns or None)
    return res


def _ocr_image(ext: _Extraction, image_bytes: bytes) -> None:
    png, prep = ocr_service.preprocess_image(image_bytes)
    if prep.get("deskew_angle"):
        ext.deskew_angle = prep["deskew_angle"]
    best: Optional[table.TableResult] = None
    best_ocr: Optional[Dict[str, Any]] = None
    # Automatic page segmentation first; a single-block pass often keeps table rows together better
    for psm in ("auto", "6"):
        ocr = ocr_service.run_ocr_on_preprocessed_png(png, psm)
        rows = table.group_words_into_rows(table.words_from_ocr(ocr["words"]))
        res = _extract_from_rows(ext, rows, False, "OCR_TABLE")
        if best is None or len(res.items) > len(best.items):
            best, best_ocr = res, ocr
        if res.items:
            break
    assert best is not None and best_ocr is not None
    if not best.items:
        # Header-less receipts: only lines whose numbers prove qty × rate = amount
        text_rows = table.rows_from_text(best_ocr["text"])
        fallback = table.extract_headerless_lines(text_rows)
        best = table.TableResult(fallback.items, best.columns, best.header_text, best.header_row_index,
                                 best.rows + fallback.rows, best.warnings + fallback.warnings)
    ext.add(best)
    ext.text_lines.extend(l for l in best_ocr["text"].splitlines() if l.strip())
    ext.layout_lines.extend(r.text for r in table.group_words_into_rows(table.words_from_ocr(best_ocr["words"])))
    ext.ocr_confidence = best_ocr["confidence"] if ext.ocr_confidence is None else min(ext.ocr_confidence, best_ocr["confidence"])
    ext.ocr_psm = best_ocr.get("psm")
    ext.language_data = best_ocr.get("language_data")
    ext.pages += 1


def _extract_text(ext: _Extraction, text: str) -> None:
    rows = table.rows_from_text(text)
    res = table.extract_table(rows, True, "TABLE_STRUCTURED")
    if not res.items:
        fb = table.extract_headerless_lines(rows)
        res = table.TableResult(fb.items, res.columns, res.header_text, res.header_row_index,
                                res.rows + fb.rows, res.warnings + fb.warnings)
    ext.add(res)
    ext.text_lines.extend(r.text for r in rows)
    ext.layout_lines.extend(r.text for r in rows)
    ext.pages += 1


def _detect_type(file_bytes: bytes, filename: str) -> str:
    ext = Path((filename or "").lower().strip()).suffix
    if ext == ".pdf" or file_bytes.startswith(b"%PDF"):
        return "pdf"
    if ext in IMAGE_EXTENSIONS or file_bytes.startswith(IMAGE_SIGNATURES):
        return "image"
    if ext in (".txt", ".csv") or ext == "":
        return "text"
    raise ValueError(
        f"Unsupported file format '{ext}'. Supported formats: PDF, Images (PNG, JPG, JPEG, WEBP, BMP, TIFF), and TXT."
    )


# --------------------------------------------------------------------------
# Metadata (never fabricated: missing fields are returned as None)
# --------------------------------------------------------------------------

_TITLE_RE = re.compile(r"^(?:tax\s+invoice|invoice|retail\s+invoice|bill\s+of\s+supply|cash\s+memo|estimate|"
                       r"quotation|original|duplicate|triplicate|delivery\s+challan|purchase\s+bill|bill)\b", re.I)
_PARTY_RE = re.compile(r"\b(?:bill\s*to|ship\s*to|buyer|customer|consignee|sold\s*to|m/s)\b", re.I)
_BUSINESS_RE = re.compile(r"\b(?:traders?|enterprises?|distributors?|agenc(?:y|ies)|wholesalers?|wholesale|stores?|"
                          r"mart|pvt|private|ltd|limited|llp|co\.?|company|suppliers?|marketing|sales|industries|"
                          r"foods?|corporation|brothers|bros|kirana|provisions|general)\b", re.I)
_GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b")
_INVNO_RE = re.compile(r"\b(?:invoice|inv|bill|voucher)\s*(?:no|number|num|#)\.?\s*[:#\-.]?\s*([A-Za-z0-9][A-Za-z0-9/\-_.]{0,30})", re.I)
_DATE_RE = re.compile(r"\b(\d{1,2}[/\-.]\d{1,2}[/\-.](?:\d{4}|\d{2})|\d{1,2}[\s\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|"
                      r"oct|nov|dec)[a-z]*[\s\-,]+\d{2,4})\b", re.I)
_TOTAL_PRIORITY = [
    (re.compile(r"^\s*grand\s*total\b", re.I), 4),
    (re.compile(r"^\s*(?:net\s*(?:amount|payable)|invoice\s*(?:total|value)|amount\s*payable|total\s*payable)\b", re.I), 3),
    (re.compile(r"^\s*total\s*(?:amount|amt)\b", re.I), 2),
    (re.compile(r"^\s*total\b", re.I), 1),
]


def extract_metadata(lines: List[str], header_text: Optional[str]) -> Dict[str, Any]:
    header_pos = next((i for i, l in enumerate(lines) if header_text and l.strip() == header_text.strip()), len(lines))
    top = lines[: min(header_pos, 15)] if header_pos else lines[:10]

    supplier, supplier_conf = None, 0.0
    fallback = None
    for line in top:
        clean = line.strip()
        if _PARTY_RE.search(clean):
            break
        if (not clean or _TITLE_RE.match(clean) or _GSTIN_RE.search(clean.upper()) or _INVNO_RE.search(clean)
                or re.search(r"\b(?:date|dated|phone|ph|mob|mobile|email|gstin|fssai|state)\b", clean, re.I)):
            continue
        words = re.findall(r"[A-Za-z&]{2,}", clean)
        if len(words) < 2 or sum(c.isdigit() for c in clean) > len(clean) * 0.3:
            continue
        if _BUSINESS_RE.search(clean):
            supplier, supplier_conf = clean, 85.0
            break
        fallback = fallback or clean
    if supplier is None and fallback:
        supplier, supplier_conf = fallback, 55.0

    invoice_number, inv_conf = None, 0.0
    invoice_date, date_conf = None, 0.0
    gstin = None
    for line in top or lines[:15]:
        if invoice_number is None:
            m = _INVNO_RE.search(line)
            if m:
                cand = m.group(1).rstrip(".-")
                if cand.lower() not in {"date", "dated", "dt", "no", "number"} and not _DATE_RE.fullmatch(cand):
                    invoice_number, inv_conf = cand, 85.0
        dm = _DATE_RE.search(line)
        if dm and (invoice_date is None or (date_conf < 85 and re.search(r"\bdate", line, re.I))):
            invoice_date = dm.group(1)
            date_conf = 85.0 if re.search(r"\bdate", line, re.I) else 60.0
        gm = _GSTIN_RE.search(line.upper())
        if gm and gstin is None:
            gstin = gm.group(0)

    invoice_total, best_priority = None, 0
    for line in lines[header_pos:] if header_pos < len(lines) else lines:
        for pattern, priority in _TOTAL_PRIORITY:
            if pattern.match(line) and priority >= best_priority:
                nums = re.findall(r"(?:₹|rs\.?\s*)?\d[\d,]*(?:\.\d+)?", line, re.I)
                if nums:
                    value = table.parse_number(nums[-1]).value
                    if value is not None and value > 0:
                        invoice_total, best_priority = value, priority
                break

    return {
        "supplier_name": supplier, "supplier_confidence": supplier_conf,
        "invoice_number": invoice_number, "invoice_no_confidence": inv_conf,
        "invoice_date": invoice_date, "date_confidence": date_conf,
        "gstin": gstin, "invoice_total": invoice_total,
    }


# --------------------------------------------------------------------------
# Invoice totals (printed values are reported, compared and never changed)
# --------------------------------------------------------------------------

# Label, optional ':', optional currency mark (OCR often turns ₹ into ®, ¥ or K), optional sign, number
_MONEY_AFTER_LABEL = (r"\s*:?\s*(?:₹|rs\.?|inr|[^\w\s\-−+.(]|[A-Z](?=\d))?\s*(?P<sign>\(\s*-\s*\)|[-−])?\s*"
                      r"(?:₹|rs\.?|inr)?\s*(?P<num>\d[\d,]*(?:\.\d+)?)")
_SUMMARY_LABELS = [
    ("sub_total", r"sub\s*-?\s*total"),
    ("round_off", r"round(?:ed)?\s*-?\s*off"),
    ("grand_total", r"grand\s*total|net\s*(?:amount|payable)|invoice\s*(?:total|value)|total\s*payable|amount\s*payable"),
    ("received", r"(?:amount\s*)?(?:received|paid)(?:\s*(?:amount|amt))?"),
    ("balance", r"balance\s*due|balance(?:\s*(?:amount|amt))?|amount\s*due"),
]
_SUMMARY_RES = [(key, re.compile(rf"\b(?:{label})\b{_MONEY_AFTER_LABEL}", re.I)) for key, label in _SUMMARY_LABELS]


def extract_summary_amounts(lines: List[str]) -> Dict[str, Decimal]:
    """Label-based amounts printed below the table: Sub Total, Round Off, Grand Total, Received, Balance."""
    found: Dict[str, Decimal] = {}
    for line in lines:
        for key, pattern in _SUMMARY_RES:
            m = pattern.search(line)
            if not m:
                continue
            value = table.parse_number(m.group("num")).value
            if value is None:
                continue
            found[key] = -value if m.group("sign") else value  # the last printed occurrence wins
    return found


def _sum(values: List[Optional[Decimal]]) -> Optional[Decimal]:
    present = [v for v in values if v is not None]
    return sum(present, Decimal(0)) if present else None


def _total_check(field_name: str, label: str, printed: Optional[Decimal], calculated: Optional[Decimal],
                 tolerance: Decimal, calc_label: str) -> TotalCheckSchema:
    if printed is None:
        return TotalCheckSchema(field=field_name, printed=None, calculated=_f(calculated), status="NOT_PRINTED",
                                message=f"{label}: no printed total to compare with ({calc_label} {table._money(calculated)})"
                                if calculated is not None else f"{label}: no printed total")
    if calculated is None:
        return TotalCheckSchema(field=field_name, printed=_f(printed), status="NOT_PRINTED",
                                message=f"{label}: printed total {table._money(printed)}; no line values to compare")
    diff = printed - calculated
    if diff == 0:
        status, note = "MATCH", "matches"
    elif abs(diff) <= tolerance:
        status, note = "ROUNDING", f"differs by {table._money(diff)}, within per-line paise rounding"
    elif field_name == "balance":
        status, note = "MISMATCH", f"differs by {table._money(diff)}; the Received or Balance amount may be misread"
    else:
        status, note = "MISMATCH", f"differs by {table._money(diff)}; a line may be misread or missing"
    if field_name == "quantity":
        printed_txt, calc_txt = table._fmt(printed), table._fmt(calculated)
    else:
        printed_txt, calc_txt = table._money(printed), table._money(calculated)
    return TotalCheckSchema(
        field=field_name, printed=_f(printed), calculated=_f(calculated), difference=_f(diff), status=status,
        message=f"{label}: printed total {printed_txt}, {calc_label} {calc_txt} — {note}. Printed values are kept.",
    )


def build_totals(lines: List[table.ExtractedLine], totals_row: Dict[str, Decimal],
                 summary: Dict[str, Decimal]) -> InvoiceTotalsSchema:
    n = len(lines)
    rounding = Decimal("0.005") * max(n, 1)
    qty_sum = _sum([l.quantity for l in lines])
    disc_sum = _sum([l.discount for l in lines])
    tax_sum = _sum([l.tax_amount for l in lines])
    amount_sum = _sum([l.line_total for l in lines])
    without_amount = sum(1 for l in lines if l.line_total is None)

    printed_amount = totals_row.get("total")
    checks = [
        _total_check("quantity", "Quantity", totals_row.get("qty"), qty_sum, Decimal(0), "lines add up to"),
        _total_check("discount", "Discount", totals_row.get("discount"), disc_sum, rounding, "lines add up to"),
        _total_check("tax", "Tax", totals_row.get("tax_amount"), tax_sum, rounding, "lines add up to"),
    ]
    # Amount: the TOTAL row, else Sub Total, else Grand Total less its printed round-off
    amount_label, amount_printed = "Amount", printed_amount
    if amount_printed is None and "sub_total" in summary:
        amount_label, amount_printed = "Sub total", summary["sub_total"]
    elif amount_printed is None and "grand_total" in summary:
        amount_label = "Grand total" + (" before round-off" if "round_off" in summary else "")
        amount_printed = summary["grand_total"] - summary.get("round_off", Decimal(0))
    amount_check = _total_check("amount", amount_label, amount_printed, amount_sum, rounding, "printed line amounts add up to")
    if without_amount and amount_check.status != "NOT_PRINTED":
        amount_check.message += f" {without_amount} line(s) had no readable amount."
    checks.append(amount_check)

    payable = summary.get("grand_total", printed_amount)
    if "balance" in summary and payable is not None:
        if "received" in summary:
            checks.append(_total_check("balance", "Balance", summary["balance"], payable - summary["received"],
                                       Decimal(0), "total − received ="))
        else:
            checks.append(_total_check("balance", "Balance", summary["balance"], payable, Decimal(0),
                                       "total (no received amount printed) ="))

    return InvoiceTotalsSchema(
        printed_quantity=_f(totals_row.get("qty")),
        printed_discount=_f(totals_row.get("discount")),
        printed_tax=_f(totals_row.get("tax_amount")),
        printed_taxable=_f(totals_row.get("taxable")),
        printed_amount=_f(printed_amount),
        sub_total=_f(summary.get("sub_total")),
        round_off=_f(summary.get("round_off")),
        grand_total=_f(summary.get("grand_total")),
        received=_f(summary.get("received")),
        balance=_f(summary.get("balance")),
        lines_quantity=_f(qty_sum),
        lines_discount=_f(disc_sum),
        lines_tax=_f(tax_sum),
        lines_amount=_f(amount_sum),
        lines_without_amount=without_amount,
        checks=checks,
    )


# --------------------------------------------------------------------------
# Inventory matching
# --------------------------------------------------------------------------


def match_inventory(name: str, barcode: Optional[str], products: List[Product]) -> Tuple[Optional[Product], float, str]:
    gtin = normalize_gtin(barcode)
    if gtin:
        for p in products:
            if normalize_gtin(p.sku) == gtin:
                return p, 1.0, "GTIN"
    if barcode:
        for p in products:
            if p.sku and p.sku.strip() == barcode.strip():
                return p, 1.0, "SKU"
    m = best_name_match(name, products, lambda p: p.name)
    return m.candidate, m.score, m.method


# --------------------------------------------------------------------------
# Main entry point
# --------------------------------------------------------------------------


def extract_invoice_from_bytes(file_bytes: bytes, filename: str, db: Session, shop_id: UUID) -> InvoiceExtractResponse:
    if not file_bytes or len(file_bytes.strip()) == 0:
        raise ValueError("Uploaded file is empty. Please upload a valid invoice document.")

    doc_type = _detect_type(file_bytes, filename)
    shop_products = db.query(Product).filter(Product.shop_id == shop_id).all()
    ext = _Extraction()

    if doc_type == "image":
        engine_used = "backend_ocr_pipeline"
        _ocr_image(ext, file_bytes)
    elif doc_type == "pdf":
        if b"%PDF" not in file_bytes[:1024]:
            raise ValueError("Invalid or corrupted PDF file: Missing standard %PDF signature.")
        digital_pages, scanned_pages, pdf_error = _read_pdf(file_bytes)
        if pdf_error:
            ext.warnings.append(f"PDF parser could not read the file ({pdf_error}); used raw text streams")
        if digital_pages:
            engine_used = "backend_pdf_direct"
            for words in digital_pages:
                rows = table.group_words_into_rows(words)
                ext.add(_extract_from_rows(ext, rows, False, "DIGITAL_PDF"))
                ext.text_lines.extend(r.text for r in rows)
                ext.layout_lines.extend(r.text for r in rows)
                ext.pages += 1
        elif scanned_pages:
            engine_used = "backend_pdf_ocr_scanned"
            for png in scanned_pages:
                _ocr_image(ext, png)
        else:
            engine_used = "backend_pdf_direct"
            raw_text = extract_text_from_pdf_stream(file_bytes)
            if len(raw_text.split()) >= 5:
                _extract_text(ext, raw_text)
            else:
                # Malformed scanned PDF: OCR the largest embedded JPEG
                jpegs = re.findall(b"(\xff\xd8\xff.*?\xff\xd9)", file_bytes, re.DOTALL)
                best_img = max(jpegs, key=len) if jpegs else b""
                if len(best_img) > 200:
                    engine_used = "backend_pdf_ocr_scanned"
                    _ocr_image(ext, best_img)
                else:
                    ext.warnings.append("No readable text or page images were found in the PDF")
    else:
        engine_used = "backend_text_direct"
        try:
            text = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            text = file_bytes.decode("latin1", errors="ignore")
        _extract_text(ext, text)

    meta = extract_metadata(ext.text_lines, ext.header_text)

    # Inventory matching, then MRP lookups using the strongest identifier available
    matches = [match_inventory(it.product_name, it.barcode, shop_products) for it in ext.items]
    queries = []
    for it, (prod, _, _) in zip(ext.items, matches):
        gtin = normalize_gtin(it.barcode) or (normalize_gtin(prod.sku) if prod is not None else None)
        queries.append(mrp_lookup.LookupQuery(product_name=it.product_name, gtin=gtin,
                                              sku=prod.sku if prod is not None else None))
    provider = mrp_lookup.get_provider()
    lookups = mrp_lookup.lookup_mrp_batch(queries, provider) if queries else []

    items: List[CanonicalInvoiceItemSchema] = []
    for it, (prod, score, method), lookup in zip(ext.items, matches, lookups):
        store_mrp = prod.mrp if prod is not None else None
        mrp, mrp_source, mrp_issues, mrp_review = mrp_lookup.resolve_line_mrp(_f(it.invoice_mrp), lookup, store_mrp)
        issues = list(it.issues) + mrp_issues
        needs_review = (
            bool(issues) or mrp_review or it.arithmetic_status != "VERIFIED"
            or it.purchase_price is None or it.quantity is None or it.confidence < 85
        )
        level = "HIGH" if it.confidence >= 85 and not needs_review else ("MEDIUM" if it.confidence >= 60 else "LOW")
        items.append(CanonicalInvoiceItemSchema(
            id=f"item_{uuid.uuid4().hex[:8]}",
            product_name=it.product_name,
            quantity=_f(it.quantity),
            unit=it.unit,  # as printed; never replaced by the inventory unit
            unit_normalized=it.unit_normalized,
            rate=_f(it.rate),
            purchase_price=_f(it.purchase_price),
            selling_price=_f(it.selling_price),
            mrp=mrp,
            mrp_source=mrp_source,
            invoice_mrp=_f(it.invoice_mrp),
            store_mrp=store_mrp,
            mrp_lookup=MrpLookupSchema(**lookup.to_dict()),
            raw_rate=_f(it.rate),
            raw_purchase_price=_f(it.purchase_price),
            raw_selling_price=_f(it.selling_price),
            raw_mrp=_f(it.invoice_mrp),
            discount=_f(it.discount),
            discount_pct=_f(it.discount_pct),
            taxable_amount=_f(it.taxable_amount),
            tax_amount=_f(it.tax_amount),
            gst_rate=_f(it.gst_rate),
            hsn_code=it.hsn_code,
            barcode=it.barcode,
            line_total=_f(it.line_total),
            amount=_f(it.line_total),
            line_total_source=it.line_total_source,
            calculated_amount=_f(it.calculated_amount),
            amount_difference=_f(it.amount_difference),
            arithmetic_status=it.arithmetic_status,
            arithmetic_rule=it.arithmetic_rule,
            arithmetic_explanation=it.arithmetic_explanation,
            purchasePrice=_f(it.purchase_price),
            confidence=it.confidence,
            confidence_level=level,
            needs_review=needs_review,
            source_text=it.source_text,
            raw_cells=it.raw_cells,
            extraction_method=it.extraction_method,
            validation_issues=issues,
            suggestions=it.suggestions,
            suggested_rate=_f(it.suggested_rate),
            matched_product_id=prod.id if prod is not None else None,
            matched_product_name=prod.name if prod is not None else None,
            match_score=round(score, 3) if prod is not None else None,
        ))

    summary = extract_summary_amounts(ext.layout_lines or ext.text_lines)
    totals = build_totals(ext.items, ext.totals_row, summary) if ext.items else None
    total_amount = _f(_sum([it.line_total for it in ext.items])) or 0.0
    total_units = _f(_sum([it.quantity for it in ext.items])) or 0.0
    warnings = list(dict.fromkeys(ext.warnings))
    if totals is not None:
        warnings.extend(c.message for c in totals.checks if c.status == "MISMATCH")
    # Invoice total: printed Grand Total, else the TOTAL row amount, else the best labelled total line
    if "grand_total" in summary:
        invoice_total = _f(summary["grand_total"])
    elif totals is not None and totals.printed_amount is not None:
        invoice_total = totals.printed_amount
    else:
        invoice_total = _f(meta["invoice_total"])

    if items:
        confidence = sum(i.confidence for i in items) / len(items)
    else:
        confidence = round(ext.ocr_confidence or 0.0, 1)
    status = "needs_review" if (not items or any(i.needs_review for i in items)) else "success"
    reason = None if items else (warnings[0] if warnings else "No product line items were detected in the document")

    columns = [DetectedColumnSchema(role=c.role, header_text=c.header_text,
                                    x_start=None if c.start == float("-inf") else round(c.start, 1),
                                    x_end=None if c.end == float("inf") else round(c.end, 1))
               for c in ext.columns]
    raw_text = "\n".join(ext.text_lines)
    diag = DiagnosticInfo(
        document_type=doc_type,
        engine_used=engine_used,
        total_raw_lines=len(ext.text_lines),
        total_raw_words=len(raw_text.split()),
        header_detected=ext.header_text is not None,
        header_text=ext.header_text,
        detected_columns=[c.role for c in ext.columns],
        columns=columns,
        rows=ext.rows[:300],
        detected_sections=["HEADER", "LINE_ITEMS"] if ext.header_text else [],
        warnings=warnings,
        ocr_psm=ext.ocr_psm,
        deskew_angle=ext.deskew_angle,
        ocr_language_data=ext.language_data,
        pages_processed=ext.pages,
        mrp_provider=provider.name,
    )

    return InvoiceExtractResponse(
        id=f"inv_{uuid.uuid4().hex[:10]}",
        supplier_name=meta["supplier_name"],
        supplier_confidence=meta["supplier_confidence"],
        invoice_number=meta["invoice_number"],
        invoice_no_confidence=meta["invoice_no_confidence"],
        invoice_date=meta["invoice_date"],
        date_confidence=meta["date_confidence"],
        gstin=meta["gstin"],
        invoice_total=invoice_total,
        total_amount=total_amount,
        total_units=total_units,
        total_items=len(items),
        confidence_score=round(confidence, 1),
        raw_ocr_text=raw_text,
        engine_used=engine_used,
        extraction_method="TABLE_STRUCTURED" if ext.header_text else ("TEXT_LINE_ITEM" if items else "NONE"),
        items=items,
        totals=totals,
        status=status,
        reason=reason,
        diagnostics=diag,
    )


# --------------------------------------------------------------------------
# Confirmation: one transaction for products, stock and the purchase record
# --------------------------------------------------------------------------


def _merge_duplicate_lines(items):
    """Same product twice on one invoice -> one stock movement."""
    merged: List[Any] = []
    for item in items:
        key_id = item.matched_product_id
        key_name = normalize_name(item.name)
        existing = next((m for m in merged if (key_id and m.matched_product_id == key_id)
                         or (normalize_name(m.name) == key_name)), None)
        if existing is None:
            merged.append(item.model_copy())
            continue
        if abs(existing.purchase_price - item.purchase_price) > 0.005:
            raise InvoiceValidationError(
                f"'{item.name}' appears twice with different purchase prices "
                f"(₹{existing.purchase_price:g} and ₹{item.purchase_price:g}); correct or remove one line."
            )
        old_qty = existing.quantity
        existing.quantity = old_qty + item.quantity
        if existing.line_amount is not None or item.line_amount is not None:
            existing.line_amount = (
                (existing.line_amount if existing.line_amount is not None else round(old_qty * existing.purchase_price, 2))
                + (item.line_amount if item.line_amount is not None else round(item.quantity * item.purchase_price, 2))
            )
        for attr in ("selling_price", "mrp", "mrp_source"):
            if getattr(existing, attr) is None and getattr(item, attr) is not None:
                setattr(existing, attr, getattr(item, attr))
    return merged


def confirm_and_update_stock(db: Session, shop_id: UUID, confirm_in: InvoiceConfirmRequest) -> InvoiceConfirmResponse:
    try:
        items = _merge_duplicate_lines(confirm_in.items)

        supplier_id = confirm_in.supplier_id
        if supplier_id:
            supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.shop_id == shop_id).first()
            if not supplier:
                raise InvoiceValidationError("Supplier not found for this shop.")
        elif confirm_in.supplier_name and confirm_in.supplier_name.strip():
            supplier = db.query(Supplier).filter(
                Supplier.shop_id == shop_id,
                Supplier.supplier_name.ilike(confirm_in.supplier_name.strip()),
            ).first()
            if not supplier:
                supplier = Supplier(shop_id=shop_id, supplier_name=confirm_in.supplier_name.strip())
                db.add(supplier)
                db.flush()
            supplier_id = supplier.id

        invoice_number = (confirm_in.invoice_number or "").strip() or None
        if invoice_number:
            dup = db.query(Purchase).filter(
                Purchase.shop_id == shop_id,
                Purchase.invoice_number == invoice_number,
                Purchase.supplier_id == supplier_id,
            ).first()
            if dup:
                when = dup.created_at.strftime("%d/%m/%Y") if dup.created_at else "earlier"
                raise InvoiceConflictError(
                    f"Invoice {invoice_number} from this supplier was already added to stock ({when}). "
                    "Stock was not changed again."
                )

        # Resolve every product before changing anything
        resolved: List[Tuple[Any, Optional[Product]]] = []
        for item in items:
            product = None
            if item.matched_product_id:
                product = db.query(Product).filter(Product.id == item.matched_product_id, Product.shop_id == shop_id).first()
                if product is None:
                    raise InvoiceValidationError(f"Matched product for '{item.name}' does not belong to this shop.")
            if product is None:
                product = db.query(Product).filter(Product.shop_id == shop_id, Product.name.ilike(item.name.strip())).first()
            resolved.append((item, product))

        missing_sp = [item.name for item, product in resolved if product is None and item.selling_price is None]
        if missing_sp:
            raise InvoiceValidationError("Selling price is required for new products: " + ", ".join(missing_sp))

        db_purchase = Purchase(shop_id=shop_id, supplier_id=supplier_id, total_amount=0.0,
                               invoice_number=invoice_number, invoice_date=confirm_in.invoice_date)
        db.add(db_purchase)
        db.flush()

        now = datetime.now(timezone.utc)
        total_amount = 0.0
        total_units = 0.0
        restocked = created = 0
        for item, product in resolved:
            qty = int(item.quantity)
            mrp_source = (item.mrp_source or "MANUAL") if item.mrp is not None else None
            if product is not None:
                product.current_stock = (product.current_stock or 0) + qty
                product.purchase_price = item.purchase_price
                if item.selling_price is not None:
                    product.selling_price = item.selling_price
                restocked += 1
            else:
                product = Product(
                    shop_id=shop_id,
                    name=item.name.strip(),
                    category=item.category or "Groceries",
                    purchase_price=item.purchase_price,
                    selling_price=item.selling_price,
                    current_stock=qty,
                    unit=item.unit or "pcs",
                    reorder_level=10,
                )
                db.add(product)
                created += 1
            # A missing MRP never clears a stored one
            if item.mrp is not None:
                product.mrp = item.mrp
                product.mrp_source = mrp_source
                product.mrp_updated_at = now
            db.add(product)
            db.flush()

            line_amount = item.line_amount if item.line_amount is not None else round(qty * item.purchase_price, 2)
            total_amount += line_amount
            total_units += qty
            db.add(PurchaseItem(
                purchase_id=db_purchase.id,
                product_id=product.id,
                quantity=qty,
                purchase_price=item.purchase_price,
                line_amount=line_amount,
                mrp=item.mrp,
                mrp_source=mrp_source,
            ))

        db_purchase.total_amount = round(total_amount, 2)
        db.commit()
        db.refresh(db_purchase)

        return InvoiceConfirmResponse(
            purchase_id=db_purchase.id,
            shop_id=shop_id,
            supplier_name=confirm_in.supplier_name,
            invoice_number=invoice_number,
            total_amount=db_purchase.total_amount,
            total_units=total_units,
            items_restocked=restocked,
            items_created=created,
            created_at=db_purchase.created_at or now,
        )
    except Exception:
        db.rollback()
        raise
