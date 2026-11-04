"""
Header Intelligence Engine for ShopPulse Grocery OCR (Phase 2).
Provides comprehensive semantic header recognition, normalization, multi-line stacked header
consolidation, regional language support (Hindi, Telugu, Tamil, Kannada, Marathi, Gujarati, Bengali),
percentage disambiguation, and geometric bounding box clustering.
"""

from dataclasses import dataclass, field
import re
from typing import Dict, List, Optional, Sequence, Set, Tuple

from services.grocery_ocr.schemas.ocr import BoundingBox, OCRWord
from services.grocery_ocr.schemas.table import ColumnRoleType

# ---------------------------------------------------------------------------
# Semantic Aliases & Multi-Lingual Dictionary
# ---------------------------------------------------------------------------

HEADER_SEMANTIC_ALIASES: Dict[ColumnRoleType, List[str]] = {
    "serial": [
        "s.no", "sl.no", "sr.no", "item no", "sno", "sr no", "sl no", "s no", "serial no", "si no",
        "sl", "si", "sr", "no.", "no", "s.n", "slno", "srno", "#",
        # Indian languages:
        "क्र.सं.", "क्र.सं", "क्रमांक", "క్ర.సంఖ్య", "క్ర.సం", "வரிசை எண்", "வரிசை",
        "ಕ್ರಮ ಸಂಖ್ಯೆ", "ಅನುಕ್ರಮ", "अनुक्रमांक", "ক্রমিক"
    ],
    "product": [
        "item description", "tem description", "descri ption", "tem descri ption", "item descri ption",
        "description of goods", "product description", "item details", "description", "particulars",
        "product name", "material description", "material", "commodity", "goods", "item", "items",
        "product", "products", "item name", "desc", "items/desc", "prod name", "title", "article",
        "tems", "itms", "tem", "item/desc", "particulers",
        # Indian languages:
        "विवरण", "सामग्री", "वस्तु", "वस्तु विवरण", "नाम", "వస్తువు", "వివరాలు", "వివరణ", "పేరు",
        "பெயர்", "பொருள்", "பொருளின் பெயர்", "விவரம்", "ವಿವರ", "ಹೆಸರು", "ಇನಂ", "नाव", "तपशील",
        "পণ্য", "বিবরণ"
    ],
    "hsn": [
        "hsn/sac code", "hsn / sac code", "hsn/sac", "hsn / sac", "hsn code", "hsn", "sac code",
        "sac", "hsncode", "hsn sac", "taric", "tariff code",
        # Common OCR misreads:
        "[msn", "msn", "hsm", "hsn."
    ],
    "qty": [
        "billed qty", "billed quantity", "billed", "quantity", "unit qty", "qnty", "qty.", "qty",
        "units", "nos", "no.", "number", "pieces", "pcs", "packets", "count", "qnt", "vol", "volume",
        # Common OCR misreads:
        "ary.", "ary", "gty", "qtv", "oty", "qy", "qt.",
        # Indian languages:
        "मात्रा", "संख्या", "परिमाण", "పరిమాణం", "సంఖ్య", "నగలు", "அளவு", "எண்ணிக்கை",
        "ಪ್ರಮಾಣ", "ಸಂಖ್ಯೆ", "नग"
    ],
    "unit": [
        "unit of measure", "unit of measurement", "unit", "uom", "u.o.m", "pack", "pkg",
        "packaging", "packing", "measure", "type", "uom code"
    ],
    "rate": [
        "unit price", "unit rate", "basic rate", "price", "rate",
        "item rate", "item price", "basic price", "price/unit", "price / unit", "rate/unit",
        "rate / unit", "unit cost", "cost/unit", "cost / unit", "rate (₹)", "rate(₹)", "price (₹)",
        # Common OCR misreads:
        "reel", "rale", "tate", "rafe", "reel unit", "rale unit",
        # Indian languages:
        "दर", "प्रति दर", "भाव", "ధర", "రేటు", "விலை", "ದರ", "দর"
    ],
    "purchase_price": [
        "purchase price", "pur price", "buy price", "cost price", "purchase rate", "pur rate",
        "purch rate", "purch. rate", "dealer price", "wholesale price", "wholesale rate",
        "dp", "ptr", "landing cost", "purchase", "cost", "buying price", "buying rate",
        # Indian languages:
        "खपत दर", "खरीद दर", "కొనుగోలు ధర", "വാങ്ങിയ വില"
    ],
    "selling_price": [
        "selling price", "price selling", "sell price", "s.p.", "sp", "sale price", "sale rate",
        "sales price", "selling", "seling", "retail rate", "sale value", "retail price",
        # Common OCR misreads:
        "i fo", "ifo", "pms",
        # Indian languages:
        "विक्रय मूल्य", "बिक्री दर", "అమ్మకపు ధర", "விற்பனை விலை"
    ],
    "mrp": [
        "maximum retail price", "max retail price", "maximum retail", "max retail",
        "m.r.p.", "mrp", "m.r.p", "m r p",
        # Indian languages:
        "एमआरपी", "ఎం.ఆర్.పి", "அ.சி.வி"
    ],
    "discount": [
        "discount amount", "trade disc", "scheme disc", "discount", "disc", "disc.", "less",
        "rebate", "concession", "dis amt", "dis. amt", "cash discount", "cd amt", "td amt",
        # Indian languages:
        "छूट", "कटौती", "తగ్గింపు", "రాయితీ", "தள்ளுபடி", "ರಿಯಾಯಿತಿ"
    ],
    "discount_pct": [
        "discount %", "disc %", "disc. %", "less %", "disc pct", "dis %", "discount percentage",
        "trade disc %", "scheme %", "sch %"
    ],
    "tax_amount": [
        "tax amount", "tax amt", "tax", "gst amount", "gst amt", "gstamt", "gst value", "cgst amt", "sgst amt", "igst amt",
        "total tax", "vat amount", "vat amt", "tax value", "cgst", "sgst", "igst", "cess amt",
        # Common OCR misreads:
        "rel", "lax", "tex", "1ax", "fe",
        # Indian languages:
        "कर", "जीएसटी राशि", "పన్ను", "வரி", "ತೆರಿಗೆ"
    ],
    "gst_rate": [
        "gst %", "gst rate", "tax %", "tax rate", "rate %", "cgst %", "sgst %", "igst %",
        "gst percentage", "tax percentage", "vat %", "cess %"
    ],
    "taxable": [
        "taxable value", "taxable amount", "taxable amt", "taxable", "assessable value",
        "assessable amount", "basic amount", "basic value", "taxable val", "basic val"
    ],
    "total": [
        "net amount", "total amount", "line total", "net amt", "tot amt", "value",
        "total value", "amount", "total", "extended amount", "item total", "item amount",
        "final amount", "net value", "line amt", "net payable", "amount (₹)", "amount(₹)",
        "total (₹)", "total(₹)", "bill amount", "payable amount",
        # Indian languages:
        "कुल", "कुल राशि", "మొత్తం", "தொகை", "ಒಟ್ಟು", "মোট"
    ],
    "unknown": [],
    "ignore": [],
}

