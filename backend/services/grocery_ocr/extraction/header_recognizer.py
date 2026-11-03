"""
Semantic header recognition and normalization for invoice table reconstruction.
Matches canonical column semantics, consolidates multi-line stacked headers,
and verifies geometric evidence against false-positive label classifications.
"""

import re
from typing import Dict, List, Optional, Set, Tuple
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRWord
from services.grocery_ocr.schemas.table import ColumnRoleType

# Comprehensive keyword dictionary for invoice table headers
HEADER_SEMANTIC_PATTERNS: Dict[ColumnRoleType, List[str]] = {
    "serial": [
        "s.no", "sl.no", "sr.no", "item no", "sno", "sr no", "sl no", "s no", "serial no", "si no",
        "sl", "si", "sr", "no.", "no"
    ],
    "product": [
        "item description", "tem description", "descri ption", "tem descri ption", "item descri ption", "tem descri", "description of goods",
        "product description", "item details", "description", "particulars", "product name",
        "material", "commodity", "goods", "item", "items", "product"
    ],
    "hsn": [
        "hsn/sac", "hsn code", "hsn", "sac", "hsn sac", "sac code"
    ],
    "qty": [
        "billed qty", "quantity", "unit qty", "qnty", "qty.", "qty", "nos", "pcs", "packets"
    ],
    "unit": [
        "unit of measure", "unit", "uom", "pack", "pkg", "packaging", "u.o.m"
    ],
    "rate": [
        "purchase rate", "unit price", "unit rate", "basic rate", "buy rate", "price", "rate",
        "reel", "rale", "tate", "rafe"
    ],
    "purchase_price": [
        "purchase price", "pur price", "buy price", "cost price", "purchase rate", "pur rate",
        "purch rate", "dealer price", "dp", "ptr", "landing cost", "purchase", "cost"
    ],
    "selling_price": [
        "selling price", "price selling", "sell price", "s.p.", "sp", "sale price", "sale rate",
        "sales price", "selling", "seling"
    ],
    "mrp": [
        "maximum retail price", "max retail price", "m.r.p.", "mrp", "m.r.p"
    ],
    "discount": [
        "discount amount", "discount", "disc", "disc.", "less", "rebate", "concession"
    ],
    "discount_pct": [
        "discount %", "disc %", "disc. %", "less %", "disc pct"
    ],
    "tax_amount": [
        "tax amount", "tax amt", "tax", "gst amount", "cgst amt", "sgst amt", "igst amt",
        "total tax", "vat amount", "vat amt"
    ],
    "gst_rate": [
        "gst %", "gst rate", "cgst %", "sgst %", "igst %", "tax %", "tax rate", "gst percentage"
    ],
    "taxable": [
        "taxable value", "taxable amount", "taxable amt", "taxable", "assessable value"
    ],
    "total": [
        "net amount", "total amount", "line total", "net amt", "tot amt", "value",
        "total value", "amount", "total"
    ],
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


class HeaderCandidate:
    """Represents a header candidate cluster from one or more lines."""

    def __init__(
        self,
        raw_text: str,
        role: ColumnRoleType,
        normalized_label: str,
        bbox: BoundingBox,
        words: List[OCRWord],
        confidence: float,
        is_percent: bool = False,
    ):
        self.raw_text = raw_text
        self.role = role
        self.normalized_label = normalized_label
        self.bbox = bbox
        self.words = words
        self.confidence = confidence
        self.is_percent = is_percent


class HeaderRecognizer:
    """
    Intelligent header recognition engine.
    Matches semantic headers, consolidates multi-line stacked headers,
    and validates geometric relationships against contradictions.
    """

    def __init__(self):
        # Build exact match and substring patterns
        self._exact_patterns: List[Tuple[ColumnRoleType, List[re.Pattern]]] = []
        self._search_patterns: List[Tuple[ColumnRoleType, List[re.Pattern]]] = []

        for role, aliases in HEADER_SEMANTIC_PATTERNS.items():
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
        Used for multi-word phrases to prevent accidental grouping of adjacent distinct columns.
        """
        cleaned = re.sub(r"[^\w\s%]", " ", text.lower()).strip()
        if not cleaned:
            return "unknown", 20.0, "UNKNOWN"

        is_pct = "%" in text or "percent" in text.lower() or "pct" in text.lower()
        if is_pct:
            if any(term in cleaned for term in ["disc", "discount", "less"]):
                return "discount_pct", 95.0, CANONICAL_HEADER_LABELS["discount_pct"]
            if any(term in cleaned for term in ["tax", "gst", "cgst", "sgst", "igst"]):
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
        Matches text against semantic column patterns.
        Returns:
            Tuple of (role, confidence, normalized_label)
        """
        cleaned = re.sub(r"[^\w\s%]", " ", text.lower()).strip()
        if not cleaned:
            return "unknown", 20.0, "UNKNOWN"

        is_pct = "%" in text or "percent" in text.lower() or "pct" in text.lower()

        # Check % specific overrides first
        if is_pct:
            if any(term in cleaned for term in ["disc", "discount", "less"]):
                return "discount_pct", 95.0, CANONICAL_HEADER_LABELS["discount_pct"]
            if any(term in cleaned for term in ["tax", "gst", "cgst", "sgst", "igst"]):
                return "gst_rate", 95.0, CANONICAL_HEADER_LABELS["gst_rate"]

        # Exact match check first (higher precision)
        for role, patterns in self._exact_patterns:
            for pat in patterns:
                if pat.match(cleaned):
                    if role == "rate" and any(d in cleaned for d in ["disc", "discount"]):
                        continue
                    if role == "qty" and any(s in cleaned for s in ["s.no", "sl.no", "sr.no", "sl", "sr", "si"]):
                        return "serial", 95.0, CANONICAL_HEADER_LABELS["serial"]
                    return role, 95.0, CANONICAL_HEADER_LABELS.get(role, role.upper())

        # Substring search match check
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

        # If single line, match phrases sequentially left-to-right
        if len(header_lines) == 1:
            return self._extract_line_candidates(header_lines[0], median_font_height)

        # Multi-line stacked headers:
        # First extract per-line candidates, then consolidate vertically aligned ones
        per_line_cands = [
            self._extract_line_candidates(line, median_font_height)
            for line in header_lines
        ]

        # Consolidate across lines
        consolidated: List[HeaderCandidate] = list(per_line_cands[0])

        for next_cands in per_line_cands[1:]:
            for nc in next_cands:
                # Check if nc aligns horizontally with an existing candidate
                matched = False
                for idx, ec in enumerate(consolidated):
                    # Check horizontal overlap
                    overlap = min(nc.bbox.x1, ec.bbox.x1) - max(nc.bbox.x0, ec.bbox.x0)
                    min_w = min(nc.bbox.width, ec.bbox.width)
                    if min_w > 0 and (overlap / min_w) >= 0.4:
                        # Stacked words forming a composite header e.g. "ITEM" + "DESCRIPTION"
                        combined_text = f"{ec.raw_text} {nc.raw_text}".strip()
                        combined_role, conf, norm_label = self.classify_text(combined_text)
                        # If combined role is recognized or ec role was recognized, use recognized role
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
                    # Verify words in phrase are close horizontally (character/word space)
                    is_contiguous = all(
                        (phrase_words[k + 1].bbox.x0 - phrase_words[k].bbox.x1) <= max(12.0, median_font_height * 1.0)
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
                # Single word token
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
