"""
Invoice table reconstruction and line-item price extraction.

Input is either OCR/PDF words with coordinates or plain text lines. Both go through
the same steps:

    rows -> header detection -> per-column cells -> numeric parsing
         -> arithmetic validation -> ExtractedLine

Rules this module enforces:
- Purchase price comes from the invoice's Purchase Price / Rate / Unit Price column.
- Quantity, Rate, Amount, MRP, Discount and Tax are kept in separate columns.
- Missing numbers stay None. Nothing defaults to 1 or 0.
- A computed value never replaces a value printed on the invoice. Possible OCR
  corrections are offered as suggestions and the line is flagged for review.
"""

import re
import statistics
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# --------------------------------------------------------------------------
# Data structures
# --------------------------------------------------------------------------


@dataclass
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    conf: Optional[float] = None

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2.0

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2.0

    @property
    def h(self) -> float:
        return max(1.0, self.y1 - self.y0)


@dataclass
class Row:
    words: List[Word]
    index: int = 0
    raw_text: Optional[str] = None  # original line for text input

    @property
    def text(self) -> str:
        if self.raw_text is not None:
            return self.raw_text
        return " ".join(w.text for w in self.words)


@dataclass
class Column:
    role: str
    header_text: str
    x0: float
    x1: float
    is_percent: bool = False
    start: float = 0.0
    end: float = float("inf")

    @property
    def type(self) -> str:  # alias used by older callers
        return self.role


@dataclass
class NumberParse:
    value: Optional[float]
    raw: str
    corrected: bool = False
    ambiguous: bool = False


@dataclass
class Reconciliation:
    status: str  # VERIFIED | MISMATCH | INSUFFICIENT_DATA
    line_total: Optional[float]
    line_total_source: Optional[str]  # INVOICE | CALCULATED | None
    explanation: Optional[str] = None
    issues: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)
    suggested_rate: Optional[float] = None


@dataclass
class ExtractedLine:
    product_name: str
    quantity: Optional[float]
    unit: Optional[str]
    rate: Optional[float]
    purchase_price: Optional[float]
    selling_price: Optional[float]
    invoice_mrp: Optional[float]
    discount: Optional[float]
    discount_pct: Optional[float]
    tax_amount: Optional[float]
    gst_rate: Optional[float]
    taxable_amount: Optional[float]
    hsn_code: Optional[str]
    barcode: Optional[str]
    line_total: Optional[float]
    line_total_source: Optional[str]
    arithmetic_status: str
    confidence: float
    issues: List[str]
    suggestions: List[str]
    suggested_rate: Optional[float]
    raw_cells: Dict[str, str]
    source_text: str
    row_index: int
    extraction_method: str


@dataclass
class TableResult:
    items: List[ExtractedLine]
    columns: List[Column]
    header_text: Optional[str]
    header_row_index: Optional[int]
    rows: List[Dict[str, Any]]
    warnings: List[str]


# --------------------------------------------------------------------------
# Header vocabulary
# --------------------------------------------------------------------------

# Exact phrase -> role. Phrases are normalized: lowercase, currency markers and
# punctuation removed, '%' stripped (it sets Column.is_percent instead).
PHRASE_ROLES: Dict[str, str] = {}


def _alias(role: str, *phrases: str) -> None:
    for p in phrases:
        PHRASE_ROLES[p] = role


_alias("serial", "s no", "sno", "sl no", "slno", "sr no", "srno", "s n", "sl", "sr", "no", "sr no s",
       "serial", "serial no", "item no", "line")
_alias("product", "item", "items", "item name", "item description", "description", "description of goods",
       "product", "products", "product name", "product description", "particulars", "goods", "name",
       "item details", "material", "article", "desc", "item desc", "description of goods services",
       "item particulars", "product details")
_alias("hsn", "hsn", "hsn code", "hsn sac", "hsnsac", "sac", "hsn sac code", "hsn no")
_alias("barcode", "barcode", "bar code", "ean", "ean code", "gtin", "upc", "ean no")
_alias("qty", "qty", "quantity", "qnty", "qty nos", "billed qty", "billed quantity", "total qty",
       "total quantity", "nos", "pcs", "qty pcs", "no of units")
_alias("unit", "unit", "uom", "per", "unit of measure", "units of measure")
_alias("rate", "rate", "price", "unit price", "unit rate", "rate per unit", "price per unit", "rate unit",
       "price unit", "item rate", "net rate", "basic rate", "unit cost", "rate per pc", "rate per piece")
_alias("purchase_price", "purchase price", "purchase rate", "purchase", "cost price", "buy price",
       "buying price", "buying rate", "dealer price", "dealer rate", "dp", "pur rate", "purch rate",
       "landing cost", "landing price", "wholesale price", "wholesale rate", "cost", "ptr")
_alias("selling_price", "selling price", "selling rate", "sale price", "sale rate", "sp", "s p",
       "sales price", "selling")
_alias("mrp", "mrp", "m r p", "maximum retail price", "mrp per unit", "mrp unit", "unit mrp")
_alias("discount", "disc", "discount", "disc amt", "discount amount", "discount amt", "less", "rebate",
       "scheme", "sch", "cd", "trade discount", "td")
_alias("taxable", "taxable", "taxable value", "taxable amount", "taxable amt", "assessable value",
       "basic value", "basic amount", "taxable val")
