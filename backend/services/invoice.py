"""
Invoice scanning orchestration.

Upload -> file validation -> Header-Guided Dynamic Grocery Extraction pipeline
-> inventory matching -> MRP resolution (services/mrp_lookup.py) -> API response.

Stock is only changed by confirm_and_update_stock(), in one transaction.
"""

import io
import logging
import os
import re
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from services import ocr as ocr_service
from services import mrp_lookup
from services.invoice_pack_pricing import cost_invoice_line, pack_conversions
from services.product_matching import best_name_match, inventory_name_similarity, normalize_gtin, normalize_name
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
    MrpLookupSchema,
)
from schemas.product import ProductResponse
from services.shop_member import get_shop_member, ShopRole
from services.pricing_audit import create_pricing_audit_log

logger = logging.getLogger(__name__)

from services.grocery_ocr.engines.ocr_engine import TesseractOCREngine
from sqlalchemy import null as sa_null
from services.invoice_reconciliation import reconcile_invoice_total
from services.money import format_rupees, keep_printed_precision, quantize_half_up, to_decimal, to_number
from services.stock import add_stock, format_quantity, to_stock_quantity, validate_unit_text, StockError
from services.unit_registry import (
    ALIASES,
    are_units_compatible,
    convert_quantity,
    InexactConversionError,
    normalize_unit,
    try_normalize_unit,
    UnitError,
    validate_quantity_unit,
)
from services.pricing_engine import (
    calculate_purchase_cost,
    evaluate_mrp_ceiling,
    round_price,
    PricingEngineError,
)
from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline

USE_NEW_GROCERY_OCR = os.getenv("USE_NEW_GROCERY_OCR", "true").lower() in ("true", "1", "yes")

MAX_PDF_PAGES = 5
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}
IMAGE_SIGNATURES = (b"\xff\xd8", b"\x89PNG", b"RIFF", b"BM", b"II*\x00", b"MM\x00*")


class InvoiceConflictError(ValueError):
    """The same supplier invoice was already added to stock."""


class InvoiceValidationError(ValueError):
    """The confirm request is incomplete (e.g. a new product without a selling price)."""


class InvoicePermissionError(PermissionError):
    """Raised when an unauthorized user attempts an operation requiring elevated privileges."""


# --------------------------------------------------------------------------
# Backward-compatible helpers (kept for existing callers/tests)
# --------------------------------------------------------------------------

CORE_ROLES = {"qty", "unit", "rate", "purchase_price", "selling_price", "mrp", "discount", "tax", "amount", "line_total"}


class LegacyColumn:
    def __init__(self, col_type: str, x0: float = 0.0, x1: float = 0.0):
        self.type = col_type
        self.x0 = x0
        self.x1 = x1


def detect_columns_from_header_words_py(words: List[Dict[str, Any]], max_w: float = 0.0) -> List[LegacyColumn]:
    HEADER_ROLES = {
        "item": "product", "description": "product", "particulars": "product", "product": "product",
        "qty": "qty", "quantity": "qty",
        "unit": "unit", "uom": "unit",
        "rate": "rate", "price": "rate",
        "amount": "total", "total": "total", "value": "total"
    }
    cols: List[LegacyColumn] = []
    i = 0
    while i < len(words):
        w = words[i]
        txt = str(w.get("text", "")).lower().strip()
        bbox = w.get("bbox", {})
        x0 = float(bbox.get("x0", 0))
        x1 = float(bbox.get("x1", 0))

        if i + 1 < len(words) and words[i + 1].get("text", "").strip() in ("(₹)", "₹", "(rs)", "(inr)", "(Rs.)"):
            x1 = float(words[i + 1].get("bbox", {}).get("x1", x1))
            i += 1

        role = HEADER_ROLES.get(txt)
        if role:
            cols.append(LegacyColumn(role, x0, x1))
        i += 1
    return cols


def is_conflicting_pair_py(type_a: str, type_b: str) -> bool:
    core = CORE_ROLES | {"product"}
    return type_a != type_b and type_a in core and type_b in core


def parse_smart_price_py(tok: Optional[str], allow_zero: bool = False) -> Optional[float]:
    raw = (tok or "").strip()
    if not raw or raw.lower() in {"-", "—", "–", "--", "n/a", "na", "nil", "null", "none", "."}:
        return None
    negative = False
    m = re.match(r"^\((.*)\)$", raw)
    if m:
        negative = True
        raw = m.group(1)
    s = re.sub(r"(?i)₹|rs\.?|inr", " ", raw)
    s = re.sub(r"/-", " ", s)
    s = re.sub(r"/\s*[a-zA-Z]+\b", " ", s)
    s = s.replace("%", " ")
    s = re.sub(r"(\d)\s*\.\s*(\d)", r"\1.\2", s)
    s = s.strip()
    if re.match(r"^\d{1,3}(?:\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$", s):
        # Decimal comma ('2.350,00', '12,50'): dots are thousands separators
        int_part, frac_part = s.rsplit(",", 1)
        s = f"{int_part.replace('.', '')}.{frac_part}"
    else:
        s = s.replace(",", "")
    match = re.search(r"[-+]?\d*\.?\d+", s)
    if not match:
        return None
    try:
        val = float(match.group(0))
        if val < 0:
            return val
        if not allow_zero and val == 0:
            return None
        return -val if negative else val
    except ValueError:
        return None


def suggest_registered_unit(text: str) -> Optional[str]:
    """The one registered unit spelling that an OCR'd unit differs from by a single character
    ('pes' -> 'pcs', 'pit' -> 'pkt'); None when there is no such spelling or more than one."""
    t = (text or "").strip().lower()
    if len(t) < 2:
        return None
    hits = set()
    for alias in ALIASES:
        if len(alias) == len(t) and sum(1 for a, b in zip(alias, t) if a != b) == 1:
            hits.add(ALIASES[alias])
    if len(hits) != 1:
        return None
    unit_id = hits.pop()
    same_len = sorted(a for a, u in ALIASES.items() if u == unit_id and len(a) == len(t)
                      and sum(1 for x, y in zip(a, t) if x != y) == 1)
    return same_len[0] if same_len else unit_id


# Decimal money helpers now live in services/money.py (shared with sales, purchases, voice and reports)
_dec = to_decimal
_money = quantize_half_up
_num = to_number
_keep_printed_precision = keep_printed_precision


def resolve_item_arithmetic_py(
    qty: Optional[float], rate: Optional[float], total: Optional[float], tax: Optional[float] = None,
    discount: Optional[float] = None, price_basis_quantity: Optional[float] = 1.0,
) -> Dict[str, Any]:
    """Check (quantity x rate / basis) - discount + tax against the printed amount (Decimal arithmetic).

    Values are never changed here: a mismatch is reported with suggestions only.
    """
    issues: List[str] = []
    suggestions: List[str] = []
    suggested_rate: Optional[float] = None
    status = "VERIFIED"
    line_total = total
    line_total_source = "INVOICE"
    q, r, t = _dec(qty), _dec(rate), _dec(total)
    tx, dc = _dec(tax) or Decimal("0"), _dec(discount) or Decimal("0")
    b_qty = _dec(price_basis_quantity) or Decimal("1.0")
    if b_qty <= 0:
        b_qty = Decimal("1.0")

    if q is not None and r is not None:
        base = (q * r) / b_qty
        expected = base - dc + tx
        if t is None:
            line_total = float(_keep_printed_precision(expected))
            line_total_source = "CALCULATED"
            status = "INSUFFICIENT_DATA"
            issues.append("Line amount not printed on invoice; calculated from quantity × rate")
        elif abs(expected - t) > max(Decimal("1.0"), t * Decimal("0.01")):
            status = "MISMATCH"
            issues.append(f"Amount ₹{t:,.2f} does not match quantity × rate ({q:,.2f} × ₹{r:,.2f} = ₹{base:,.2f})")
            tol = max(Decimal("1.0"), t * Decimal("0.01"))
            if q > 0 and abs(((q / 10) * r) / b_qty - dc + tx - t) <= tol:
                suggestions.append(f"Quantity may be {(q / 10).normalize():f} (shifted decimal)")
            elif q > 0 and abs(((q / 100) * r) / b_qty - dc + tx - t) <= tol:
                suggestions.append(f"Quantity may be {(q / 100).normalize():f} (shifted decimal)")
    elif q is not None and r is None:
        if t is not None and q > 0:
            suggested_rate = float(_keep_printed_precision(((t + dc - tx) * b_qty) / q))
            status = "MISMATCH"
            issues.append("Rate could not be read; suggested from line amount ÷ quantity")
    elif t is None and r is not None:
        issues.append("Quantity not printed on invoice")
        status = "MISMATCH"

    return {
        "quantity": qty,
        "rate": rate,
        "purchase_price": rate,
        "price_basis_quantity": float(b_qty),
        "normalized_purchase_price": float(_keep_printed_precision(r / b_qty)) if r is not None else None,
        "line_total": line_total,
        "line_total_source": line_total_source,
        "status": status,
        "issues": issues,
        "suggestions": suggestions,
        "suggested_rate": suggested_rate,
    }


