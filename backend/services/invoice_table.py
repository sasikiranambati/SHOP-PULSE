"""
Invoice table reconstruction and line-item price extraction.

Input is either OCR/PDF words with coordinates or plain text lines. Both go through
the same steps:

    rows -> header detection -> per-column cells -> field parsers
         -> arithmetic validation -> ExtractedLine

Rules this module enforces:
- Every value comes from the column it is printed in. Numbers inside the product
  description ("CHANA 50 KG", "OIL CAN 10") belong to the description.
- Quantity and its printed unit are read together ("1.0 BOR" -> 1.0, "BOR"); the unit
  is kept as printed and only normalized through the explicit UNIT_WORDS table.
- Missing numbers stay None and are distinct from a printed 0.
- Money is handled as Decimal. A computed value never replaces a printed one;
  discrepancies are reported with the expected amount and the difference.
"""

import re
import statistics
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
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
    value: Optional[Decimal]
    raw: str
    corrected: bool = False         # a letter inside a run of digits was read as a digit (O->0, l->1)
    ambiguous: bool = False         # the cell holds two different numbers
    symbol_stripped: bool = False   # an unreadable mark was glued to the number (often a misread ₹)
    percent: Optional[Decimal] = None  # percentage printed in the cell, e.g. "124.08 (3%)"
    unit: Optional[str] = None      # unit printed with a quantity, e.g. "1.0 BOR" -> "BOR"


@dataclass
class Reconciliation:
    status: str  # VERIFIED | MISMATCH | INSUFFICIENT_DATA
    line_total: Optional[Decimal]          # printed line amount (never a calculation)
    line_total_source: Optional[str]       # INVOICE | None
    calculated_amount: Optional[Decimal] = None
    amount_difference: Optional[Decimal] = None  # printed - calculated
    rule: Optional[str] = None
    explanation: Optional[str] = None
    issues: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)
    suggested_rate: Optional[Decimal] = None


@dataclass
class ExtractedLine:
    product_name: str
    quantity: Optional[Decimal]
    unit: Optional[str]             # as printed on the invoice
    unit_normalized: Optional[str]  # only via UNIT_WORDS; None for units like BOR or PET
    rate: Optional[Decimal]
    purchase_price: Optional[Decimal]
    selling_price: Optional[Decimal]
    invoice_mrp: Optional[Decimal]
    discount: Optional[Decimal]
    discount_pct: Optional[Decimal]
    tax_amount: Optional[Decimal]
    gst_rate: Optional[Decimal]
    taxable_amount: Optional[Decimal]
    hsn_code: Optional[str]
    barcode: Optional[str]
    line_total: Optional[Decimal]
    line_total_source: Optional[str]
    calculated_amount: Optional[Decimal]
    amount_difference: Optional[Decimal]
    arithmetic_status: str
    arithmetic_rule: Optional[str]
    arithmetic_explanation: Optional[str]
    confidence: float
    issues: List[str]
    suggestions: List[str]
    suggested_rate: Optional[Decimal]
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
    totals_row: Dict[str, Decimal] = field(default_factory=dict)


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
              "discount_pct", "tax_amount", "gst_rate", "taxable", "hsn", "barcode", "serial"}
NUMERIC_ROLES = {"qty", "rate", "purchase_price", "selling_price", "mrp", "total", "discount",
                 "discount_pct", "tax_amount", "gst_rate", "taxable"}
PRICE_ROLES = {"rate", "purchase_price", "selling_price", "mrp", "total", "taxable"}
GST_SLABS = {Decimal(v) for v in ("0.25", "3", "5", "12", "18", "28")}

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

_DASHES = {"-", "—", "–", "--", "n/a", "na", "nil", "null", "none", "."}
_PCT_RE = re.compile(r"\(?\s*(\d+(?:[.,]\d+)?)\s*%\s*\)?")
_NUM_RUN_RE = re.compile(r"\d[\d.,OoIl|]*")
_STRICT_NUM_RE = re.compile(r"^\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$|^\d+,\d{1,2}$")
# Letter-for-digit OCR slips that are repaired only *inside* a run of digits ("1O0", "2.O0").
# S/B are deliberately absent: next to a number they are usually a misread ₹ or a unit ("2.0BOR").
_OCR_DIGIT_MAP = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1"})
_GLUED_SYMBOL_RE = re.compile(r"[^\w\s/:.,\-]{1,2}|[A-Za-z]")