_alias("tax_amount", "tax", "tax amt", "tax amount", "gst", "gst amt", "gst amount", "cgst", "sgst", "igst",
       "cgst amt", "sgst amt", "igst amt", "cgst amount", "sgst amount", "igst amount", "vat", "utgst")
_alias("gst_rate", "gst rate", "tax rate", "rate of tax", "cgst rate", "sgst rate", "igst rate", "gst slab")
_alias("total", "amount", "amt", "total", "line total", "net amount", "net amt", "net value", "value",
       "total amount", "total value", "net", "amount inr", "line amount", "gross amount", "total amt")
# Columns that are recognised only so their values do not leak into neighbours
_alias("ignore", "batch", "batch no", "exp", "expiry", "exp date", "expiry date", "mfg", "mfg date",
       "free", "free qty", "pack", "packing", "pkg", "size", "remarks", "sch qty", "case", "cases")

CORE_ROLES = {"qty", "unit", "rate", "purchase_price", "selling_price", "mrp", "total", "discount",
              "tax_amount", "gst_rate", "taxable", "hsn", "barcode", "serial"}
NUMERIC_ROLES = {"qty", "rate", "purchase_price", "selling_price", "mrp", "total", "discount",
                 "discount_pct", "tax_amount", "gst_rate", "taxable"}
PRICE_ROLES = {"rate", "purchase_price", "selling_price", "mrp", "total", "taxable"}
GST_SLABS = {0.25, 3.0, 5.0, 12.0, 18.0, 28.0}

UNIT_WORDS = {
    "pcs": "pcs", "pc": "pcs", "piece": "pcs", "pieces": "pcs", "nos": "pcs", "no": "pcs", "ea": "pcs",
    "kg": "kg", "kgs": "kg", "g": "g", "gm": "g", "gms": "g", "gram": "g", "grams": "g",
    "l": "L", "ltr": "L", "ltrs": "L", "litre": "L", "liter": "L", "ml": "ml",
    "pkt": "pkt", "pkts": "pkt", "packet": "pkt", "packets": "pkt", "pack": "pkt",
    "box": "box", "boxes": "box", "bag": "bag", "bags": "bag", "btl": "btl", "bottle": "btl", "bottles": "btl",
    "can": "can", "cans": "can", "tin": "tin", "tins": "tin", "ctn": "ctn", "carton": "ctn", "cartons": "ctn",
    "case": "case", "cs": "case", "dozen": "dozen", "dz": "dozen", "doz": "dozen", "set": "set", "pair": "pair",
    "strip": "strip", "strips": "strip", "jar": "jar", "pouch": "pouch", "roll": "roll", "bundle": "bundle",
}

_CURRENCY_RE = re.compile(r"₹|\brs\b\.?|\binr\b|\(rs\.?\)|\(₹\)|\(inr\)|\$|€|£", re.I)
_MODIFIER_RE = re.compile(r"^[\(\[]?(?:₹|rs\.?|inr|%|in\s*rs\.?|in\s*₹)[\)\]]?$", re.I)

TABLE_END_RE = re.compile(
    r"^\s*(?:sub\s*-?\s*total|grand\s*total|total\b|net\s*(?:amount|payable|total)|invoice\s*(?:total|value)|"
    r"round(?:ed)?\s*(?:off|-off)|cgst\b|sgst\b|igst\b|utgst\b|taxable\s*value|amount\s*(?:in|chargeable)|"
    r"rupees\b|bank\b|terms\b|declaration\b|authori[sz]ed|for\s+[a-z].*\bsignatory|e\s*\.?\s*&\s*o\s*\.?\s*e|"
    r"thank|total\s*(?:qty|quantity|items|amount|tax))",
    re.I,
)