def suggest_misread_decimal_rate(
    raw_rate: Any, quantity: Optional[float], printed_amount: Optional[float],
    discount: float = 0.0, tax: float = 0.0,
) -> Optional[float]:
    """Rate reading that explains a quantity x rate mismatch by one lost or misread decimal point.

    OCR sometimes reads a decimal point as a digit ("58.75" -> "58575") or drops it. Each
    single-point reading of the rate's digits is tried; a candidate is returned only when it is
    the one reading for which quantity x rate reproduces the printed amount exactly. It is a
    suggestion for the reviewer and is never applied automatically.
    """
    if raw_rate is None or not quantity or quantity <= 0 or printed_amount is None:
        return None
    text = str(raw_rate).strip()
    m = re.fullmatch(r"(\d+)(?:\.0+)?", text)
    if m:
        digits = m.group(1)
    else:
        value = _dec(text.replace(",", ""))
        if value is None or value != value.to_integral_value():
            return None
        digits = str(int(value))
    if len(digits) < 3:
        return None
    readings = set()
    for i in range(1, len(digits)):
        readings.add(digits[:i] + "." + digits[i:])  # decimal point dropped
        if i < len(digits) - 1:
            readings.add(digits[:i] + "." + digits[i + 1:])  # decimal point read as a digit
    # Decimal throughout (no float tolerance comparisons); a match keeps up to 3 decimals
    q, target = _dec(quantity), _dec(printed_amount) + (_dec(discount) or Decimal("0")) - (_dec(tax) or Decimal("0"))
    matches = set()
    for r in readings:
        cand = Decimal(r)
        if cand > 0 and abs(q * cand - target) <= Decimal("0.011"):
            matches.add(_keep_printed_precision(cand))
    return float(matches.pop()) if len(matches) == 1 else None


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
# "(?:in|n)?voice" also accepts OCR output that clipped the first letters of "Invoice"
_INV_VAL_PATTERN = r"([A-Za-z0-9]+(?:\s*[/\-_#.]\s*(?!(?:date|dated|dt|gstin|ph|phone)\b)[A-Za-z0-9]+)*)"
_INVNO_RE = re.compile(r"\b(?:(?:in|n)?voice|inv|bill|voucher)\s*(?:no|number|num|#)\.?\s*[:#\-.]?\s*" + _INV_VAL_PATTERN, re.I)
# A dash separates label and value only with spaces around it: "INV-00427" is itself an invoice code
_INV_COLON_RE = re.compile(r"\b(?:(?:in|n)?voice|inv|bill)(?:\s*[:#]|\s+-)\s*" + _INV_VAL_PATTERN, re.I)
_INVNO_LABEL_END_RE = re.compile(r"\b(?:(?:in|n)?voice|inv|bill|voucher)\s*(?:no|number|num|#)\.?\s*[:#\-.]?\s*$", re.I)
_PHONE_RE = re.compile(r"\b(?:\+91[\-\s]?)?[6-9]\d{9}\b")
# Column headings of an item table; a line with two or more of them is the table header row
_COLUMN_WORD_RE = re.compile(r"\b(?:qty|quantity|rate|amount|total|mrp|hsn|description|particulars|item|items|unit|"
                             r"uom|price|s\.?\s?no|sl|disc|gst|tax)\b", re.I)
# A labelled field such as "Invoice No:", "Ph No.", "Order #" is never a business name
_FIELD_LABEL_RE = re.compile(r"\b(?:no|nos|number|num)\s*[.:#]|#\s*\S", re.I)
_DATE_RE = re.compile(r"\b(\d{1,2}[/\-.]\d{1,2}[/\-.](?:\d{4}|\d{2})|\d{1,2}[\s\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|"
                      r"oct|nov|dec)[a-z]*[\s\-,]+\d{2,4})\b", re.I)
_TOTAL_PRIORITY = [
    (re.compile(r"^\s*grand\s*total\b", re.I), 4),
    (re.compile(r"^\s*(?:net\s*(?:amount|payable)|invoice\s*(?:total|value)|amount\s*payable|total\s*payable)\b", re.I), 3),
    (re.compile(r"^\s*total\s*(?:amount|amt)\b", re.I), 2),
    (re.compile(r"^\s*total\b", re.I), 1),
]


# Document titles printed on the same line as the business name ("... TRADERS        TAX INVOICE")
_TITLE_PHRASE_RE = re.compile(
    r"\b(?:(?:tax|retail|gst|sales|proforma|commercial)\s*invoice|bill\s+of\s+supply|cash\s+memo|invoice|"
    r"(?:original|duplicate|triplicate)\s+(?:for\s+\w+|copy))\b", re.I)
# A GSTIN label with its value even when OCR misread the value (14 characters, a wrong letter); the value
# must contain a digit, so a business word after the label ("GSTIN Wholesale") is never taken as one
_GSTIN_LABEL_RE = re.compile(r"\b(?i:gst(?:in)?(?:\s*/\s*uin)?(?:\s*(?:no|number))?)\.?\s*[:#\-.]?\s*"
                             r"(?=[0-9A-Z]*\d)[0-9A-Z]{8,16}\b")


def _strip_document_titles(text: str) -> str:
    return re.sub(r"\s+", " ", _TITLE_PHRASE_RE.sub(" ", text)).strip()


def _clean_supplier_candidate(text: str) -> str:
    """Remove known metadata tokens (invoice numbers, GSTIN, dates, phone, email, FSSAI)
    from a header line to reveal the underlying business name if printed side-by-side."""
    cand = text
    cand = _INVNO_RE.sub(" ", cand)
    cand = _INV_COLON_RE.sub(" ", cand)
    cand = _strip_document_titles(cand)  # after the invoice-number labels, which contain "Invoice"
    # A document code such as "INV-00427" or "SBW/2026/0912" (letters, a separator, 3+ digits) is never part
    # of a business name, even when the label in front of it was not read
    cand = re.sub(r"\b[A-Za-z]{1,6}\s?[-/]\s?\d{3,}(?:[-/][A-Za-z0-9]+)*\b", " ", cand)
    cand = _GSTIN_LABEL_RE.sub(" ", cand)
    cand = _GSTIN_RE.sub(" ", cand)
    cand = _DATE_RE.sub(" ", cand)
    cand = re.sub(r"\b(?:date|dated)\s*[:#\-.]?\s*\S+", " ", cand, flags=re.I)
    cand = re.sub(r"\b(?:phone|ph|mob|mobile|tel|contact)\s*[:#\-.]?\s*[\d+\-\s]{6,15}", " ", cand, flags=re.I)
    cand = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", " ", cand)
    cand = re.sub(r"\b(?:www\.[^\s]+|[a-zA-Z0-9.-]+\.(?:com|in|org|net))\b", " ", cand, flags=re.I)
    cand = re.sub(r"\bfssai\s*[:#\-.]?\s*\d+", " ", cand, flags=re.I)
    cand = re.sub(r"\bstate\s*(?:code)?\s*[:#\-.]?\s*[A-Za-z0-9]+", " ", cand, flags=re.I)
    cand = _FIELD_LABEL_RE.sub(" ", cand)
    cand = re.sub(r"[\s|,:;._\-/#*~=`^<>()\[\]{}]+", " ", cand).strip(" *|,:;._-/#~=`^<>()[]{}")
    # Trailing OCR debris where the name runs into a neighbouring field ('TRADER §veice' when the name
    # overlaps 'Invoice No:'): a token with a character no business name uses is dropped from the end
    # only; '&', apostrophes and dots ("Sri Ram & Co.", "Kumar's") are kept.
    tokens = cand.split()
    while len(tokens) > 1 and re.search(r"[^\w&'.]", tokens[-1]):
        tokens.pop()
    return " ".join(tokens)