def _to_decimal(text: str) -> Optional[Decimal]:
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def parse_number(text: Optional[str]) -> NumberParse:
    """
    Parses a money or numeric cell exactly (Decimal).
    - Handles ₹ / Rs / INR, Indian digit grouping (1,25,000.00), decimal commas (250,50),
      trailing '/-', unit suffixes (/kg) and accounting negatives ((250.00)).
    - A percentage in the cell is returned separately: "124.08 (3%)" -> 124.08 and 3;
      "(3%)" is a percentage, never a negative number.
    - A single unreadable mark glued to the number (a misread ₹ such as "X22.00") is
      dropped and reported; it is never converted into a digit.
    - Letters inside a run of digits ("1O0") are repaired and reported as corrected.
    - A cell holding two different numbers is ambiguous and yields no value.
    """
    raw = (text or "").strip()
    if not raw or raw.lower() in _DASHES:
        return NumberParse(None, raw)

    s = raw
    percent: Optional[Decimal] = None
    pcts = _PCT_RE.findall(s)
    if pcts:
        found = {_to_decimal(p.replace(",", ".")) for p in pcts}
        if len(found) > 1 or None in found:
            return NumberParse(None, raw, ambiguous=True)
        percent = found.pop()
        s = _PCT_RE.sub(" ", s)

    st = s.strip()
    negative = False
    m = re.fullmatch(r"\((.*)\)", st)
    if m:
        negative = True
        st = m.group(1)
    st = _CURRENCY_RE.sub(" ", st)
    st = re.sub(r"/-", " ", st)
    st = re.sub(r"/\s*[a-zA-Z]+\b", " ", st)  # 250.00/kg
    st = re.sub(r"(\d)\s*\.\s*(\d)", r"\1.\2", st)  # '22 . 50' from OCR
    # A decimal point read as ':' or ';' ("1:12") is repaired and reported as corrected
    st, colon_fixes = re.subn(r"(?<=\d)[:;](?=\d{1,2}(?!\d))", ".", st)

    values: List[Decimal] = []
    corrected = bool(colon_fixes)
    symbol_stripped = False
    for match in _NUM_RUN_RE.finditer(st):
        before = st[: match.start()]
        glued = re.search(r"(\S*)$", before).group(1)
        if glued:
            if _GLUED_SYMBOL_RE.fullmatch(glued):
                symbol_stripped = True
            elif re.search(r"[A-Za-z]{2,}", glued):
                continue  # digits inside a code such as 'SBW1021'
        token = match.group(0)
        # Letters trailing the number are a unit or noise, never digits
        core = re.sub(r"[OoIl|]+[.,]*$", "", token).rstrip(".,")
        if not core:
            continue
        fixed = core.translate(_OCR_DIGIT_MAP)
        if fixed != core:
            corrected = True
        if not _STRICT_NUM_RE.match(fixed):
            continue
        fixed = fixed.replace(",", ".") if re.fullmatch(r"\d+,\d{1,2}", fixed) else fixed.replace(",", "")
        value = _to_decimal(fixed)
        if value is not None:
            values.append(value)

    if not values:
        return NumberParse(None, raw, percent=percent)
    if len(set(values)) > 1:
        return NumberParse(None, raw, ambiguous=True, percent=percent)
    value = values[0]
    if value > Decimal("100000000"):
        return NumberParse(None, raw, percent=percent)
    return NumberParse(-value if negative else value, raw, corrected=corrected,
                       symbol_stripped=symbol_stripped, percent=percent)


_QTY_RE = re.compile(r"^\s*(?P<num>\d[\d.,OoIl|]*?)\s*(?P<unit>[A-Za-z][A-Za-z.]{0,11})?\s*$")
_QTY_GREEDY_RE = re.compile(r"^\s*(?P<num>\d[\d.,OoIl|]*)\s*(?P<unit>[A-Za-z][A-Za-z.]{0,11})?\s*$")
# Words accepted as a printed unit after a quantity (includes units with no stock mapping, e.g. BOR, PET)
QTY_UNIT_WORDS = set(UNIT_WORDS) | {"bor", "bori", "pet", "jar", "doz", "bdl", "cs", "btls", "nos"}


