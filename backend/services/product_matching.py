"""
Product identity helpers shared by inventory matching and external MRP lookups.

Rules:
- A valid GTIN (EAN-8/UPC-A/EAN-13/GTIN-14, mod-10 check digit) is the strongest identifier.
- Names are compared after normalization; differing pack sizes (1 kg vs 500 g) never match.
- A shared brand or a single common word is not enough to match.
- When the best candidate does not clearly beat the runner-up, the match is rejected as ambiguous.
"""

import difflib
import re
from dataclasses import dataclass
from typing import Callable, Generic, List, Optional, Sequence, Tuple, TypeVar

from services.unit_registry import FAMILIES, UNITS, try_normalize_unit

T = TypeVar("T")

EXACT_NAME_SCORE = 0.97
FUZZY_MIN_SCORE = 0.88
AMBIGUITY_MARGIN = 0.08

# Pattern that finds a pack size in a product name; what the unit means comes from the unit registry
_PACK_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kgs?|kilo(?:gram)?s?|gms?|grams?|gr|g|ltrs?|litres?|liters?|lt|l|mls?)\b", re.I)


def gtin_check_digit_ok(digits: str) -> bool:
    total = 0
    for idx, ch in enumerate(reversed(digits[:-1])):
        total += int(ch) * (3 if idx % 2 == 0 else 1)
    return (10 - total % 10) % 10 == int(digits[-1])


def normalize_gtin(value: Optional[str]) -> Optional[str]:
    """Returns the GTIN zero-padded to 14 digits if it is a valid GTIN, else None."""
    if not value:
        return None
    digits = re.sub(r"[\s\-]", "", str(value))
    if not digits.isdigit() or len(digits) not in (8, 12, 13, 14):
        return None
    if not gtin_check_digit_ok(digits):
        return None
    return digits.zfill(14)


def _pack_unit(text: str) -> Optional[Tuple[str, float]]:
    """(base unit, factor) of a mass / volume unit from the unit registry ("kg" -> ("g", 1000.0))."""
    unit_id = try_normalize_unit(text)
    if unit_id is None or FAMILIES[UNITS[unit_id].family].kind != "measure":
        return None
    unit = UNITS[unit_id]
    return unit.base_unit, float(unit.factor)


def extract_pack_size(text: str) -> Optional[Tuple[str, float]]:
    """'Tata Salt 1kg' -> ('g', 1000.0). Returns None when no pack size is printed."""
    m = _PACK_RE.search(text or "")
    if not m:
        return None
    pack = _pack_unit(m.group(2))
    if not pack:
        return None
    base_unit, factor = pack
    return base_unit, round(float(m.group(1)) * factor, 3)


def normalize_name(text: str) -> str:
    """Lowercases, unifies pack-size spelling ('1 Kg' == '1kg' == '1000 g') and strips punctuation."""
    s = (text or "").lower()
    s = re.sub(r"[₹]|\brs\.?\b|\binr\b", " ", s)

    def _unit(m: "re.Match[str]") -> str:
        base_unit, factor = _pack_unit(m.group(2)) or (m.group(2).lower(), 1.0)
        qty = float(m.group(1)) * factor
        return f" {qty:g}{base_unit} "

    s = _PACK_RE.sub(_unit, s)
    s = re.sub(r"[^a-z0-9.\s]", " ", s)
    s = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def name_similarity(a: str, b: str) -> float:
    """0..1 similarity of two product names; 0 when pack sizes conflict."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    pa, pb = extract_pack_size(a), extract_pack_size(b)
    if pa and pb and pa != pb:
        return 0.0
    if na == nb:
        return 1.0
    seq = difflib.SequenceMatcher(None, na, nb).ratio()
    # Token overlap (tolerant of single-character OCR slips such as 'sa1t' vs 'salt')
    # keeps one shared word, e.g. only the brand, from producing a match.
    ta, tb = na.split(), nb.split()
    matched = sum(1 for t in ta if any(_tokens_match(t, u) for u in tb))
    overlap = matched / max(len(ta), len(tb))
    return round(0.6 * seq + 0.4 * overlap, 4)


def _without_pack_size(text: str) -> str:
    return re.sub(r"\s+", " ", _PACK_RE.sub(" ", text or "")).strip()


def inventory_name_similarity(a: str, b: str) -> float:
    """name_similarity for matching an invoice line to the shop's own products.

    Invoices usually print the pack size in the description ('Tata Salt 1kg') while the shop's
    product may be named without it ('Tata Salt'). When exactly ONE side carries a pack size and the
    names are otherwise identical, they are the same product. Different pack sizes still never match,
    and different names ('Sugar' vs 'Sugar Free') are still compared as before. Not used for external
    MRP lookups, where a pack-less name must not borrow a packed product's price.
    """
    score = name_similarity(a, b)
    if score >= 1.0 or score == 0.0 and extract_pack_size(a) and extract_pack_size(b):
        return score
    if bool(extract_pack_size(a)) != bool(extract_pack_size(b)):
        na, nb = normalize_name(_without_pack_size(a)), normalize_name(_without_pack_size(b))
        if na and na == nb:
            return 1.0
    return score


def _tokens_match(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) < 4:
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


@dataclass
class MatchResult(Generic[T]):
    candidate: Optional[T]
    score: float
    method: str  # "GTIN" | "EXACT_NAME" | "FUZZY_NAME" | "AMBIGUOUS" | "NO_MATCH"
    runner_up_score: float = 0.0


def best_name_match(
    query: str,
    candidates: Sequence[T],
    name_of: Callable[[T], str],
    min_score: float = FUZZY_MIN_SCORE,
    margin: float = AMBIGUITY_MARGIN,
    scorer: Callable[[str, str], float] = name_similarity,
) -> MatchResult[T]:
    """Picks the single best candidate by name, rejecting weak and ambiguous matches."""
    scored: List[Tuple[float, T]] = []
    for c in candidates:
        score = scorer(query, name_of(c))
        if score > 0:
            scored.append((score, c))
    if not scored:
        return MatchResult(None, 0.0, "NO_MATCH")
    scored.sort(key=lambda x: x[0], reverse=True)
    top_score, top = scored[0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0

    if top_score >= 1.0:
        exact = [c for s, c in scored if s >= 1.0]
        if len(exact) > 1:
            return MatchResult(None, top_score, "AMBIGUOUS", runner_up)
        return MatchResult(top, EXACT_NAME_SCORE, "EXACT_NAME", runner_up)
    if top_score < min_score:
        return MatchResult(None, top_score, "NO_MATCH", runner_up)
    if top_score - runner_up < margin:
        return MatchResult(None, top_score, "AMBIGUOUS", runner_up)
    return MatchResult(top, top_score, "FUZZY_NAME", runner_up)