def _merge_title_fragments(lines: List[str]) -> List[str]:
    """Rejoin a heading that OCR line reconstruction split into one-word lines.

    Large title text (usually the supplier name) can come back as consecutive single-word
    lines ("SRI", "LAKSHMI", "WHOLESALE", "TRADERS"). Runs of such lines are joined so the
    name can be recognised; all other lines are returned unchanged and in order.
    """
    merged: List[str] = []
    run: List[str] = []
    for line in lines:
        clean = line.strip()
        if re.fullmatch(r"[A-Za-z][A-Za-z&.'\-]+", clean):
            run.append(clean)
            continue
        if len(run) >= 2:
            merged.append(" ".join(run))
        else:
            merged.extend(run)
        run = []
        merged.append(line)
    if len(run) >= 2:
        merged.append(" ".join(run))
    else:
        merged.extend(run)
    return merged


def extract_metadata(lines: List[str], header_text: Optional[str]) -> Dict[str, Any]:
    header_pos = next((i for i, l in enumerate(lines) if header_text and l.strip() == header_text.strip()), len(lines))
    top = lines[: min(header_pos, 15)] if header_pos else lines[:10]

    supplier, supplier_conf = None, 0.0
    fallback = None
    first_standalone = None  # first plausible line printed on its own (nothing but the name was on it)
    for line in _merge_title_fragments(top):
        clean = line.strip()
        if _PARTY_RE.search(clean):
            break
        if len(_COLUMN_WORD_RE.findall(clean)) >= 2:
            break  # reached the item table: the supplier is printed above it, never in it

        # Strip metadata labels and values that may share the line with supplier name
        cand = _clean_supplier_candidate(clean)
        if not cand or _TITLE_RE.match(cand):
            continue

        words = re.findall(r"[A-Za-z&]{2,}", cand)
        if len(words) < 2 or sum(c.isdigit() for c in cand) > len(cand) * 0.3:
            continue
        if len(_COLUMN_WORD_RE.findall(cand)) >= 2:
            continue

        # A details line is one where metadata had to be removed (GSTIN, phone, invoice number, date...);
        # what is left of it ("GSTIN: 27... | Wholesale Grocery Distributors") is often a tagline
        line_words = re.findall(r"[A-Za-z0-9&]+", _strip_document_titles(clean))
        is_details_line = len(re.findall(r"[A-Za-z0-9&]+", cand)) < len(line_words)
        if _BUSINESS_RE.search(cand):
            if is_details_line and first_standalone:
                supplier, supplier_conf = first_standalone, 70.0
            else:
                supplier, supplier_conf = cand, 85.0
            break
        if not is_details_line and first_standalone is None:
            first_standalone = cand
        fallback = fallback or cand

    if supplier is None and (first_standalone or fallback):
        supplier, supplier_conf = first_standalone or fallback, 55.0

    invoice_number, inv_conf = None, 0.0
    invoice_date, date_conf = None, 0.0
    gstin = None
    search_lines = list(top or lines[:15])
    for idx, line in enumerate(search_lines):
        if invoice_number is None:
            m = _INVNO_RE.search(line) or _INV_COLON_RE.search(line)
            if m:
                cand = m.group(1).rstrip(".-")
                cand_clean = cand.strip(" .:-_/#")
                cand_clean = re.sub(r"\s*([/\-_#])\s*", r"\1", cand_clean)
                is_invalid = (
                    cand_clean.lower() in {"date", "dated", "dt", "no", "number", "num", "invoice", "inv", "bill"}
                    or _DATE_RE.search(cand_clean)
                    or _GSTIN_RE.search(cand_clean.upper())
                    or bool(_PHONE_RE.search(cand_clean))
                    or len(cand_clean) < 1
                    or len(cand_clean) > 35
                )
                if not is_invalid:
                    invoice_number, inv_conf = cand_clean, 85.0
            elif idx + 1 < len(search_lines) and _INVNO_LABEL_END_RE.search(line):
                # Check for multi-line: "Invoice No:" on this line, number on next line
                next_line = search_lines[idx + 1].strip()
                nm = re.match(r"^" + _INV_VAL_PATTERN + r"$", next_line)
                if nm:
                    ncand = nm.group(1).strip(" .:-_/#")
                    ncand = re.sub(r"\s*([/\-_#])\s*", r"\1", ncand)
                    if (
                        ncand.lower() not in {"date", "dated", "dt", "no", "number", "num"}
                        and not _DATE_RE.search(ncand)
                        and not _GSTIN_RE.search(ncand.upper())
                        and not _PHONE_RE.search(ncand)
                        and 1 <= len(ncand) <= 35
                    ):
                        invoice_number, inv_conf = ncand, 85.0

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
                    clean_num = re.sub(r"[^\d.]", "", nums[-1])
                    value = _dec(clean_num)  # Decimal from the printed text, never via float
                    if value is not None and value > 0:
                        invoice_total, best_priority = _num(_keep_printed_precision(value)), priority
                break

    return {
        "supplier_name": supplier, "supplier_confidence": supplier_conf,
        "invoice_number": invoice_number, "invoice_no_confidence": inv_conf,
        "invoice_date": invoice_date, "date_confidence": date_conf,
        "gstin": gstin, "invoice_total": invoice_total,
    }


_HEADER_FIELDS = (("supplier_name", "supplier_confidence"), ("invoice_number", "invoice_no_confidence"),
                  ("invoice_date", "date_confidence"), ("gstin", None))


def extract_metadata_from_readings(lines: List[str], header_text: Optional[str],
                                   layout_lines: Optional[List[str]] = None) -> Dict[str, Any]:
    """Invoice header fields when a page was read in two layouts.

    The table may be kept from the single-block reading (PSM 6) because it reads ruled tables better, but
    that reading treats the page as one uniform block and was measured to drop or garble header text in a
    different size or position (TC13: the large supplier title line is missing; TC02: 'Invoice No' read as
    'voice No: pasa'; TC03: the invoice number is lost), while the automatic page-layout reading (PSM 3) of
    the same image keeps it. Each header field is therefore taken from the automatic-layout reading when it
    has one with at least the same confidence, else from the table reading. The printed total (below the
    table) always comes from the table reading. No extra OCR: both readings already exist."""
    meta = extract_metadata(lines, header_text)
    if not layout_lines or layout_lines == lines:
        return meta
    layout = extract_metadata(layout_lines, None)
    for field, conf in _HEADER_FIELDS:
        if not layout.get(field):
            continue
        if conf is None or not meta.get(field) or float(layout.get(conf) or 0) >= float(meta.get(conf) or 0):
            meta[field] = layout[field]
            if conf:
                meta[conf] = layout[conf]
    return meta


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
    m = best_name_match(name, products, lambda p: p.name, scorer=inventory_name_similarity)
    return m.candidate, m.score, m.method


# --------------------------------------------------------------------------
# Pipeline entry point
# --------------------------------------------------------------------------