def parse_quantity(text: Optional[str]) -> NumberParse:
    """
    Parses a quantity cell, keeping the printed unit separate: "1.0 BOR" -> 1.0 + "BOR",
    "2.0BOR" -> 2.0 + "BOR", "10 Nos" -> 10 + "Nos". Letters after the number are a unit,
    never digits, except O/o/I/l/| that only make sense as digits ("1O" -> 10, "2OOml" -> 200 ml).
    """
    raw = (text or "").strip()
    m = _QTY_RE.match(raw)
    greedy = _QTY_GREEDY_RE.match(raw)
    digits_from_letters = False
    if m and greedy and m.group("unit"):
        def is_unit(u: Optional[str]) -> bool:
            return not u or re.sub(r"[^a-z]", "", u.lower()) in QTY_UNIT_WORDS
        if not is_unit(m.group("unit")) and (is_unit(greedy.group("unit")) or re.fullmatch(r"[OoIl|]+", m.group("unit"))):
            m, digits_from_letters = greedy, True
    if m:
        num = m.group("num")
        if digits_from_letters:
            # The trailing O/l are digits here; parse_number alone would drop them as a unit
            num = num.translate(_OCR_DIGIT_MAP)
        parsed = parse_number(num)
        parsed.corrected = parsed.corrected or digits_from_letters
        parsed.raw = raw
        unit = m.group("unit")
        parsed.unit = unit.rstrip(".") if unit else None
        return parsed
    parsed = parse_number(raw)
    unit_match = re.search(r"\d\s*([A-Za-z]{2,12})\b", raw)
    parsed.unit = unit_match.group(1) if unit_match else None
    return parsed