# Canonical normalized label display strings
CANONICAL_HEADER_LABELS: Dict[ColumnRoleType, str] = {
    "serial": "SERIAL",
    "product": "PRODUCT",
    "hsn": "HSN",
    "qty": "QUANTITY",
    "unit": "UNIT",
    "rate": "RATE",
    "purchase_price": "PURCHASE_PRICE",
    "selling_price": "SELLING_PRICE",
    "mrp": "MRP",
    "discount": "DISCOUNT",
    "discount_pct": "DISCOUNT_PCT",
    "tax_amount": "TAX",
    "gst_rate": "GST_RATE",
    "taxable": "TAXABLE_AMOUNT",
    "total": "AMOUNT",
    "unknown": "UNKNOWN",
    "ignore": "IGNORE",
}


@dataclass
class HeaderCandidate:
    """Represents a header candidate cluster from one or more lines."""
    raw_text: str
    role: ColumnRoleType
    normalized_label: str
    bbox: BoundingBox
    words: List[OCRWord] = field(default_factory=list)
    confidence: float = 100.0
    is_percent: bool = False


class HeaderIntelligenceEngine:
    """
    Production-grade Header Intelligence Engine.
    Features:
    - Multi-lingual alias matching with exact and substring regexes.
    - Multi-line vertical stacked header consolidation (e.g. "ITEM" on line 1 + "DESCRIPTION" on line 2).
    - Rate vs Selling Price vs Purchase Price disambiguation.
    - Percentage symbol (%) disambiguation for discount and GST rates.
    - Geometric bounding box clustering with spatial span computation.
    """

    def __init__(self):
        self._exact_patterns: List[Tuple[ColumnRoleType, List[re.Pattern]]] = []
        self._search_patterns: List[Tuple[ColumnRoleType, List[re.Pattern]]] = []

        for role, aliases in HEADER_SEMANTIC_ALIASES.items():
            if not aliases:
                continue
            sorted_aliases = sorted(aliases, key=len, reverse=True)
            exact_pats = []
            search_pats = []
            for alias in sorted_aliases:
                norm = re.sub(r"[^\w\s%]", " ", alias.lower()).strip()
                words = norm.split()
                if not words:
                    continue
                # Exact pattern
                exact_expr = r"^\s*" + r"\s+".join(re.escape(w) for w in words) + r"\s*$"
                exact_pats.append(re.compile(exact_expr, re.IGNORECASE))
                # Search pattern
                search_expr = r"(?<!\w)" + r"\s+".join(re.escape(w) for w in words) + r"(?!\w)"
                search_pats.append(re.compile(search_expr, re.IGNORECASE))

            self._exact_patterns.append((role, exact_pats))
            self._search_patterns.append((role, search_pats))

    def classify_exact(self, text: str) -> Tuple[ColumnRoleType, float, str]:
        """
        Matches text strictly against exact semantic column patterns.
        """
        cleaned = re.sub(r"[^\w\s%]", " ", text.lower()).strip()
        if not cleaned:
            return "unknown", 20.0, "UNKNOWN"

        is_pct = "%" in text or "percent" in text.lower() or "pct" in text.lower()
        if is_pct:
            if any(term in cleaned for term in ["disc", "discount", "less", "trade"]):
                return "discount_pct", 95.0, CANONICAL_HEADER_LABELS["discount_pct"]
            if any(term in cleaned for term in ["tax", "gst", "cgst", "sgst", "igst", "vat"]):
                return "gst_rate", 95.0, CANONICAL_HEADER_LABELS["gst_rate"]

        for role, patterns in self._exact_patterns:
            for pat in patterns:
                if pat.match(cleaned):
                    if role == "rate" and any(d in cleaned for d in ["disc", "discount"]):
                        continue
                    if role == "qty" and any(s in cleaned for s in ["s.no", "sl.no", "sr.no", "sl", "sr", "si"]):
                        return "serial", 95.0, CANONICAL_HEADER_LABELS["serial"]
                    return role, 95.0, CANONICAL_HEADER_LABELS.get(role, role.upper())

        return "unknown", 40.0, "UNKNOWN"

    def classify_text(self, text: str) -> Tuple[ColumnRoleType, float, str]:
        """
        Matches text against semantic column patterns (exact match first, then substring).
        """
        cleaned = re.sub(r"[^\w\s%]", " ", text.lower()).strip()
        if not cleaned:
            return "unknown", 20.0, "UNKNOWN"

        is_pct = "%" in text or "percent" in text.lower() or "pct" in text.lower()
        if is_pct:
            if any(term in cleaned for term in ["disc", "discount", "less", "trade"]):
                return "discount_pct", 95.0, CANONICAL_HEADER_LABELS["discount_pct"]
            if any(term in cleaned for term in ["tax", "gst", "cgst", "sgst", "igst", "vat"]):
                return "gst_rate", 95.0, CANONICAL_HEADER_LABELS["gst_rate"]

        # 1. Exact match check (highest precision)
        for role, patterns in self._exact_patterns:
            for pat in patterns:
                if pat.match(cleaned):
                    if role == "rate" and any(d in cleaned for d in ["disc", "discount"]):
                        continue
                    if role == "qty" and any(s in cleaned for s in ["s.no", "sl.no", "sr.no", "sl", "sr", "si"]):
                        return "serial", 95.0, CANONICAL_HEADER_LABELS["serial"]
                    return role, 95.0, CANONICAL_HEADER_LABELS.get(role, role.upper())

        # 2. Substring search check
        for role, patterns in self._search_patterns:
            for pat in patterns:
                if pat.search(cleaned):
                    if role == "rate" and any(d in cleaned for d in ["disc", "discount"]):
                        continue
                    if role == "qty" and any(s in cleaned for s in ["s.no", "sl.no", "sr.no", "sl", "sr", "si"]):
                        return "serial", 95.0, CANONICAL_HEADER_LABELS["serial"]
                    return role, 90.0, CANONICAL_HEADER_LABELS.get(role, role.upper())

        return "unknown", 40.0, "UNKNOWN"

    def extract_header_candidates(
        self,
        header_lines: List[List[OCRWord]],
        median_font_height: float,
    ) -> List[HeaderCandidate]:
        """
        Extracts semantic header candidates from one or more header lines.
        Handles multi-word phrases and stacked vertical multi-line headers.
        """
        if not header_lines:
            return []

        # Single line: match phrases sequentially left-to-right
        if len(header_lines) == 1:
            return self._extract_line_candidates(header_lines[0], median_font_height)

        # Multi-line stacked headers: extract candidates per line, then consolidate vertically
        per_line_cands = [
            self._extract_line_candidates(line, median_font_height)
            for line in header_lines
        ]

        consolidated: List[HeaderCandidate] = list(per_line_cands[0])

        for next_cands in per_line_cands[1:]:
            for nc in next_cands:
                matched = False
                for idx, ec in enumerate(consolidated):
                    overlap = min(nc.bbox.x1, ec.bbox.x1) - max(nc.bbox.x0, ec.bbox.x0)
                    min_w = min(nc.bbox.width, ec.bbox.width)
                    if min_w > 0 and (overlap / min_w) >= 0.4:
                        # Stacked words forming a composite header e.g. "ITEM" + "DESCRIPTION"
                        combined_text = f"{ec.raw_text} {nc.raw_text}".strip()
                        combined_role, conf, norm_label = self.classify_text(combined_text)
                        final_role = combined_role if combined_role != "unknown" else ec.role
                        final_norm = CANONICAL_HEADER_LABELS.get(final_role, final_role.upper())

                        x0 = min(ec.bbox.x0, nc.bbox.x0)
                        y0 = min(ec.bbox.y0, nc.bbox.y0)
                        x1 = max(ec.bbox.x1, nc.bbox.x1)
                        y1 = max(ec.bbox.y1, nc.bbox.y1)

                        consolidated[idx] = HeaderCandidate(
                            raw_text=combined_text,
                            role=final_role,
                            normalized_label=final_norm,
                            bbox=BoundingBox(x0=x0, y0=y0, x1=x1, y1=y1),
                            words=ec.words + nc.words,
                            confidence=max(ec.confidence, conf),
                            is_percent=ec.is_percent or nc.is_percent,
                        )
                        matched = True
                        break

                if not matched:
                    consolidated.append(nc)

        consolidated.sort(key=lambda c: c.bbox.x0)
        return consolidated

    def _extract_line_candidates(
        self,
        words: List[OCRWord],
        median_font_height: float,
    ) -> List[HeaderCandidate]:
        """Extracts header candidates from a single row of OCR words using greedy phrase matching."""
        if not words:
            return []

        sorted_words = sorted(words, key=lambda w: w.bbox.x0)
        n = len(sorted_words)
        candidates: List[HeaderCandidate] = []
        i = 0

        while i < n:
            matched = False
            # Try matching exact multi-word phrases of length 3, 2
            for span in (3, 2):
                if i + span <= n:
                    phrase_words = sorted_words[i : i + span]
                    is_contiguous = all(
                        (phrase_words[k + 1].bbox.x0 - phrase_words[k].bbox.x1) <= max(14.0, median_font_height * 1.2)
                        for k in range(span - 1)
                    )
                    if not is_contiguous:
                        continue

                    phrase_text = " ".join(w.text for w in phrase_words).strip()
                    role, conf, norm_label = self.classify_exact(phrase_text)

                    if role != "unknown":
                        x0 = min(w.bbox.x0 for w in phrase_words)
                        y0 = min(w.bbox.y0 for w in phrase_words)
                        x1 = max(w.bbox.x1 for w in phrase_words)
                        y1 = max(w.bbox.y1 for w in phrase_words)

                        candidates.append(
                            HeaderCandidate(
                                raw_text=phrase_text,
                                role=role,
                                normalized_label=norm_label,
                                bbox=BoundingBox(x0=x0, y0=y0, x1=x1, y1=y1),
                                words=phrase_words,
                                confidence=conf,
                                is_percent="%" in phrase_text or role in ("discount_pct", "gst_rate"),
                            )
                        )
                        i += span
                        matched = True
                        break

            if not matched:
                w = sorted_words[i]
                role, conf, norm_label = self.classify_exact(w.text)
                if role == "unknown":
                    role, conf, norm_label = self.classify_text(w.text)

                candidates.append(
                    HeaderCandidate(
                        raw_text=w.text,
                        role=role,
                        normalized_label=norm_label,
                        bbox=w.bbox,
                        words=[w],
                        confidence=conf if role != "unknown" else 40.0,
                        is_percent="%" in w.text,
                    )
                )
                i += 1

        return candidates