def _extract_invoice_with_new_pipeline(
    file_bytes: bytes, filename: str, db: Session, shop_id: UUID
) -> InvoiceExtractResponse:
    shop_products = db.query(Product).filter(Product.shop_id == shop_id).all()
    pipeline = InvoicePipeline(ocr_engine=TesseractOCREngine())
    extracted = pipeline.process(file_bytes, filename, candidate_products=shop_products)

    if extracted.status == "FAILED":
        raise ValueError(extracted.reason or "Failed to process invoice document.")

    # External MRP lookup integration
    queries = []
    for it in extracted.items:
        p_name = it.normalized_product_name or it.raw_product_name
        gtin = normalize_gtin(it.barcode)
        queries.append(mrp_lookup.LookupQuery(product_name=p_name, gtin=gtin, sku=None))
    provider = mrp_lookup.get_provider()
    lookups = mrp_lookup.lookup_mrp_batch(queries, provider) if queries else []

    items: List[CanonicalInvoiceItemSchema] = []
    for idx, it in enumerate(extracted.items):
        meta_x = it.metadata or {}
        components = {k: _dec(v) for k, v in (meta_x.get("financial_components") or {}).items() if _dec(v) is not None}
        review_reasons: List[str] = list(meta_x.get("review_reasons") or [])
        extraction_suggestions: List[str] = list(meta_x.get("extraction_suggestions") or [])
        qty_details: Dict[str, Any] = dict(meta_x.get("quantity_details") or {})
        # Fields that were CALCULATED, not read from the invoice (e.g. pieces from cases x units per case)
        derived: List[str] = list(meta_x.get("derived_fields") or [])
        is_free_item = bool(meta_x.get("is_free_item"))

        # All financial arithmetic is Decimal; floats only at the response boundary
        q_d = _dec(it.quantity)
        pp_d = _dec(it.purchase_price)
        prn_d = _dec(it.printed_amount)
        calc_d = _dec(it.calculated_amount)
        tot_d = prn_d if prn_d is not None else calc_d
        disc_d = _dec(it.discount) or Decimal("0")
        tax_d = _dec(it.tax_amount) or Decimal("0")
        sp = float(it.selling_price) if it.selling_price is not None else None
        m = float(it.mrp) if it.mrp is not None else None
        # A line amount that was not identified stays empty (no "last number in the row" guess);
        # an amount the pipeline calculated (no printed amount) is a calculated value, never "read"
        if prn_d is None and calc_d is not None:
            derived.append("line_total")
            review_reasons.append("Line amount was not read from the invoice: calculated from quantity × rate.")

        if q_d is None and pp_d is not None and pp_d > 0 and tot_d is not None:
            pre_tax = tot_d + disc_d - tax_d
            cand_q = pre_tax / pp_d
            for test_q in (_money(cand_q, "1"), _money(cand_q, "0.1"), _money(cand_q, "0.001")):
                if test_q > 0 and abs(test_q * pp_d - pre_tax) <= max(Decimal("1.5"), tot_d * Decimal("0.01")):
                    q_d = test_q
                    derived.append("quantity")
                    review_reasons.append(
                        f"Quantity was not read from the invoice: calculated as ₹{_keep_printed_precision(pre_tax)} ÷ ₹{pp_d} = "
                        f"{test_q.normalize():f}. Please check it.")
                    break

        if pp_d is None and q_d is not None and q_d > 0 and tot_d is not None:
            pre_tax = tot_d + disc_d - tax_d
            pp_d = _keep_printed_precision(pre_tax / q_d)
            derived.append("purchase_price")
            review_reasons.append(
                f"Rate was not read from the invoice: calculated as ₹{_keep_printed_precision(pre_tax)} ÷ {q_d.normalize():f} = "
                f"₹{pp_d}. Please check it.")

        if tot_d is None and q_d is not None and pp_d is not None:
            tot_d = _keep_printed_precision(q_d * pp_d - disc_d + tax_d)
            if "line_total" not in derived:
                derived.append("line_total")
                review_reasons.append("Line amount was not read from the invoice: calculated from quantity × rate.")

        # Promotions ("10+1"): line arithmetic uses the paid units; the quantity received into stock is
        # paid + free. A printed free line (rate 0.00) is all free units. Costs are never redistributed.
        free_d = _dec(qty_details.get("free_quantity"))
        paid_d: Optional[Decimal] = None
        received_d = q_d
        if is_free_item and q_d is not None:
            paid_d, free_d, received_d = Decimal("0"), q_d, q_d
        elif free_d is not None and free_d > 0 and q_d is not None:
            paid_d, received_d = q_d, q_d + free_d

        q, pp = _num(q_d), _num(pp_d)
        prn, calc, tot = _num(prn_d), _num(calc_d), _num(tot_d)
        disc, tax = float(disc_d), float(tax_d)

        # "Verified" only when quantity, rate and amount were all READ and agree; a calculated value
        # agrees with the arithmetic by construction and therefore proves nothing.
        read_values_agree = (
            q_d is not None and pp_d is not None and tot_d is not None
            and abs(q_d * pp_d - disc_d + tax_d - tot_d) <= Decimal("1.5")
        )
        no_calculated_core = not ({"quantity", "purchase_price", "line_total"} & set(derived))
        verified = no_calculated_core and ((it.validation_status == "VERIFIED") or read_values_agree)
        if is_free_item:
            review_reasons.append(
                "Free item: the invoice prints a rate of ₹0.00. It is kept with its printed quantity; "
                "no cost has been assigned. Please confirm how it should enter stock.")
        needs_review = (
            it.review_status in ("REVIEW_REQUIRED", "UNKNOWN_REVIEW", "NON_GROCERY")
            or not verified
            or pp is None
            or q is None
            or bool(derived)
            or bool(review_reasons)
            or is_free_item
            or it.validation_status in ("MISMATCH", "INVALID")
            or (it.ocr_confidence is not None and it.ocr_confidence < 85.0)
        )

        norm_unit = it.unit.lower().strip() if it.unit else None
        orig = {
            "name": it.raw_product_name,
            "quantity": q,
            "unit": norm_unit,
            "purchase_price": pp,
            "selling_price": sp,
            "mrp": m,
            "discount": float(it.discount) if it.discount is not None else None,
            "gst_rate": float(it.gst_rate) if it.gst_rate is not None else None,
            "line_total": tot,
            "brand": it.brand,
            "category": it.category,
            "pack_size": it.package_size.raw_text if it.package_size else None,
        }

        matched_prod = None
        matched_prod_id = None
        matched_prod_name = None
        match_score = None
        matched_id_val = it.metadata.get("matched_product_id") or it.matched_product_id
        if matched_id_val:
            matched_prod = next((p for p in shop_products if str(p.id) == str(matched_id_val)), None)
            if matched_prod:
                matched_prod_id = matched_prod.id
                matched_prod_name = matched_prod.name
                match_score = float(it.metadata.get("match_score", 1.0))
        if matched_prod is None and shop_products:
            p_name = it.normalized_product_name or it.raw_product_name
            cand, score, _ = match_inventory(p_name, it.barcode, shop_products)
            if cand and score >= 0.7:
                matched_prod = cand
                matched_prod_id = cand.id
                matched_prod_name = cand.name
                match_score = score

        lookup = lookups[idx] if idx < len(lookups) else None
        store_mrp = matched_prod.mrp if matched_prod is not None else None
        mrp_val, mrp_src, mrp_issues, mrp_needs_review = mrp_lookup.resolve_line_mrp(m, lookup, store_mrp)
        if mrp_needs_review:
            needs_review = True
        arith = resolve_item_arithmetic_py(q, pp, tot, tax, discount=disc)
        arith_status = arith["status"] if arith["status"] != "VERIFIED" else it.validation_status
        if arith_status == "MISMATCH":
            needs_review = True
        line_validation_issues = (list(review_reasons) + [i for i in (it.validation_issues or []) if i not in review_reasons]
                                  + list(mrp_issues or []) + list(arith.get("issues", [])))
        # A missing or unregistered unit needs review: it is never assumed to be pcs
        if not norm_unit:
            line_validation_issues.append("Unit not printed or not read: enter the unit before adding to stock.")
            needs_review = True
        elif try_normalize_unit(norm_unit) is None:
            line_validation_issues.append(
                f"Unit '{norm_unit}' is not a registered unit: correct it before adding to stock.")
            needs_review = True
            near = suggest_registered_unit(norm_unit)
            if near:  # a suggestion only: the unit is never changed without the reviewer
                extraction_suggestions.append(f"Unit '{norm_unit}' may be a misread of '{near}'.")
        # Pack size -> physical quantity -> cost per standard unit (unit registry + pricing engine)
        pack_val = it.package_size.value if (it.package_size and it.package_size.value is not None) else None
        pack_unit_raw = it.package_size.unit if it.package_size else None
        costing = cost_invoice_line(q_d, norm_unit, pp_d, pack_val, pack_unit_raw, tot_d, disc_d, tax_d,
                                    product_name=it.raw_product_name)
        physical_d = costing.physical_quantity
        if physical_d is not None and q_d and received_d is not None and received_d != q_d:
            physical_d = physical_d * received_d / q_d  # free units are received stock too
        for issue in costing.issues:
            if issue not in line_validation_issues:
                line_validation_issues.append(issue)
        if costing.needs_review:
            needs_review = True
        # A matched product stocked in another unit family (e.g. kg) needs the pack size to convert
        # the line's units (e.g. bags); without a printed pack size nothing is assumed.
        if matched_prod is not None and norm_unit and try_normalize_unit(norm_unit):
            prod_unit_id = try_normalize_unit(matched_prod.unit) if matched_prod.unit else None
            line_unit_id = try_normalize_unit(norm_unit)
            if prod_unit_id and not are_units_compatible(prod_unit_id, line_unit_id):
                convertible = bool(costing.conversions) and are_units_compatible(prod_unit_id, costing.pack_unit)
                if not convertible:
                    line_validation_issues.append(
                        f"'{matched_prod.name}' is stocked in {prod_unit_id}, but this line is in {line_unit_id} "
                        f"and no pack size was read: enter the {prod_unit_id} per {line_unit_id} before adding to stock.")
                    needs_review = True
        line_suggestions = list(extraction_suggestions) + list(arith.get("suggestions") or [])
        line_suggested_rate = arith.get("suggested_rate")
        if arith_status == "MISMATCH" and pp is not None and prn is not None:
            raw_rate = (it.raw_cells or {}).get("rate") or (it.raw_cells or {}).get("purchase_price") or pp
            misread = suggest_misread_decimal_rate(raw_rate, q, prn, disc, tax)
            if misread is not None and abs(_dec(misread) - _dec(pp)) > Decimal("0.005"):
                line_suggestions.append(
                    f"Rate {format_rupees(pp)} may be a misread decimal point: {format_rupees(misread)} × {q:g} = {format_rupees(prn)} "
                    "(printed amount). Please check the invoice and confirm."
                )
                line_suggested_rate = line_suggested_rate if line_suggested_rate is not None else misread
                needs_review = True
        line_total_source = ("INVOICE" if prn is not None
                             else "CALCULATED" if "line_total" in derived
                             else arith.get("line_total_source", "UNKNOWN"))
        comp_f = {k: float(v) for k, v in components.items()}
        discount_parts = {k: v for k, v in comp_f.items() if "discount" in k}
        mrp_lookup_schema = MrpLookupSchema(**lookup.to_dict()) if lookup else MrpLookupSchema(
            status="FOUND" if mrp_val else "NOT_FOUND",
            provider="invoice",
            message="Read from invoice" if mrp_val else "Not printed",
            mrp=mrp_val,
            match_method="invoice" if mrp_val else "none",
        )

        items.append(
            CanonicalInvoiceItemSchema(
                id=it.item_id,
                product_name=it.normalized_product_name or it.raw_product_name,
                quantity=_num(received_d),
                unit=norm_unit,
                rate=pp,
                purchase_price=pp,
                selling_price=sp,
                mrp=mrp_val,
                mrp_source=mrp_src,
                invoice_mrp=m,
                store_mrp=store_mrp,
                mrp_lookup=mrp_lookup_schema,
                raw_rate=pp,
                raw_purchase_price=pp,
                raw_selling_price=sp,
                raw_mrp=m,
                discount=float(it.discount) if it.discount is not None else None,
                discount_pct=float(it.discount_pct) if it.discount_pct is not None else None,
                taxable_amount=float(it.taxable_amount) if it.taxable_amount is not None else None,
                tax_amount=float(it.tax_amount) if it.tax_amount is not None else None,
                gst_rate=float(it.gst_rate) if it.gst_rate is not None else None,
                hsn_code=it.hsn_code,
                barcode=it.barcode,
                line_total=tot,
                amount=tot,
                printed_amount=prn,
                calculated_amount=calc,
                line_total_source=line_total_source,
                arithmetic_status=arith_status,
                purchasePrice=pp,
                confidence=float(it.ocr_confidence or 95.0),
                confidence_level="HIGH" if not needs_review else "LOW",
                needs_review=needs_review,
                source_text=it.raw_row_text,
                raw_cells=it.raw_cells,
                extraction_method="TABLE_STRUCTURED",
                validation_issues=line_validation_issues,
                suggestions=line_suggestions,
                suggested_rate=line_suggested_rate,
                suggested_quantity=_num(_dec(qty_details.get("suggested_quantity"))),
                matched_product_id=matched_prod_id,
                matched_product_name=matched_prod_name,
                match_score=match_score,
                pack_size=(
                    float(it.package_size.value)
                    if (it.package_size and it.package_size.value is not None)
                    else None
                ),
                pack_size_unit=it.package_size.unit if it.package_size else None,
                # The printed rate is quoted per one purchase unit (or per kg / L when detected so)
                price_basis_quantity=1.0,
                price_basis_unit=costing.rate_basis_unit or norm_unit,
                normalized_purchase_price=_num(costing.cost_per_standard_unit),
                physical_quantity=_num(physical_d),
                standard_unit=costing.standard_unit,
                cost_per_standard_unit=_num(costing.cost_per_standard_unit),
                rate_basis_unit=costing.rate_basis_unit,
                pack_conversion=costing.conversion_status,
                classification_status=(
                    "GROCERY_CONFIDENT"
                    if it.is_grocery and it.review_status == "CONFIRMED"
                    else ("NON_GROCERY" if not it.is_grocery else "GROCERY_REVIEW")
                ),
                is_grocery=it.is_grocery,
                brand=it.brand,
                normalized_name=it.normalized_product_name or it.raw_product_name,
                category=it.category,
                is_verified=verified,
                user_edited=False,
                original_values=orig,
                derived_fields=sorted(set(derived)),
                cgst_amount=comp_f.get("cgst_amount"),
                sgst_amount=comp_f.get("sgst_amount"),
                igst_amount=comp_f.get("igst_amount"),
                scheme_discount=comp_f.get("scheme_discount"),
                other_discount=comp_f.get("other_discount"),
                discount_components=discount_parts,
                net_amount=prn,
                cases=_num(_dec(qty_details.get("cases"))),
                units_per_case=_num(_dec(qty_details.get("units_per_case"))),
                loose_quantity=_num(_dec(qty_details.get("loose_pieces"))),
                free_quantity=_num(free_d) if (free_d is not None and free_d > 0) else None,
                paid_quantity=_num(paid_d),
                quantity_text=qty_details.get("raw_quantity"),
                is_free_item=is_free_item,
            )
        )

    # Totals keep the printed precision (up to 3 decimals); no rounding to paise
    tot_amt = _num(_keep_printed_precision(sum((_dec(i.line_total) for i in items if i.line_total is not None),
                                               Decimal("0")))) or 0.0
    tot_units = _num(_keep_printed_precision(sum((_dec(i.quantity) for i in items if i.quantity is not None),
                                                 Decimal("0")))) or 0.0
    hdr_detected = len(extracted.metadata.tables_detected) > 0 and extracted.metadata.tables_detected[0].has_table
    t0 = extracted.metadata.tables_detected[0] if hdr_detected else None

    columns = (
        [
            DetectedColumnSchema(role=c.role, header_text=c.header_text, x_start=c.x_start, x_end=c.x_end)
            for c in (t0.columns or [])
        ]
        if t0
        else []
    )

    raw_text = extracted.metadata.ocr_evidence.full_text if extracted.metadata.ocr_evidence else ""
    text_lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    hdr_text = t0.header_text if t0 else None
    layout_lines = (extracted.metadata.custom_properties or {}).get("layout_reading_lines")
    meta = extract_metadata_from_readings(text_lines, hdr_text, layout_lines)

    # Independent extraction and safe confidence handling
    pipeline_supp = getattr(extracted, "supplier_name", None)
    meta_supp = meta.get("supplier_name")
    meta_supp_conf = float(meta.get("supplier_confidence", 0.0))
    if pipeline_supp:
        supplier_name = pipeline_supp
        supplier_conf = 85.0
    elif meta_supp:
        supplier_name = meta_supp
        supplier_conf = meta_supp_conf
    else:
        supplier_name = None
        supplier_conf = 0.0

    pipeline_inv = getattr(extracted, "invoice_number", None)
    meta_inv = meta.get("invoice_number")
    meta_inv_conf = float(meta.get("invoice_no_confidence", 0.0))
    if pipeline_inv:
        invoice_number = pipeline_inv
        inv_conf = 85.0
    elif meta_inv:
        invoice_number = meta_inv
        inv_conf = meta_inv_conf
    else:
        invoice_number = None
        inv_conf = 0.0

    pipeline_date = getattr(extracted, "invoice_date", None)
    meta_date = meta.get("invoice_date")
    meta_date_conf = float(meta.get("date_confidence", 0.0))
    if pipeline_date:
        invoice_date = pipeline_date
        date_conf = 85.0
    elif meta_date:
        invoice_date = meta_date
        date_conf = meta_date_conf
    else:
        invoice_date = None
        date_conf = 0.0
    gstin = meta.get("gstin")
    meta_total = meta.get("invoice_total")
    tot_amt_res = tot_amt if tot_amt > 0 else (meta_total or 0.0)

    # C2: compare the line amounts with the printed grand total (warning only; values never changed)
    reconciliation = reconcile_invoice_total(text_lines, [_dec(i.line_total) for i in items])
    for idx_s, text in reconciliation.get("line_suggestions", {}).items():
        line = items[int(idx_s)]
        line.suggestions = list(line.suggestions) + [text]
        line.validation_issues = list(line.validation_issues) + ["Invoice total does not match the line amounts"]
        line.needs_review = True
        line.confidence_level = "LOW"

    is_pdf = filename.lower().endswith(".pdf") or file_bytes.startswith(b"%PDF")
    is_txt = filename.lower().endswith(".txt") or filename.lower().endswith(".csv")
    if is_pdf:
        is_digital = any(
            p.metadata.get("is_digital") or "stream" in str(p.metadata.get("source", ""))
            for p in (extracted.metadata.ocr_evidence.pages if extracted.metadata.ocr_evidence else [])
        )
        if is_digital:
            engine_used = "backend_pdf_direct"
        else:
            engine_used = "backend_pdf_ocr_scanned"
    elif is_txt:
        engine_used = "backend_text_direct"
    else:
        engine_used = "backend_ocr_pipeline"

    diag = DiagnosticInfo(
        document_type=extracted.metadata.document_type,
        engine_used=engine_used,
        total_raw_lines=(
            sum(len(p.lines) for p in extracted.metadata.ocr_evidence.pages)
            if extracted.metadata.ocr_evidence
            else len(items)
        ),
        total_raw_words=len(raw_text.split()),
        header_detected=hdr_detected,
        header_text=t0.header_text if t0 else None,
        detected_columns=[c.role for c in (t0.columns or [])] if t0 else [],
        columns=columns,
        rows=[],
        detected_sections=["HEADER", "LINE_ITEMS"] if hdr_detected else [],
        warnings=extracted.metadata.warnings,
        ocr_psm=str(extracted.metadata.custom_properties.get("ocr_psm_used") or "3"),
        ocr_language_data="eng+osd",
        pages_processed=extracted.metadata.page_count,
        mrp_provider="openmrp",
    )

    excel_download_url = (
        f"/api/v1/invoices/{extracted.invoice_id}/excel"
        if extracted.metadata.custom_properties.get("xlsx_file_path")
        else None
    )

    if items and reconciliation["status"] == "mismatch":
        # Never rejected for a mismatch: the reviewer checks the lines
        status_str = "needs_review"
        reason_str = reconciliation["message"]
    elif items and any(i.needs_review for i in items):
        # The invoice is never reported as a success while any of its lines still needs checking
        flagged = sum(1 for i in items if i.needs_review)
        status_str = "needs_review"
        reason_str = f"{flagged} of {len(items)} line{'s' if len(items) != 1 else ''} need{'s' if flagged == 1 else ''} review"
    elif items:
        valid_items = [i for i in items if i.confidence >= 60 and i.purchase_price is not None and i.quantity is not None]
        if valid_items and (len(valid_items) / len(items)) >= 0.7:
            status_str = "success"
            reason_str = "High confidence table reconstruction"
        else:
            status_str = "needs_review"
            reason_str = "Low confidence or missing critical fields in reconstructed table"
    else:
        status_str = "needs_review"
        reason_str = (
            extracted.metadata.warnings[0]
            if extracted.metadata.warnings
            else "No product line items were detected in the document"
        )

    return InvoiceExtractResponse(
        id=extracted.invoice_id,
        supplier_name=supplier_name,
        supplier_confidence=supplier_conf,
        invoice_number=invoice_number,
        invoice_no_confidence=inv_conf,
        invoice_date=invoice_date,
        date_confidence=date_conf,
        gstin=gstin,
        invoice_total=tot_amt_res,
        total_amount=tot_amt_res,
        total_units=tot_units,
        total_items=len(items),
        confidence_score=round(sum(i.confidence for i in items) / len(items), 1) if items else 90.0,
        raw_ocr_text=raw_text,
        engine_used=engine_used,
        extraction_method="TABLE_STRUCTURED" if hdr_detected else "TEXT_LINE_ITEM",
        items=items,
        status=status_str,
        reason=reason_str,
        diagnostics=diag,
        excel_download_url=excel_download_url,
        total_grocery_items=sum(1 for i in items if i.is_grocery and i.classification_status == "GROCERY_CONFIDENT"),
        total_review_items=sum(1 for i in items if i.classification_status in ("GROCERY_REVIEW", "UNKNOWN_REVIEW")),
        total_excluded_items=sum(1 for i in items if i.classification_status == "NON_GROCERY"),
        pipeline_stages=extracted.metadata.pipeline_stages_completed,
        bundle_notes=list(extracted.metadata.custom_properties.get("bundle_headers") or []),
        printed_total=reconciliation.get("printed_total"),
        total_reconciliation=reconciliation,
    )