def parse_hsn(text: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Returns (hsn_code, issue). '-' or blank means no HSN printed."""
    t = (text or "").strip()
    if not t or t.lower() in _DASHES:
        return None, None
    digits = re.sub(r"\s", "", t)
    if re.fullmatch(r"\d{2,8}", digits):
        return digits, None
    return None, f"HSN '{t}' is not a valid HSN/SAC code"


def looks_numeric(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if t in {"-", "—", "–"}:
        return True
    p = parse_number(t)
    if p.value is None and p.percent is None:
        return False
    letters = re.sub(r"(?i)₹|rs\.?|inr|[0-9.,()/%\-]", "", t)
    return len(letters) <= 1


def normalize_unit(text: Optional[str]) -> Optional[str]:
    """Maps a printed unit through the explicit UNIT_WORDS table; unknown units return None."""
    if not text:
        return None
    key = re.sub(r"[^a-z]", "", text.lower())
    return UNIT_WORDS.get(key)


# --------------------------------------------------------------------------
# Arithmetic validation
# --------------------------------------------------------------------------

CENT = Decimal("0.01")

ARITHMETIC_RULE = (
    "Expected amount = quantity × rate − discount + tax, using the printed discount and tax "
    "amounts (or their printed percentages when no amount is printed). Alternatives checked for "
    "suppliers whose rate already includes tax or discount: quantity × rate − discount, "
    "quantity × rate + tax, quantity × rate. Tolerance for paise rounding: "
    "₹0.005 × quantity + ₹0.02."
)


def amount_tolerance(qty: Decimal) -> Decimal:
    """Rates are printed to the paisa, so each unit can carry up to ₹0.005 of rounding."""
    return abs(qty) * Decimal("0.005") + Decimal("0.02")


def _fmt(v: Optional[Decimal]) -> str:
    """Plain number without trailing zeros: 3, 1378.62, 4015.8."""
    if v is None:
        return "—"
    d = Decimal(v)
    text = format(d.normalize(), "f") if d != d.to_integral() else format(d.quantize(Decimal(1)), "f")
    return text


def _money(v: Optional[Decimal]) -> str:
    if v is None:
        return "—"
    return f"₹{Decimal(v).quantize(CENT):,}"


def reconcile_line(
    qty: Optional[Decimal],
    rate: Optional[Decimal],
    amount: Optional[Decimal],
    discount: Optional[Decimal] = None,
    discount_pct: Optional[Decimal] = None,
    tax_amount: Optional[Decimal] = None,
    gst_rate: Optional[Decimal] = None,
    taxable: Optional[Decimal] = None,
) -> Reconciliation:
    """
    Compares the printed line amount with the documented ARITHMETIC_RULE. The printed
    amount, rate and quantity are never changed; a discrepancy is recorded with the
    expected amount, the difference and a plain-language explanation.
    """
    qty, rate, amount = (_dec(qty), _dec(rate), _dec(amount))
    discount, discount_pct, tax_amount, gst_rate, taxable = map(_dec, (discount, discount_pct, tax_amount, gst_rate, taxable))
    printed = amount if amount is not None else taxable
    printed_source = "INVOICE" if printed is not None else None

    if qty is None or rate is None:
        issues: List[str] = []
        suggested_rate = None
        if qty is None:
            issues.append("Quantity could not be read; enter it manually")
        if rate is None:
            if qty and printed is not None and qty > 0:
                suggested_rate = (printed / qty).quantize(CENT)
                issues.append(
                    f"Rate could not be read. Amount ÷ quantity = {_money(suggested_rate)}, "
                    "which may include tax or discount; confirm the purchase price manually"
                )
            else:
                issues.append("Rate / purchase price could not be read; enter it manually")
        return Reconciliation("INSUFFICIENT_DATA", printed, printed_source, issues=issues, suggested_rate=suggested_rate)

    gross = qty * rate
    disc = discount if discount is not None else (gross * discount_pct / 100 if discount_pct is not None else None)
    net = gross - (disc or 0)
    tax = tax_amount if tax_amount is not None else (net * gst_rate / 100 if gst_rate is not None else None)

    def label(with_disc: bool, with_tax: bool) -> str:
        text = f"{_fmt(qty)} × {_money(rate)}"
        if with_disc and disc:
            text += f" − {_money(disc)} discount"
        if with_tax and tax:
            text += f" + {_money(tax)} tax"
        return text

    conventions: List[Tuple[str, Decimal]] = [(label(True, True), net + (tax or 0))]
    if tax:
        conventions.append((label(True, False) + " (tax included in rate)", net))
    if disc:
        conventions.append((label(False, True) + " (discount already in rate)", gross + (tax or 0)))
    if disc or tax:
        conventions.append((label(False, False), gross))

    if printed is None:
        expected_label, expected = conventions[0]
        return Reconciliation(
            "INSUFFICIENT_DATA", None, None, calculated_amount=expected.quantize(CENT), rule=ARITHMETIC_RULE,
            explanation=f"No line amount printed. Calculated: {expected_label} = {_money(expected)}",
            issues=[f"Line amount not printed on invoice; calculated amount is {_money(expected)}"],
        )

    tol = amount_tolerance(qty)
    what = "amount" if amount is not None else "taxable value"
    for text, value in conventions:
        diff = printed - value
        if abs(diff) <= tol:
            note = "" if diff == 0 else f" (rounding difference {_money(diff)})"
            return Reconciliation(
                "VERIFIED", printed, printed_source, calculated_amount=value.quantize(CENT),
                amount_difference=diff.quantize(CENT), rule=ARITHMETIC_RULE,
                explanation=f"Printed {what} {_money(printed)} = {text}{note}",
            )

    text, value = min(conventions, key=lambda c: abs(printed - c[1]))
    diff = printed - value
    issue = (f"Printed {what} {_money(printed)} does not match quantity × rate: {text} = {_money(value)} "
             f"(difference {_money(diff)}). The printed value is kept. Check the invoice.")
    return Reconciliation(
        "MISMATCH", printed, printed_source, calculated_amount=value.quantize(CENT),
        amount_difference=diff.quantize(CENT), rule=ARITHMETIC_RULE, explanation=issue, issues=[issue],
        suggestions=_decimal_shift_suggestions(qty, rate, printed, [v for _, v in conventions]),
    )


def _dec(v: Any) -> Optional[Decimal]:
    if v is None or isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def _decimal_shift_suggestions(qty: Decimal, rate: Decimal, amount: Decimal, expected: Sequence[Decimal]) -> List[str]:
    """OCR often drops a decimal point (22.00 -> 2200). Report which single fix would reconcile."""
    out: List[str] = []
    for value in expected:
        if not value:
            continue
        ratio = amount / value
        for factor in (Decimal(10), Decimal(100)):
            if abs(ratio * factor - 1) <= Decimal("0.01"):
                if rate >= factor:
                    out.append(f"Rate may be {_money(rate / factor)} (decimal point missing in OCR)")
                if qty >= factor and (qty / factor) == (qty / factor).to_integral():
                    out.append(f"Quantity may be {_fmt(qty / factor)} (decimal point missing in OCR)")
            if abs(ratio / factor - 1) <= Decimal("0.01"):
                out.append(f"Amount may be {_money(amount / factor)} (decimal point missing in OCR)")
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


def _body_bands(body: Sequence[Row], med_h: float) -> List[Tuple[float, float]]:
    """
    Horizontal bands of the table body: x-ranges covered by words in any body row, with
    the whitespace gutters between columns left open. Words of one cell ('77.68 (12%)')
    are closer than a gutter, so they merge into one band.
    """
    spans = sorted((w.x0, w.x1) for r in body for w in r.words)
    bands: List[List[float]] = []
    join = med_h * 0.6
    for x0, x1 in spans:
        if bands and x0 <= bands[-1][1] + join:
            bands[-1][1] = max(bands[-1][1], x1)
        else:
            bands.append([x0, x1])
    return [(a, b) for a, b in bands]


def _refine_ranges_with_body(cols: List[Column], body: Sequence[Row], med_h: float) -> None:
    """
    Moves each column boundary into the whitespace gutter between that column's values
    and the next column's values. Header midpoints alone fail for right-aligned numbers
    under short headers ('4.01 (0.1%)' under 'TAX' reaches back under 'DISC.'). A boundary
    is changed only when both neighbours own separate bands; otherwise the header-based
    boundary is kept.
    """
    if len(body) < 2 or len(cols) < 2:
        return
    bands = _body_bands(body, med_h)
    real = [i for i, c in enumerate(cols) if c.header_text != "(implied)"]
    owner: Dict[int, List[int]] = {i: [] for i in range(len(cols))}
    for b_idx, (b0, b1) in enumerate(bands):
        overlapping = [i for i in real if min(b1, cols[i].x1) - max(b0, cols[i].x0) > 0]
        if len(overlapping) == 1:
            owner[overlapping[0]].append(b_idx)
        elif not overlapping and real:
            # A band under no header belongs to the nearest header
            centre = (b0 + b1) / 2.0
            nearest = min(real, key=lambda i: min(abs(centre - cols[i].x0), abs(centre - cols[i].x1)))
            owner[nearest].append(b_idx)
        # A band under two headers cannot be split here; those boundaries stay header-based
    extent = {i: (bands[min(bs)][0], bands[max(bs)][1]) for i, bs in owner.items() if bs}
    for i in range(len(cols) - 1):
        left, right = extent.get(i), extent.get(i + 1)
        if left is None or right is None or left[1] >= right[0]:
            continue
        boundary = (left[1] + right[0]) / 2.0
        lower = cols[i].start if cols[i].start != float("-inf") else float("-inf")
        upper = cols[i + 1].end
        if lower < boundary < upper:
            cols[i].end = boundary
            cols[i + 1].start = boundary


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
    if role in ("discount", "discount_pct", "tax_amount", "gst_rate") and token.strip() in {"-", "—", "–"}:
        return True
    if role == "qty":
        return parse_quantity(token).value is not None and not re.search(r"[A-Za-z]{13,}", token)
    if role in NUMERIC_ROLES:
        return looks_numeric(token)
    if role == "unit":
        return normalize_unit(token) is not None or bool(re.fullmatch(r"[A-Za-z]{2,5}\.?", token))
    if role == "hsn":
        return bool(re.fullmatch(r"\d{2,8}|[-—–]", token))
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
        if role == "qty" and end - 2 >= start and re.fullmatch(r"[A-Za-z]{2,6}\.?", tok) \
                and parse_number(tokens[end - 2]).value is not None and not any(c.role == "unit" for c in cols):
            # "1.0 BOR" split into two tokens: quantity and its printed unit
            out[i].append(f"{tokens[end - 2]} {tok}")
            end -= 2
            continue
        if _fits_role(tok, role):
            out[i].append(tok)
            end -= 1
    out[prod_idx] = [" ".join(tokens[start:end])] if end > start else []
    return out


# --------------------------------------------------------------------------
# Table extraction
# --------------------------------------------------------------------------

PERCENT_ROLES = {"discount", "discount_pct", "tax_amount", "gst_rate"}
_TOTAL_ROW_RE = re.compile(r"^\s*(?:grand\s*)?total\b(?!\s*(?:amount|amt|payable)\s*[:₹\d])", re.I)


def _join(ws: Sequence[Any]) -> str:
    return " ".join(w.text if isinstance(w, Word) else str(w) for w in ws).strip()


def _parse_cell(role: str, text: str) -> NumberParse:
    return parse_quantity(text) if role == "qty" else parse_number(text)


def _row_cells(row: Row, cols: Sequence[Column], text_mode: bool) -> Tuple[Dict[int, List[Word]], Dict[int, str]]:
    if text_mode:
        raw = _cells_text(row, cols)
        return {i: [] for i in range(len(cols))}, {i: " ".join(v).strip() for i, v in raw.items()}
    cell_words = _cells_spatial(row, cols)
    return cell_words, {i: _join(ws) for i, ws in cell_words.items()}


def _strip_serial(product_text: str, expected_serial: int, serial_cell_filled: bool) -> str:
    """
    Removes a serial number printed in the description cell. A leading number is kept as
    part of the description unless it is clearly a serial: '3.' / '3)' or the next serial
    number when the S.No. column is empty. ('500 GM', '5 STAR' stay intact.)
    """
    m = re.match(r"^\s*(\d{1,3})([.)])?\s+(?=\S)", product_text)
    if not m:
        return product_text
    if m.group(2) or (int(m.group(1)) == expected_serial and not serial_cell_filled):
        return product_text[m.end():]
    return product_text


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
    elif not text_mode:
        body: List[Row] = []
        for r in rows[header_idx + 1:header_idx + 201]:
            if TABLE_END_RE.match(r.text.strip()) and body:
                break
            if sum(1 for w in r.words if looks_numeric(w.text)) >= 2:
                body.append(r)
        _refine_ranges_with_body(cols, body, _median_height(rows))

    items: List[ExtractedLine] = []
    debug_rows: List[Dict[str, Any]] = []
    warnings: List[str] = []
    totals_row: Dict[str, Decimal] = {}
    pending_text: List[Tuple[str, Row]] = []
    med_h = _median_height(rows)
    product_col = next((c for c in cols if c.role == "product"), None)
    serial_idx = next((i for i, c in enumerate(cols) if c.role == "serial"), None)
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
            if items and _TOTAL_ROW_RE.match(text):
                # The TOTAL row is read with the same columns, independently of the line items
                _, cells = _row_cells(row, cols, text_mode)
                for i, col in enumerate(cols):
                    if col.role in ("qty", "discount", "tax_amount", "total", "taxable") and cells.get(i):
                        val = _parse_cell(col.role, cells[i]).value
                        if val is not None:
                            totals_row[col.role] = totals_row.get(col.role, Decimal(0)) + val
            if items:
                break
            continue

        cell_words, cell_text = _row_cells(row, cols, text_mode)
        values: Dict[str, List[Tuple[int, NumberParse, List[Word]]]] = {}
        for i, col in enumerate(cols):
            if col.role in NUMERIC_ROLES and cell_text.get(i):
                values.setdefault(col.role, []).append((i, _parse_cell(col.role, cell_text[i]), cell_words.get(i, [])))

        product_text = " ".join(cell_text[i] for i, c in enumerate(cols) if c.role == "product" and cell_text.get(i)).strip()
        raw_cells = {f"{c.role}{'' if c.role != 'unknown' else ':' + c.header_text}": cell_text[i]
                     for i, c in enumerate(cols) if cell_text.get(i)}
        has_values = any(v[1].value is not None for role in ("qty", "rate", "purchase_price", "total", "taxable")
                         for v in values.get(role, []))
        debug_rows.append({"row_index": row.index, "text": text, "cells": raw_cells, "is_item": has_values})

        if not has_values:
            # A line holding only percentages under the discount/tax amounts ("(3%)  (0.1%)")
            if items and prev_row is not None:
                for role in PERCENT_ROLES:
                    for _, parsed, _ in values.get(role, []):
                        if parsed.value is None and parsed.percent is not None:
                            target = "discount_pct" if role.startswith("discount") else "gst_rate"
                            if getattr(items[-1], target) is None:
                                setattr(items[-1], target, parsed.percent)
            if product_text and is_description_fragment(row, product_text):
                pending_text.append((product_text, row))
                prev_row = row
            elif product_text:
                pending_text.clear()  # unrelated text (notes, addresses) is not part of any item
            elif values:
                prev_row = row
            continue
        prev_row = row

        serial_filled = serial_idx is not None and bool(cell_text.get(serial_idx))
        product_text = _strip_serial(product_text, len(items) + 1, serial_filled)
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
    return TableResult(items, cols, header_text, header_idx if header_idx >= 0 else None, debug_rows, warnings,
                       totals_row)


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
    penalty = 0.0

    def entries(role: str) -> List[Tuple[int, NumberParse, List[Word]]]:
        return values.get(role, [])

    def check(role: str, parsed: NumberParse, words: List[Word]) -> None:
        nonlocal penalty
        if parsed.ambiguous:
            issues.append(f"{_label(role)} cell '{parsed.raw}' contains more than one number")
            penalty += 20
        if parsed.corrected:
            issues.append(f"{_label(role)} '{parsed.raw}' was read as {_fmt(parsed.value)} after repairing an "
                          "OCR misread; verify against the invoice")
            penalty += 10
        low = [w for w in words if w.conf is not None and w.conf < 60 and looks_numeric(w.text)]
        if low:
            issues.append(f"Low OCR confidence for {_label(role)} '{parsed.raw}' ({int(min(w.conf for w in low))}%)")
            penalty += 15

    def value_of(role: str, rightmost: bool = False) -> Optional[Decimal]:
        found = [e for e in entries(role) if e[1].value is not None]
        for _, parsed, words in entries(role):
            check(role, parsed, words)
        if not found:
            return None
        return (found[-1] if rightmost else found[0])[1].value

    qty_entry = next((e for e in entries("qty") if e[1].value is not None), None)
    qty = value_of("qty")
    rate = value_of("rate")
    purchase_col = value_of("purchase_price")
    selling = value_of("selling_price")
    mrp = value_of("mrp")
    amount = value_of("total", rightmost=True)
    taxable = value_of("taxable")

    # Discount and tax cells carry an amount, a percentage, or both ("124.08 (3%)").
    discount = discount_pct = tax_amount = gst_rate = None
    for role in PERCENT_ROLES:
        col_pct = role in ("discount_pct", "gst_rate")
        for i, parsed, words in entries(role):
            check(role, parsed, words)
            is_disc = role.startswith("discount")
            if parsed.percent is not None:
                if is_disc:
                    discount_pct = parsed.percent
                else:
                    gst_rate = (gst_rate or 0) + parsed.percent
            if parsed.value is not None:
                if col_pct and parsed.percent is None:
                    if is_disc:
                        discount_pct = parsed.value
                    else:
                        gst_rate = (gst_rate or 0) + parsed.value
                elif is_disc:
                    discount = parsed.value
                else:
                    tax_amount = (tax_amount or 0) + parsed.value

    for bad in (qty, rate, purchase_col, selling, mrp, amount):
        if bad is not None and bad < 0:
            issues.append("Negative value found in a price/quantity column; verify the line")
            penalty += 20
            break
    if qty is not None and qty <= 0:
        issues.append("Quantity must be greater than 0")
        qty = None

    purchase_price = purchase_col if purchase_col is not None else rate

    # An unlabelled TAX value that only reconciles when read as a GST slab percentage
    if tax_amount is not None and gst_rate is None and tax_amount in GST_SLABS:
        as_amount = reconcile_line(qty, purchase_price, amount, discount, discount_pct, tax_amount, None, taxable)
        as_pct = reconcile_line(qty, purchase_price, amount, discount, discount_pct, None, tax_amount, taxable)
        if as_pct.status == "VERIFIED" and as_amount.status != "VERIFIED":
            gst_rate, tax_amount = tax_amount, None

    # Unit as printed: the Unit column, else the unit written with the quantity ("1.0 BOR")
    unit = None
    for i, c in enumerate(cols):
        if c.role == "unit" and cell_text.get(i):
            unit = cell_text[i].strip().rstrip(".")
    if unit is None and qty_entry is not None:
        unit = qty_entry[1].unit

    hsn = None
    for i, c in enumerate(cols):
        if c.role == "hsn" and cell_text.get(i):
            hsn, hsn_issue = parse_hsn(cell_text[i])
            if hsn_issue:
                issues.append(hsn_issue)

    rec = reconcile_line(qty, purchase_price, amount, discount, discount_pct, tax_amount, gst_rate, taxable)
    issues.extend(rec.issues)
    if rec.status == "MISMATCH":
        penalty += 30
    if purchase_price is None:
        penalty += 30
    if qty is None:
        penalty += 30
    if mrp is not None and purchase_price is not None and mrp < purchase_price:
        issues.append(f"MRP {_money(mrp)} is lower than the purchase rate {_money(purchase_price)}; check column alignment")
        penalty += 15

    if text_mode:
        base_conf = 100.0
    else:
        confs = [w.conf for ws_role in values.values() for _, _, ws in ws_role for w in ws if w.conf is not None]
        base_conf = statistics.mean(confs) if confs else 100.0  # digital PDF text has no OCR uncertainty
    if rec.status == "VERIFIED":
        base_conf = min(100.0, base_conf + 5)
    confidence = round(max(0.0, min(100.0, base_conf - penalty)), 1)

    barcode = next((re.sub(r"\D", "", cell_text[i]) for i, c in enumerate(cols) if c.role == "barcode" and cell_text.get(i)), None)

    return ExtractedLine(
        product_name=name,
        quantity=qty,
        unit=unit,
        unit_normalized=normalize_unit(unit),
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
        calculated_amount=rec.calculated_amount,
        amount_difference=rec.amount_difference,
        arithmetic_status=rec.status,
        arithmetic_rule=rec.rule,
        arithmetic_explanation=rec.explanation,
        confidence=confidence,
        issues=list(dict.fromkeys(issues)),
        suggestions=rec.suggestions,
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
            unit = m.group("unit") or None
            name = text[: m.start()].strip(" -:|")
        else:
            toks = text.split()
            nums: List[Decimal] = []
            while toks and len(nums) < 3 and looks_numeric(toks[-1]):
                v = parse_number(toks.pop()).value
                if v is None:
                    break
                nums.insert(0, v)
            if (len(nums) == 3 and nums[0] > 0 and nums[0] == nums[0].to_integral()
                    and abs(nums[0] * nums[1] - nums[2]) <= amount_tolerance(nums[0])):
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
            product_name=name, quantity=qty, unit=unit, unit_normalized=normalize_unit(unit), rate=rate,
            purchase_price=rate, selling_price=None, invoice_mrp=None, discount=None, discount_pct=None,
            tax_amount=None, gst_rate=None, taxable_amount=None, hsn_code=None, barcode=None,
            line_total=rec.line_total, line_total_source=rec.line_total_source,
            calculated_amount=rec.calculated_amount, amount_difference=rec.amount_difference,
            arithmetic_status=rec.status, arithmetic_rule=rec.rule, arithmetic_explanation=rec.explanation,
            confidence=min(75.0, 100.0 - (30 if rec.status == "MISMATCH" else 0)), issues=issues,
            suggestions=rec.suggestions, suggested_rate=rec.suggested_rate, raw_cells={},
            source_text=text, row_index=row.index, extraction_method="TEXT_LINE_ITEM",
        ))
    return TableResult(items, [], None, None, debug_rows, warnings)