def normalize_header(text: str) -> Tuple[str, bool]:
    raw = text or ""
    is_percent = "%" in raw
    s = raw.lower().replace("%", " ")
    s = _CURRENCY_RE.sub(" ", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"_", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s, is_percent


def _role_for_phrase(norm: str, is_percent: bool) -> Optional[str]:
    role = PHRASE_ROLES.get(norm)
    if role is None:
        return None
    if is_percent:
        if role == "discount":
            return "discount_pct"
        if role in ("tax_amount", "gst_rate"):
            return "gst_rate"
    return role


def classify_header_text(text: str) -> List[Tuple[str, List[int]]]:
    """
    Classifies a header phrase (one or more words separated by normal spaces).
    Returns a list of (role, word_indexes) — usually one entry, but a phrase whose
    words name two different core columns ('Qty Unit' printed close together) is
    split so separate columns are never merged.
    """
    words = text.split()
    if not words:
        return []
    norm, pct = normalize_header(text)
    role = _role_for_phrase(norm, pct)
    if role:
        return [(role, list(range(len(words))))]

    per_word: List[Optional[str]] = []
    for w in words:
        n, p = normalize_header(w)
        per_word.append(_role_for_phrase(n, p) if n else None)

    roles_present = [r for r in per_word if r]
    if not roles_present:
        return []
    distinct_core = {r for r in roles_present if r in CORE_ROLES or r == "product"}
    if len(distinct_core) >= 2:
        # Two different column names inside one phrase: split at each named word
        out: List[Tuple[str, List[int]]] = []
        for idx, r in enumerate(per_word):
            if r:
                out.append((r, [idx]))
            elif out:
                out[-1][1].append(idx)
        return out
    # Head-final noun phrase: 'Net Rate' -> rate, 'Item Code' -> unknown words ignored
    return [(roles_present[-1], list(range(len(words))))]


# --------------------------------------------------------------------------
# Number parsing
# --------------------------------------------------------------------------

_NUM_TOKEN_RE = re.compile(r"[0-9OoIl|SB][0-9OoIl|SB,]*(?:\.[0-9OoIl|SB]+)?")
_STRICT_NUM_RE = re.compile(r"^\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$|^\d+,\d{1,2}$")
_OCR_DIGIT_MAP = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1", "S": "5", "B": "8"})


def parse_number(text: Optional[str]) -> NumberParse:
    """
    Parses an invoice amount/quantity cell.
    - Handles ₹ / Rs / INR, Indian digit grouping (1,25,000.00), decimal commas (250,50),
      trailing '/-', unit suffixes (/kg) and accounting negatives ((250.00)).
    - Letter-for-digit OCR slips (O->0, l->1, S->5) are corrected only inside tokens that
      already contain a digit, and the result is marked `corrected`.
    - A cell holding two different numbers is `ambiguous` and yields no value.
    """
    raw = (text or "").strip()
    if not raw or raw.lower() in {"-", "—", "–", "--", "n/a", "na", "nil", "null", "none", "."}:
        return NumberParse(None, raw)

    s = raw
    negative = False
    m = re.match(r"^\((.*)\)$", s)
    if m:
        negative = True
        s = m.group(1)
    s = _CURRENCY_RE.sub(" ", s)
    s = re.sub(r"/-", " ", s)
    s = re.sub(r"/\s*[a-zA-Z]+\b", " ", s)  # 250.00/kg
    s = s.replace("%", " ")
    s = re.sub(r"(\d)\s*\.\s*(\d)", r"\1.\2", s)  # '22 . 50' from OCR

    candidates: List[Tuple[float, bool]] = []
    for tok in _NUM_TOKEN_RE.findall(s):
        tok = tok.strip(",.")
        if not tok or not re.search(r"\d", tok):
            continue  # never turn a pure-letter token into a number
        corrected = False
        fixed = tok.translate(_OCR_DIGIT_MAP)
        if fixed != tok:
            corrected = True
        if not _STRICT_NUM_RE.match(fixed):
            continue
        if re.match(r"^\d+,\d{1,2}$", fixed):
            fixed = fixed.replace(",", ".")  # decimal comma
        else:
            fixed = fixed.replace(",", "")
        try:
            candidates.append((float(fixed), corrected))
        except ValueError:
            continue

    if not candidates:
        return NumberParse(None, raw)
    distinct = {round(v, 6) for v, _ in candidates}
    if len(distinct) > 1:
        return NumberParse(None, raw, ambiguous=True)
    value, corrected = candidates[0]
    if value > 1e8:
        return NumberParse(None, raw)
    return NumberParse(-value if negative else value, raw, corrected=corrected)


def looks_numeric(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if t in {"-", "—", "–"}:
        return True
    p = parse_number(t)
    if p.value is None:
        return False
    letters = re.sub(r"(?i)₹|rs\.?|inr|[0-9.,()/%\-]", "", t)
    return len(letters) <= 1


def normalize_unit(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    key = re.sub(r"[^a-z]", "", text.lower())
    return UNIT_WORDS.get(key)


# --------------------------------------------------------------------------
# Arithmetic validation
# --------------------------------------------------------------------------


def _fmt(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"{v:,.2f}".rstrip("0").rstrip(".") if v % 1 else f"{v:,.0f}"


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= max(1.0, abs(b) * 0.01)


def reconcile_line(
    qty: Optional[float],
    rate: Optional[float],
    amount: Optional[float],
    discount: Optional[float] = None,
    discount_pct: Optional[float] = None,
    tax_amount: Optional[float] = None,
    gst_rate: Optional[float] = None,
    taxable: Optional[float] = None,
) -> Reconciliation:
    """
    Checks quantity × rate against the printed line amount, allowing for discount
    and GST. Never rewrites the printed values; a mismatch is reported with
    suggestions instead.
    """
    if qty is not None and rate is not None:
        base = qty * rate
        pre_tax: List[Tuple[str, float]] = [("qty × rate", base)]
        if discount:
            pre_tax.append(("qty × rate − discount", base - discount))
        if discount_pct:
            pre_tax.append((f"qty × rate − {_fmt(discount_pct)}% discount", base * (1 - discount_pct / 100.0)))
        candidates = list(pre_tax)
        for label, v in pre_tax:
            if tax_amount:
                candidates.append((f"{label} + tax", v + tax_amount))
            if gst_rate:
                candidates.append((f"{label} + {_fmt(gst_rate)}% GST", v * (1 + gst_rate / 100.0)))

        if amount is not None:
            for label, v in candidates:
                if _close(v, amount):
                    return Reconciliation("VERIFIED", amount, "INVOICE", explanation=f"{label} = {_fmt(amount)}")
            if taxable is not None and any(_close(v, taxable) for _, v in pre_tax):
                return Reconciliation("VERIFIED", amount, "INVOICE", explanation="qty × rate matches taxable value")
            issue = (
                f"Amount ₹{_fmt(amount)} does not match quantity × rate "
                f"({_fmt(qty)} × ₹{_fmt(rate)} = ₹{_fmt(base)})"
            )
            return Reconciliation(
                "MISMATCH", amount, "INVOICE", issues=[issue],
                suggestions=_decimal_shift_suggestions(qty, rate, amount, candidates),
            )

        best = pre_tax[-1][1] if len(pre_tax) > 1 else base
        if taxable is not None:
            return Reconciliation(
                "VERIFIED" if _close(best, taxable) else "MISMATCH", taxable, "INVOICE",
                explanation="line amount taken from taxable value",
                issues=[] if _close(best, taxable) else [
                    f"Taxable value ₹{_fmt(taxable)} does not match quantity × rate (₹{_fmt(best)})"],
            )
        return Reconciliation(
            "INSUFFICIENT_DATA", round(best, 2), "CALCULATED",
            explanation="no line amount on invoice; calculated as quantity × rate",
            issues=["Line amount not printed on invoice; calculated from quantity × rate"],
        )

    line_total = amount if amount is not None else taxable
    issues: List[str] = []
    suggested_rate = None
    if qty is None:
        issues.append("Quantity could not be read; enter it manually")
    if rate is None:
        if qty and line_total is not None and qty > 0:
            suggested_rate = round(line_total / qty, 2)
            issues.append(
                f"Rate could not be read. Amount ÷ quantity = ₹{_fmt(suggested_rate)}, "
                "which may include tax or discount; confirm the purchase price manually"
            )
        else:
            issues.append("Rate / purchase price could not be read; enter it manually")
    return Reconciliation(
        "INSUFFICIENT_DATA", line_total, "INVOICE" if line_total is not None else None,
        issues=issues, suggested_rate=suggested_rate,
    )


def _decimal_shift_suggestions(qty: float, rate: float, amount: float, candidates: Sequence[Tuple[str, float]]) -> List[str]:
    """OCR often drops a decimal point (22.00 -> 2200). Report which single fix would reconcile."""
    out: List[str] = []
    ratios = [amount / v for _, v in candidates if v]
    for r in ratios:
        for factor in (10.0, 100.0):
            if abs(r * factor - 1.0) <= 0.01:
                if rate >= factor:
                    out.append(f"Rate may be ₹{_fmt(rate / factor)} (decimal point missing in OCR)")
                if qty >= factor and float(qty / factor).is_integer():
                    out.append(f"Quantity may be {_fmt(qty / factor)} (decimal point missing in OCR)")
            if abs(r / factor - 1.0) <= 0.01:
                out.append(f"Amount may be ₹{_fmt(amount / factor)} (decimal point missing in OCR)")
    return list(dict.fromkeys(out))


# --------------------------------------------------------------------------
# Row building
# --------------------------------------------------------------------------


def words_from_ocr(raw_words: Iterable[Dict[str, Any]]) -> List[Word]:
    out: List[Word] = []
    for w in raw_words or []:
        text = str(w.get("text", "")).strip()
        bbox = w.get("bbox") or {}
        if not text or not bbox:
            continue
        try:
            out.append(Word(text, float(bbox["x0"]), float(bbox["y0"]), float(bbox["x1"]), float(bbox["y1"]),
                            float(w["confidence"]) if w.get("confidence") is not None else None))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def group_words_into_rows(words: Sequence[Word]) -> List[Row]:
    """Rebuilds visual rows from word boxes (independent of Tesseract block/line grouping)."""
    if not words:
        return []
    heights = [w.h for w in words]
    med_h = statistics.median(heights)
    tol = med_h * 0.5
    rows: List[List[Word]] = []
    centers: List[float] = []
    for w in sorted(words, key=lambda w: w.cy):
        if rows and abs(w.cy - centers[-1]) <= tol:
            rows[-1].append(w)
            centers[-1] = sum(x.cy for x in rows[-1]) / len(rows[-1])
        else:
            rows.append([w])
            centers.append(w.cy)
    return [Row(sorted(r, key=lambda w: w.x0), index=i) for i, r in enumerate(rows)]


def rows_from_text(text: str) -> List[Row]:
    """Text input: one row per line; words get character-offset coordinates."""
    rows: List[Row] = []
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        words = [Word(m.group(0), m.start(), 0.0, m.end(), 1.0) for m in re.finditer(r"\S+", line)]
        rows.append(Row(words, index=len(rows), raw_text=line.rstrip()))
    return rows


def _median_height(rows: Sequence[Row]) -> float:
    hs = [w.h for r in rows for w in r.words]
    return statistics.median(hs) if hs else 1.0


def _phrases_from_words(words: Sequence[Word], gap_limit: float) -> List[List[Word]]:
    phrases: List[List[Word]] = []
    for w in words:
        if phrases:
            prev = phrases[-1][-1]
            gap = w.x0 - prev.x1
            if gap <= gap_limit or (_MODIFIER_RE.match(w.text) and gap <= gap_limit * 4):
                phrases[-1].append(w)
                continue
        phrases.append([w])
    return phrases


def _greedy_phrases(words: Sequence[Word]) -> List[List[Word]]:
    """Single-space text headers: prefer the longest known multi-word header ('Unit Price')."""
    out: List[List[Word]] = []
    i = 0
    while i < len(words):
        for n in (3, 2, 1):
            chunk = list(words[i:i + n])
            if len(chunk) < n:
                continue
            norm, pct = normalize_header(" ".join(w.text for w in chunk))
            if n == 1 or _role_for_phrase(norm, pct):
                out.append(chunk)
                i += n
                break
    return out


def _columns_from_phrases(phrases: Sequence[Sequence[Word]]) -> List[Column]:
    cols: List[Column] = []
    for ph in phrases:
        text = " ".join(w.text for w in ph)
        for role, idxs in classify_header_text(text):
            sub = [ph[i] for i in idxs if i < len(ph)]
            _, pct = normalize_header(" ".join(w.text for w in sub))
            cols.append(Column(role, " ".join(w.text for w in sub), min(w.x0 for w in sub), max(w.x1 for w in sub), pct))
        if not classify_header_text(text) and not _MODIFIER_RE.match(text):
            cols.append(Column("unknown", text, min(w.x0 for w in ph), max(w.x1 for w in ph)))
    return cols


def _split_text_cells(line: str) -> Tuple[List[str], str]:
    for sep, mode in (("|", "pipe"), ("\t", "tab")):
        if sep in line:
            # Interior empty cells are kept so values stay under their own column
            parts = [c.strip() for c in line.strip().split(sep)]
            if parts and parts[0] == "":
                parts = parts[1:]
            if parts and parts[-1] == "":
                parts = parts[:-1]
            return parts, mode
    if re.search(r"\S\s{2,}\S", line):
        return [c.strip() for c in re.split(r"\s{2,}", line.strip()) if c.strip()], "spaces"
    return line.split(), "single"


def _header_columns_for_row(row: Row, med_h: float, text_mode: bool) -> List[Column]:
    if text_mode:
        cells, mode = _split_text_cells(row.text)
        cols: List[Column] = []
        if mode == "single":
            return _columns_from_phrases(_greedy_phrases(row.words))
        for idx, cell in enumerate(cells):
            roles = classify_header_text(cell)
            if not roles:
                cols.append(Column("unknown", cell, float(idx), float(idx)))
            for role, _ in roles:
                _, pct = normalize_header(cell)
                cols.append(Column(role, cell, float(idx), float(idx), pct))
        return cols
    phrases = _phrases_from_words(row.words, gap_limit=max(med_h * 0.9, 4.0))
    return _columns_from_phrases(phrases)


def _score_header(cols: Sequence[Column], row: Row) -> float:
    roles = {c.role for c in cols if c.role not in ("unknown", "ignore")}
    if not roles:
        return 0.0
    numeric_words = sum(1 for w in row.words if looks_numeric(w.text))
    if numeric_words > max(1, len(row.words) // 3):
        return 0.0  # data row, not a header
    has_value_col = bool(roles & {"qty", "rate", "purchase_price", "total", "mrp", "selling_price"})
    if not has_value_col:
        return 0.0
    if "product" not in roles and len(roles) < 3:
        return 0.0
    if len(roles) < 2:
        return 0.0
    return len(roles) + (1.5 if "product" in roles else 0.0)


def detect_header(rows: Sequence[Row], text_mode: bool) -> Tuple[Optional[int], List[Column]]:
    med_h = _median_height(rows)
    best_idx, best_cols, best_score = None, [], 0.0
    for i, row in enumerate(rows):
        if len(row.words) < 2:
            continue
        cols = _header_columns_for_row(row, med_h, text_mode)
        score = _score_header(cols, row)
        if score > best_score:
            best_idx, best_cols, best_score = i, cols, score
    if best_idx is None:
        return None, []
    cols = sorted(best_cols, key=lambda c: c.x0)
    if not any(c.role == "product" for c in cols):
        # No explicit description column: text left of the first value column is the product
        first = cols[0]
        cols.insert(0, Column("product", "(implied)", first.x0 - 1e6, first.x0 - 1e6 + 1))
        if text_mode:
            for idx, c in enumerate(cols):
                c.x0 = c.x1 = float(idx)
    if not text_mode:
        _assign_spatial_ranges(cols, med_h)
    return best_idx, cols


def _assign_spatial_ranges(cols: List[Column], med_h: float) -> None:
    margin = med_h * 0.25
    for i, col in enumerate(cols):
        if i == 0:
            col.start = float("-inf")
        if i + 1 < len(cols):
            nxt = cols[i + 1]
            if col.role == "product":
                # Descriptions are long and left-aligned: extend up to the next header
                boundary = nxt.x0 - margin
            else:
                boundary = (col.x1 + nxt.x0) / 2.0
            col.end = boundary
            nxt.start = boundary
        else:
            col.end = float("inf")


def _cells_spatial(row: Row, cols: Sequence[Column]) -> Dict[int, List[Word]]:
    cells: Dict[int, List[Word]] = {i: [] for i in range(len(cols))}
    for w in row.words:
        for i, col in enumerate(cols):
            if col.start <= w.cx < col.end:
                cells[i].append(w)
                break
    # Small misalignment repair: a numeric column holding two numbers next to an
    # empty numeric column hands its outer number over.
    for i, col in enumerate(cols):
        nums = [w for w in cells[i] if looks_numeric(w.text)]
        if col.role in NUMERIC_ROLES and len(nums) == 2:
            right = i + 1
            left = i - 1
            if right < len(cols) and cols[right].role in NUMERIC_ROLES and not cells[right]:
                cells[i].remove(nums[1])
                cells[right].append(nums[1])
            elif left >= 0 and cols[left].role in NUMERIC_ROLES and not cells[left]:
                cells[i].remove(nums[0])
                cells[left].append(nums[0])
    return cells


def _fits_role(token: str, role: str) -> bool:
    if role in NUMERIC_ROLES:
        return looks_numeric(token)
    if role == "unit":
        return normalize_unit(token) is not None
    if role == "hsn":
        return bool(re.match(r"^\d{4,8}$", token))
    if role == "barcode":
        return bool(re.match(r"^\d{8,14}$", token))
    if role == "serial":
        return bool(re.match(r"^\d{1,4}\.?$", token))
    return False


def _cells_text(row: Row, cols: Sequence[Column]) -> Dict[int, List[str]]:
    cells_txt, mode = _split_text_cells(row.text)
    out: Dict[int, List[str]] = {i: [] for i in range(len(cols))}
    if mode != "single" and len(cells_txt) == len(cols):
        for i, c in enumerate(cells_txt):
            out[i].append(c)
        return out

    non_empty = [c for c in cells_txt if c]
    tokens = non_empty if mode != "single" and len(non_empty) > 1 else row.text.split()
    prod_idx = next((i for i, c in enumerate(cols) if c.role == "product"), 0)
    # Leading columns (serial number) consume from the left
    start = 0
    for i in range(prod_idx):
        if start < len(tokens) and _fits_role(tokens[start], cols[i].role):
            out[i].append(tokens[start])
            start += 1
    # Trailing value columns consume from the right; a token that does not fit
    # its column leaves that column empty instead of shifting values around.
    end = len(tokens)
    for i in range(len(cols) - 1, prod_idx, -1):
        if end - 1 < start:
            break
        tok = tokens[end - 1]
        role = cols[i].role
        if role in ("unknown", "ignore"):
            if not looks_numeric(tok) and normalize_unit(tok) is None:
                continue
            end -= 1
            out[i].append(tok)
            continue
        if _fits_role(tok, role):
            out[i].append(tok)
            end -= 1
    out[prod_idx] = [" ".join(tokens[start:end])] if end > start else []
    return out


# --------------------------------------------------------------------------
# Table extraction
# --------------------------------------------------------------------------


def _join(ws: Sequence[Any]) -> str:
    return " ".join(w.text if isinstance(w, Word) else str(w) for w in ws).strip()


def _first_by_role(values: Dict[str, List[Tuple[int, NumberParse, List[Word]]]], role: str, rightmost: bool = False):
    lst = values.get(role) or []
    lst = [v for v in lst if v[1].value is not None]
    if not lst:
        return None
    return lst[-1] if rightmost else lst[0]


def extract_table(
    rows: Sequence[Row],
    text_mode: bool,
    extraction_method: str,
    fallback_columns: Optional[List[Column]] = None,
) -> TableResult:
    header_idx, cols = detect_header(rows, text_mode)
    header_text: Optional[str] = rows[header_idx].text if header_idx is not None else None
    if header_idx is None:
        if not fallback_columns:
            return TableResult([], [], None, None, [], ["No table header (Item / Qty / Rate / Amount) was found"])
        # Continuation page without a repeated header: reuse the previous page's columns
        header_idx, cols = -1, fallback_columns

    items: List[ExtractedLine] = []
    debug_rows: List[Dict[str, Any]] = []
    warnings: List[str] = []
    pending_text: List[Tuple[str, Row]] = []
    med_h = _median_height(rows)
    product_col = next((c for c in cols if c.role == "product"), None)
    prev_row: Optional[Row] = rows[header_idx] if header_idx >= 0 else None

    def flush_pending_to_last() -> None:
        if pending_text and items:
            extra = " ".join(t for t, _ in pending_text)
            items[-1].product_name = f"{items[-1].product_name} {extra}".strip()
            items[-1].source_text += " | " + " | ".join(r.text for _, r in pending_text)
        pending_text.clear()

    def is_description_fragment(row: Row, product_text: str) -> bool:
        """A wrapped description line: short, label-free, close to the previous row, under the item column."""
        if len(pending_text) >= 2 or ":" in row.text or len(product_text.split()) > 6:
            return False
        if len(re.sub(r"[^A-Za-z]", "", product_text)) < 2:
            return False
        if text_mode or not row.words or prev_row is None or not prev_row.words:
            return True
        gap = min(w.y0 for w in row.words) - max(w.y1 for w in prev_row.words)
        starts_in_item_col = product_col is None or row.words[0].cx < product_col.end
        return gap <= med_h * 1.2 and starts_in_item_col

    for row in rows[header_idx + 1:]:
        text = row.text.strip()
        if not text:
            continue
        if TABLE_END_RE.match(text):
            if items:
                break
            continue

        if text_mode:
            raw_cells_txt = _cells_text(row, cols)
            cell_words: Dict[int, List[Word]] = {i: [] for i in range(len(cols))}
            cell_text = {i: " ".join(v).strip() for i, v in raw_cells_txt.items()}
        else:
            cell_words = _cells_spatial(row, cols)
            cell_text = {i: _join(ws) for i, ws in cell_words.items()}

        values: Dict[str, List[Tuple[int, NumberParse, List[Word]]]] = {}
        for i, col in enumerate(cols):
            if col.role in NUMERIC_ROLES and cell_text.get(i):
                values.setdefault(col.role, []).append((i, parse_number(cell_text[i]), cell_words.get(i, [])))

        product_text = " ".join(cell_text[i] for i, c in enumerate(cols) if c.role == "product" and cell_text.get(i)).strip()
        product_text = re.sub(r"^\s*\d{1,3}[.)]?\s+(?=\D)", "", product_text)  # stray serial number
        raw_cells = {f"{c.role}{'' if c.role != 'unknown' else ':' + c.header_text}": cell_text[i]
                     for i, c in enumerate(cols) if cell_text.get(i)}
        has_values = any(v[1].value is not None for role in ("qty", "rate", "purchase_price", "total", "taxable")
                         for v in values.get(role, []))
        debug_rows.append({"row_index": row.index, "text": text, "cells": raw_cells, "is_item": has_values})

        if not has_values:
            if product_text and is_description_fragment(row, product_text):
                pending_text.append((product_text, row))
                prev_row = row
            elif product_text:
                pending_text.clear()  # unrelated text (notes, addresses) is not part of any item
            continue
        prev_row = row

        if not product_text and pending_text:
            product_text = " ".join(t for t, _ in pending_text)
            pending_text.clear()
        else:
            flush_pending_to_last()
        name = re.sub(r"\s+", " ", product_text).strip(" -|:")
        if len(re.sub(r"[^A-Za-z]", "", name)) < 2:
            warnings.append(f"Skipped row without a readable product name: '{text}'")
            continue

        items.append(_build_line(name, cols, values, cell_text, raw_cells, row, extraction_method, text_mode))

    flush_pending_to_last()
    return TableResult(items, cols, header_text, header_idx if header_idx >= 0 else None, debug_rows, warnings)


_MULT_RE = re.compile(
    r"(?P<qty>\d+(?:\.\d+)?)\s*(?P<unit>[A-Za-z]{1,6})?\s*[x×*@]\s*(?:₹|rs\.?\s*)?(?P<rate>\d[\d,]*(?:\.\d+)?)"
    r"(?:\s*=?\s*(?:₹|rs\.?\s*)?(?P<amount>\d[\d,]*(?:\.\d+)?))?\s*$",
    re.I,
)


def extract_headerless_lines(rows: Sequence[Row]) -> TableResult:
    """
    Receipts without a column header. A line becomes an item only when its numbers
    identify themselves: an explicit 'qty x rate [= amount]' pattern, or three trailing
    numbers where the first two multiply to the third. Anything else is left unparsed.
    """
    items: List[ExtractedLine] = []
    warnings: List[str] = []
    debug_rows: List[Dict[str, Any]] = []
    for row in rows:
        text = row.text.strip()
        if not text or TABLE_END_RE.match(text):
            continue
        qty = rate = amount = None
        name = None
        unit = None
        m = _MULT_RE.search(text)
        if m and m.start() > 0:
            qty = parse_number(m.group("qty")).value
            rate = parse_number(m.group("rate")).value
            amount = parse_number(m.group("amount")).value if m.group("amount") else None
            unit = normalize_unit(m.group("unit")) if m.group("unit") else None
            name = text[: m.start()].strip(" -:|")
        else:
            toks = text.split()
            nums: List[float] = []
            while toks and len(nums) < 3 and looks_numeric(toks[-1]):
                v = parse_number(toks.pop()).value
                if v is None:
                    break
                nums.insert(0, v)
            if len(nums) == 3 and nums[0] > 0 and float(nums[0]).is_integer() and _close(nums[0] * nums[1], nums[2]):
                qty, rate, amount = nums
                name = " ".join(toks).strip(" -:|")
        if name is None or qty is None or rate is None or len(re.sub(r"[^A-Za-z]", "", name)) < 2:
            if re.search(r"[A-Za-z]{3}", text) and re.search(r"\d", text):
                warnings.append(f"Line not parsed (no column header and no verifiable qty × rate): '{text}'")
            continue
        rec = reconcile_line(qty, rate, amount)
        issues = ["No table header found; quantity and rate were identified from the line pattern — verify"] + rec.issues
        debug_rows.append({"row_index": row.index, "text": text, "cells": {"qty": str(qty), "rate": str(rate),
                                                                          "total": str(amount)}, "is_item": True})
        items.append(ExtractedLine(
            product_name=name, quantity=qty, unit=unit, rate=rate, purchase_price=rate, selling_price=None,
            invoice_mrp=None, discount=None, discount_pct=None, tax_amount=None, gst_rate=None,
            taxable_amount=None, hsn_code=None, barcode=None, line_total=rec.line_total,
            line_total_source=rec.line_total_source, arithmetic_status=rec.status,
            confidence=min(75.0, 100.0 - (30 if rec.status == "MISMATCH" else 0)), issues=issues,
            suggestions=rec.suggestions, suggested_rate=rec.suggested_rate, raw_cells={},
            source_text=text, row_index=row.index, extraction_method="TEXT_LINE_ITEM",
        ))
    return TableResult(items, [], None, None, debug_rows, warnings)


def _build_line(
    name: str,
    cols: Sequence[Column],
    values: Dict[str, List[Tuple[int, NumberParse, List[Word]]]],
    cell_text: Dict[int, str],
    raw_cells: Dict[str, str],
    row: Row,
    extraction_method: str,
    text_mode: bool,
) -> ExtractedLine:
    issues: List[str] = []
    suggestions: List[str] = []
    penalty = 0.0

    def get(role: str, rightmost: bool = False) -> Optional[float]:
        nonlocal penalty
        entry = _first_by_role(values, role, rightmost)
        for _, parsed, _ in values.get(role, []):
            if parsed.ambiguous:
                issues.append(f"{_label(role)} cell '{parsed.raw}' contains more than one number")
                penalty += 20
        if entry is None:
            return None
        _, parsed, words = entry
        if parsed.corrected:
            issues.append(f"{_label(role)} '{parsed.raw}' contained letters read as digits (OCR); verify")
            penalty += 10
        low = [w for w in words if w.conf is not None and w.conf < 60 and looks_numeric(w.text)]
        if low:
            issues.append(f"Low OCR confidence for {_label(role)} '{parsed.raw}' ({int(min(w.conf for w in low))}%)")
            penalty += 15
        return parsed.value

    qty = get("qty")
    rate = get("rate")
    purchase_col = get("purchase_price")
    selling = get("selling_price")
    mrp = get("mrp")
    amount = get("total", rightmost=True)
    taxable = get("taxable")
    # A cell printed with '%' is a rate even when the column header has no '%'
    gst_entries: List[float] = []
    tax_entries: List[float] = []
    for role in ("gst_rate", "tax_amount"):
        for _, parsed, _ in values.get(role, []):
            if parsed.value is None:
                continue
            (gst_entries if role == "gst_rate" or "%" in parsed.raw else tax_entries).append(parsed.value)
    gst_rate = round(sum(gst_entries), 4) if gst_entries else None
    tax_amount = round(sum(tax_entries), 2) if tax_entries else None
    discount = None
    discount_pct = None
    for role in ("discount", "discount_pct"):
        for _, parsed, _ in values.get(role, []):
            if parsed.value is None:
                continue
            if role == "discount_pct" or "%" in parsed.raw:
                discount_pct = parsed.value
            else:
                discount = parsed.value
    # An unlabelled 'Tax' value that only reconciles when read as a GST slab percentage
    if tax_amount is not None and gst_rate is None and tax_amount in GST_SLABS:
        as_amount = reconcile_line(qty, rate if purchase_col is None else purchase_col, amount, discount, discount_pct, tax_amount, None, taxable)
        as_pct = reconcile_line(qty, rate if purchase_col is None else purchase_col, amount, discount, discount_pct, None, tax_amount, taxable)
        if as_pct.status == "VERIFIED" and as_amount.status != "VERIFIED":
            gst_rate, tax_amount = tax_amount, None

    for bad in (qty, rate, purchase_col, selling, mrp, amount):
        if bad is not None and bad < 0:
            issues.append("Negative value found in a price/quantity column; verify the line")
            penalty += 20
            break
    if qty is not None and qty <= 0:
        issues.append("Quantity must be greater than 0")
        qty = None

    purchase_price = purchase_col if purchase_col is not None else rate

    # Unit from the Unit column, else a unit word written in the quantity cell ('10 pcs')
    unit = None
    for i, c in enumerate(cols):
        if c.role == "unit" and cell_text.get(i):
            unit = normalize_unit(cell_text[i]) or cell_text[i].strip().lower()
    if unit is None:
        for i, c in enumerate(cols):
            if c.role == "qty" and cell_text.get(i):
                m = re.search(r"[A-Za-z]+", cell_text[i])
                if m:
                    unit = normalize_unit(m.group(0))

    rec = reconcile_line(qty, purchase_price, amount, discount, discount_pct, tax_amount, gst_rate, taxable)
    issues.extend(rec.issues)
    suggestions.extend(rec.suggestions)
    if rec.status == "MISMATCH":
        penalty += 30
    if purchase_price is None:
        penalty += 30
    if qty is None:
        penalty += 30
    if mrp is not None and purchase_price is not None and mrp < purchase_price:
        issues.append(f"MRP ₹{_fmt(mrp)} is lower than the purchase rate ₹{_fmt(purchase_price)}; check column alignment")
        penalty += 15

    if text_mode:
        base_conf = 100.0
    else:
        confs = [w.conf for ws_role in values.values() for _, _, ws in ws_role for w in ws if w.conf is not None]
        base_conf = statistics.mean(confs) if confs else 100.0  # digital PDF text has no OCR uncertainty
    if rec.status == "VERIFIED":
        base_conf = min(100.0, base_conf + 5)
    confidence = round(max(0.0, min(100.0, base_conf - penalty)), 1)

    hsn = next((cell_text[i] for i, c in enumerate(cols) if c.role == "hsn" and cell_text.get(i)), None)
    barcode = next((re.sub(r"\D", "", cell_text[i]) for i, c in enumerate(cols) if c.role == "barcode" and cell_text.get(i)), None)

    return ExtractedLine(
        product_name=name,
        quantity=qty,
        unit=unit,
        rate=rate if rate is not None else purchase_col,
        purchase_price=purchase_price,
        selling_price=selling,
        invoice_mrp=mrp,
        discount=discount,
        discount_pct=discount_pct,
        tax_amount=tax_amount,
        gst_rate=gst_rate,
        taxable_amount=taxable,
        hsn_code=hsn,
        barcode=barcode or None,
        line_total=rec.line_total,
        line_total_source=rec.line_total_source,
        arithmetic_status=rec.status,
        confidence=confidence,
        issues=list(dict.fromkeys(issues)),
        suggestions=suggestions,
        suggested_rate=rec.suggested_rate,
        raw_cells=raw_cells,
        source_text=row.text,
        row_index=row.index,
        extraction_method=extraction_method,
    )


_LABELS = {"qty": "Quantity", "rate": "Rate", "purchase_price": "Purchase price", "selling_price": "Selling price",
           "mrp": "MRP", "total": "Amount", "taxable": "Taxable value", "discount": "Discount",
           "tax_amount": "Tax", "gst_rate": "GST %", "discount_pct": "Discount %"}


def _label(role: str) -> str:
    return _LABELS.get(role, role)