def extract_invoice_from_bytes(
    file_bytes: bytes, filename: str, db: Session, shop_id: UUID
) -> InvoiceExtractResponse:
    """
    Primary invoice scanning orchestrator.
    Routes directly to the Header-Guided Dynamic Grocery Extraction pipeline.
    """
    if not file_bytes or len(file_bytes.strip()) == 0:
        raise ValueError("Uploaded file is empty. Please upload a valid invoice document.")

    return _extract_invoice_with_new_pipeline(file_bytes, filename, db, shop_id)



# --------------------------------------------------------------------------
# Confirmation: one transaction for products, stock and the purchase record
# --------------------------------------------------------------------------


def _line_amount_dec(line_amount: Optional[float], quantity: float, rate: float,
                     paid_quantity: Optional[float] = None,
                     price_basis_quantity: Optional[float] = 1.0) -> Decimal:
    """Printed line amount as given; otherwise (paid units x rate) / price_basis_quantity, kept to 3 decimals (no paise rounding)."""
    if line_amount is not None:
        return _dec(line_amount)
    units = paid_quantity if paid_quantity is not None else quantity
    basis_qty = _dec(price_basis_quantity) or Decimal("1.0")
    if basis_qty <= 0:
        basis_qty = Decimal("1.0")
    return _keep_printed_precision((_dec(units) * _dec(rate)) / basis_qty)


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
        if (try_normalize_unit(existing.unit) or (existing.unit or "").strip().lower()) != (
                try_normalize_unit(item.unit) or (item.unit or "").strip().lower()):
            raise InvoiceValidationError(
                f"'{item.name}' appears twice with different units ({existing.unit} and {item.unit}); "
                "correct or remove one line."
            )
        if abs(existing.purchase_price - item.purchase_price) > 0.005:
            raise InvoiceValidationError(
                f"'{item.name}' appears twice with different purchase prices "
                f"(₹{existing.purchase_price:g} and ₹{item.purchase_price:g}); correct or remove one line."
            )
        old_qty = existing.quantity
        existing.quantity = old_qty + item.quantity
        for attr in ("paid_quantity", "free_quantity"):
            a, b = getattr(existing, attr), getattr(item, attr)
            if a is not None or b is not None:
                setattr(existing, attr, (a if a is not None else (old_qty if attr == "paid_quantity" else 0.0))
                        + (b if b is not None else (item.quantity if attr == "paid_quantity" else 0.0)))
        existing.is_free_item = bool(existing.is_free_item and item.is_free_item)
        if existing.line_amount is not None or item.line_amount is not None:
            existing.line_amount = float(_keep_printed_precision(
                _line_amount_dec(existing.line_amount, old_qty, existing.purchase_price, existing.paid_quantity)
                + _line_amount_dec(item.line_amount, item.quantity, item.purchase_price, item.paid_quantity)))
        for attr in ("selling_price", "mrp", "mrp_source"):
            if getattr(existing, attr) is None and getattr(item, attr) is not None:
                setattr(existing, attr, getattr(item, attr))
    return merged


def confirm_and_update_stock(
    db: Session,
    shop_id: UUID,
    confirm_in: InvoiceConfirmRequest,
    current_user_id: Optional[UUID] = None,
) -> InvoiceConfirmResponse:
    try:
        items = _merge_duplicate_lines(confirm_in.items)

        supplier_id = confirm_in.supplier_id
        if supplier_id:
            supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.shop_id == shop_id).first()
            if not supplier:
                raise InvoiceValidationError("Supplier not found for this shop.")
        elif confirm_in.supplier_name and confirm_in.supplier_name.strip():
            norm_sup_name = confirm_in.supplier_name.strip()
            supplier = db.query(Supplier).filter(
                Supplier.shop_id == shop_id,
                func.lower(func.trim(Supplier.supplier_name)) == norm_sup_name.lower(),
            ).first()
            if not supplier:
                try:
                    supplier = Supplier(shop_id=shop_id, supplier_name=norm_sup_name)
                    db.add(supplier)
                    db.flush()
                except IntegrityError:
                    db.rollback()
                    supplier = db.query(Supplier).filter(
                        Supplier.shop_id == shop_id,
                        func.lower(func.trim(Supplier.supplier_name)) == norm_sup_name.lower(),
                    ).first()
            if supplier:
                supplier_id = supplier.id

        invoice_number = (confirm_in.invoice_number or "").strip() or None
        # Duplicate protection needs a real printed invoice number: when it is missing the
        # invoice is saved without a duplicate check rather than matched on an invented value.
        # The match ignores letter case so the same invoice read as "INV-1" and "inv-1" is caught.
        if invoice_number:
            norm_inv = invoice_number.lower()
            sup_filter = Purchase.supplier_id.is_(None) if supplier_id is None else (Purchase.supplier_id == supplier_id)
            dup = db.query(Purchase).filter(
                Purchase.shop_id == shop_id,
                func.lower(func.trim(Purchase.invoice_number)) == norm_inv,
                sup_filter,
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

        # Every line needs a registered unit: a missing or unknown unit is sent back for review, never
        # assumed to be pcs (raised before anything is written)
        for item, _ in resolved:
            validate_unit_text(item.unit, what=f"Unit for '{item.name}'")

        missing_sp = [item.name for item, product in resolved if product is None and item.selling_price is None]
        if missing_sp:
            raise InvoiceValidationError("Selling price is required for new products: " + ", ".join(missing_sp))

        # Check authorization for selling price override on VERIFIED products BEFORE any mutations
        price_overrides = [
            (item, product) for item, product in resolved
            if product is not None and getattr(product, "pricing_status", None) == "VERIFIED" and item.update_selling_price
        ]
        if price_overrides and current_user_id:
            member = get_shop_member(db, shop_id, current_user_id)
            if not member or member.role not in [ShopRole.OWNER.value, ShopRole.MANAGER.value]:
                product_names = ", ".join(f"'{p.name}'" for _, p in price_overrides)
                raise InvoicePermissionError(
                    f"User does not have authorization to override selling price for verified product(s): {product_names}. Manager or Owner role required."
                )

        db_purchase = Purchase(shop_id=shop_id, supplier_id=supplier_id, total_amount=0.0,
                               invoice_number=invoice_number, invoice_date=confirm_in.invoice_date,
                               processing_status="CONFIRMED", review_status="REVIEWED")
        db.add(db_purchase)
        db.flush()

        now = datetime.now(timezone.utc)
        total_amount = Decimal("0")
        total_units = 0.0
        promotional_lines: List[Dict[str, Any]] = []
        restocked = created = 0
        saved_products: List[Product] = []
        for item, product in resolved:
            qty = _dec(item.quantity)  # as printed, in the line's unit (fractions only for kg, g, L, ml)
            mrp_source = (item.mrp_source or "MANUAL") if item.mrp is not None else None
            # A printed free line carries a rate of 0.00: it is recorded on the purchase as printed, but
            # it never becomes the product's cost (no economic zero cost is assigned to free units)
            free_line = bool(item.is_free_item)

            # Printed pack size (e.g. 25 kg per bag) -> explicit conversion for this line only
            conv = pack_conversions(item.unit, item.pack_size, item.pack_size_unit) if item.pack_size else []
            stock_unit = (product.unit if product else (item.stock_unit or item.unit)).strip()
            if conv and product is None and item.stock_unit:
                su = try_normalize_unit(item.stock_unit)
                if su is None or not (are_units_compatible(su, item.unit) or are_units_compatible(su, conv[0].to_unit)):
                    raise InvoiceValidationError(
                        f"'{item.name}' can be stocked in {item.unit} or {conv[0].to_unit}, not '{item.stock_unit}'.")

            basis_qty = item.price_basis_quantity or (getattr(product, "price_basis_quantity", None) if product else None) or 1.0
            basis_unit = item.price_basis_unit or (getattr(product, "price_basis_unit", None) if product else None) or stock_unit

            norm_unit_cost = None
            rate_unit = (item.rate_basis_unit or item.unit).strip()
            if conv and not free_line and item.purchase_price is not None:
                # Existing engine: cost per rate unit, then per stock unit through the same conversion
                try:
                    cost_res = calculate_purchase_cost(
                        quantity=qty, requested_unit=item.unit, purchase_price=item.purchase_price,
                        price_basis_quantity=1, price_basis_unit=rate_unit,
                        product_conversions=conv, product_name=item.name.strip())
                    try:  # 1 bag = 25 kg: Rs 2350 per bag / 25 = Rs 94 per kg
                        per = convert_quantity(Decimal("1"), rate_unit, stock_unit, product_conversions=conv)
                        norm_unit_cost = round_price(cost_res.unit_cost / per)
                    except InexactConversionError:
                        per = convert_quantity(Decimal("1"), stock_unit, rate_unit, product_conversions=conv)
                        norm_unit_cost = round_price(cost_res.unit_cost * per)
                except (PricingEngineError, StockError, UnitError) as e:
                    raise InvoiceValidationError(f"Cost calculation failed for '{item.name}': {e}") from e
            elif not free_line and item.purchase_price is not None:
                try:
                    cost_res = calculate_purchase_cost(
                        quantity=qty,
                        requested_unit=item.unit,
                        purchase_price=item.purchase_price,
                        price_basis_quantity=basis_qty,
                        price_basis_unit=basis_unit,
                        product_name=item.name.strip(),
                    )
                    prod_stock_unit = (product.unit if product else item.unit).strip()
                    stock_unit_canon = normalize_unit(prod_stock_unit) if prod_stock_unit else cost_res.pricing_basis_unit
                    if are_units_compatible(stock_unit_canon, cost_res.pricing_basis_unit):
                        factor = convert_quantity(Decimal("1.0"), stock_unit_canon, cost_res.pricing_basis_unit)
                        norm_unit_cost = round_price(cost_res.unit_cost * factor)
                    else:
                        norm_unit_cost = cost_res.unit_cost
                except (PricingEngineError, StockError, UnitError) as e:
                    raise InvoiceValidationError(f"Cost calculation failed for '{item.name}': {e}") from e

            if product is not None:
                product.is_active = True
                # Converted into the product's stock unit when compatible (250 g into kg -> 0.25); an
                # incompatible unit is refused. Atomic increase in this transaction (rolled back on error).
                try:
                    stock_add = to_stock_quantity(qty, item.unit, product, product_conversions=conv or None)
                except (StockError, UnitError) as e:
                    raise InvoiceValidationError(f"Unit error for '{product.name}': {e}") from e
                add_stock(db, product, stock_add)
                if not free_line and norm_unit_cost is not None:
                    product.purchase_price = float(norm_unit_cost)
                if item.selling_price is not None:
                    is_verified = getattr(product, "pricing_status", None) == "VERIFIED"
                    if not is_verified or item.update_selling_price:
                        effective_mrp = item.mrp if item.mrp is not None else product.mrp
                        effective_mrp_basis_qty = item.mrp_basis_quantity or getattr(product, "mrp_basis_quantity", None) or basis_qty
                        effective_mrp_basis_unit = item.mrp_basis_unit or getattr(product, "mrp_basis_unit", None) or basis_unit
                        if effective_mrp is not None:
                            try:
                                mrp_eval = evaluate_mrp_ceiling(
                                    selling_price=item.selling_price,
                                    mrp=effective_mrp,
                                    price_basis_quantity=basis_qty,
                                    price_basis_unit=basis_unit,
                                    mrp_basis_quantity=effective_mrp_basis_qty,
                                    mrp_basis_unit=effective_mrp_basis_unit,
                                    product_name=product.name,
                                )
                                if mrp_eval.is_exceeded:
                                    raise InvoiceValidationError(
                                        f"Selling price ₹{item.selling_price} exceeds statutory MRP ceiling ₹{effective_mrp} for '{product.name}'"
                                    )
                            except PricingEngineError as pe:
                                raise InvoiceValidationError(str(pe)) from pe
                        old_sp = product.selling_price
                        product.selling_price = item.selling_price
                        if item.price_basis_quantity is not None:
                            product.price_basis_quantity = float(item.price_basis_quantity)
                        if item.price_basis_unit is not None:
                            product.price_basis_unit = str(basis_unit)
                        if is_verified and item.update_selling_price:
                            create_pricing_audit_log(
                                db=db,
                                shop_id=shop_id,
                                acting_user_id=current_user_id or shop_id,
                                action_type="SELLING_PRICE_OVERRIDE",
                                product_id=product.id,
                                previous_status=product.pricing_status,
                                new_status=product.pricing_status,
                                previous_selling_price=old_sp,
                                new_selling_price=item.selling_price,
                                previous_mrp=product.mrp,
                                new_mrp=item.mrp if item.mrp is not None else product.mrp,
                                invoice_number=invoice_number,
                                reason=f"Invoice confirm selling price override ({invoice_number or 'manual'})",
                            )

                if item.mrp is not None and product.selling_price is not None:
                    # Verify that current retail selling price does not exceed incoming invoice MRP
                    check_sp = product.selling_price
                    sp_basis_q = product.price_basis_quantity or 1.0
                    sp_basis_u = product.price_basis_unit or product.unit
                    mrp_basis_q = item.mrp_basis_quantity or getattr(product, "mrp_basis_quantity", None) or sp_basis_q
                    mrp_basis_u = item.mrp_basis_unit or getattr(product, "mrp_basis_unit", None) or sp_basis_u
                    try:
                        mrp_eval = evaluate_mrp_ceiling(
                            selling_price=check_sp,
                            mrp=item.mrp,
                            price_basis_quantity=sp_basis_q,
                            price_basis_unit=sp_basis_u,
                            mrp_basis_quantity=mrp_basis_q,
                            mrp_basis_unit=mrp_basis_u,
                            product_name=product.name,
                        )
                        if mrp_eval.is_exceeded:
                            raise InvoiceValidationError(
                                f"Invoice MRP ₹{item.mrp} is lower than existing retail selling price ₹{product.selling_price} for '{product.name}'. Selling price must be reduced first or updated."
                            )
                    except PricingEngineError as pe:
                        raise InvoiceValidationError(str(pe)) from pe
                restocked += 1
            else:
                if item.selling_price is not None and item.mrp is not None:
                    try:
                        mrp_eval = evaluate_mrp_ceiling(
                            selling_price=item.selling_price,
                            mrp=item.mrp,
                            price_basis_quantity=basis_qty,
                            price_basis_unit=basis_unit,
                            mrp_basis_quantity=item.mrp_basis_quantity or basis_qty,
                            mrp_basis_unit=item.mrp_basis_unit or basis_unit,
                            product_name=item.name.strip(),
                        )
                        if mrp_eval.is_exceeded:
                            raise InvoiceValidationError(
                                f"Selling price ₹{item.selling_price} exceeds statutory MRP ceiling ₹{item.mrp} for '{item.name.strip()}'"
                            )
                    except PricingEngineError as pe:
                        raise InvoiceValidationError(str(pe)) from pe

                new_stock = qty
                if conv and normalize_unit(stock_unit) != normalize_unit(item.unit):
                    try:
                        new_stock = validate_quantity_unit(
                            convert_quantity(qty, item.unit, stock_unit, product_conversions=conv), stock_unit)
                    except UnitError as e:
                        raise InvoiceValidationError(f"Unit error for '{item.name}': {e}") from e
                product = Product(
                    shop_id=shop_id,
                    name=item.name.strip(),
                    category=item.category or "Groceries",
                    # unknown cost (explicit NULL; the column default would otherwise store 0.0)
                    purchase_price=sa_null() if free_line or norm_unit_cost is None else float(norm_unit_cost),
                    selling_price=item.selling_price,
                    current_stock=float(new_stock),
                    unit=stock_unit,
                    reorder_level=10,
                    is_active=True,
                    price_basis_quantity=float(basis_qty),
                    price_basis_unit=str(basis_unit),
                    mrp_basis_quantity=float(item.mrp_basis_quantity or basis_qty),
                    mrp_basis_unit=str(item.mrp_basis_unit or basis_unit),
                    pricing_status="NEEDS_REVIEW",
                )
                db.add(product)
                created += 1
            # A printed MRP of a pack line is per purchase unit (e.g. per 25 kg bag)
            if conv and item.mrp is not None and item.mrp_basis_quantity is None:
                if are_units_compatible(normalize_unit(product.unit), conv[0].to_unit):
                    item.mrp_basis_quantity, item.mrp_basis_unit = float(conv[0].factor), conv[0].to_unit
                else:
                    item.mrp_basis_quantity, item.mrp_basis_unit = 1.0, normalize_unit(item.unit)
            # A missing MRP never clears a stored one
            if item.mrp is not None:
                product.mrp = item.mrp
                product.mrp_source = mrp_source
                product.mrp_updated_at = now
                if item.mrp_basis_quantity is not None:
                    product.mrp_basis_quantity = float(item.mrp_basis_quantity)
                if item.mrp_basis_unit is not None:
                    product.mrp_basis_unit = str(item.mrp_basis_unit)
            db.add(product)
            db.flush()
            saved_products.append(product)

            line_amount_d = _line_amount_dec(item.line_amount, qty, item.purchase_price, item.paid_quantity, basis_qty)
            line_amount = float(line_amount_d)
            total_amount += line_amount_d
            total_units += float(qty)
            if free_line or (item.free_quantity or 0) > 0:
                promotional_lines.append({
                    "name": item.name.strip(), "received_quantity": float(qty),
                    "paid_quantity": 0.0 if free_line else item.paid_quantity,
                    "free_quantity": float(qty) if free_line else item.free_quantity,
                    "is_free_item": free_line, "purchase_price": item.purchase_price, "line_amount": line_amount,
                })
            db.add(PurchaseItem(
                purchase_id=db_purchase.id,
                product_id=product.id,
                quantity=float(qty),  # as printed, in the line's unit (matches the printed rate)
                purchase_price=item.purchase_price,
                line_amount=line_amount,
                mrp=item.mrp,
                mrp_source=mrp_source,
                # Pack lines record the rate as printed: per one rate unit (usually the purchase unit)
                price_basis_quantity=1.0 if conv else float(basis_qty),
                price_basis_unit=rate_unit if conv else (str(basis_unit) if basis_unit else None),
            ))

        db_purchase.total_amount = float(_keep_printed_precision(total_amount))
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise InvoiceConflictError(
                f"Invoice {invoice_number} from this supplier was already added to stock by a concurrent transaction. "
                "Stock was not changed."
            ) from exc
        db.refresh(db_purchase)

        # Trigger System Notification for successful invoice stock update
        try:
            from db.models.shop import Shop
            from services.notification import create_notification
            from schemas.notification import NotificationCreate

            shop = db.query(Shop).filter(Shop.id == shop_id).first()
            if shop and shop.owner_id:
                inv_display = f" #{invoice_number}" if invoice_number else ""
                create_notification(
                    db,
                    NotificationCreate(
                        user_id=shop.owner_id,
                        shop_id=shop_id,
                        title=f"Invoice Processed{inv_display}",
                        message=f"Successfully added {format_quantity(total_units)} units across {len(items)} items to inventory. Total batch: ₹{_keep_printed_precision(_dec(db_purchase.total_amount)):,}.",
                        category="system",
                        priority="medium",
                        deep_link="/inventory",
                        event_key=f"invoice_confirmed:{db_purchase.id}"
                    ),
                    cooldown_hours=24
                )
        except Exception:
            pass

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
            processing_status=db_purchase.processing_status or "CONFIRMED",
            review_status=db_purchase.review_status or "REVIEWED",
            saved_products=[ProductResponse.model_validate(p) for p in saved_products],
            promotional_lines=promotional_lines,
        )
    except IntegrityError as exc:
        db.rollback()
        inv_str = f" {invoice_number}" if invoice_number else ""
        raise InvoiceConflictError(
            f"Invoice{inv_str} was already added to stock by a concurrent transaction. "
            "Stock was not changed."
        ) from exc
    except Exception:
        db.rollback()
        raise
