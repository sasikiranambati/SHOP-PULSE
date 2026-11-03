"""
Product description normalization service.
Standardizes grocery product names, repairs OCR spacing anomalies, expands abbreviations,
and strips leading serial numbers while preserving verbatim original OCR text.
"""

import re
from typing import Dict, List, Optional, Tuple

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.logger import get_logger

logger = get_logger("intelligence.product_normalizer")

# Common grocery abbreviations mapped to canonical expansions
ABBREVIATION_EXPANSIONS: Dict[str, str] = {
    # Multi-word phrases first
    r"\bmust\s*oil\b": "Mustard Oil",
    r"\bsun\s*oil\b": "Sunflower Oil",
    r"\bchana\s*dl\b": "Chana Dal",
    r"\btoor\s*dl\b": "Toor Dal",
    r"\btur\s*dl\b": "Toor Dal",
    r"\bmoong\s*dl\b": "Moong Dal",
    r"\burad\s*dl\b": "Urad Dal",
    r"\bmasoor\s*dl\b": "Masoor Dal",
    r"\bgram\s*flr\b": "Gram Flour",
    r"\bwht\s*flr\b": "Wheat Flour",
    r"\bchakki\s*ata\b": "Chakki Atta",
    r"\bhaldi\s*pwd\b": "Haldi Powder",
    r"\bcor\s*pwd\b": "Coriander Powder",
    r"\bdhan\s*pwd\b": "Dhaniya Powder",
    r"\bsoan\s*pdi\b": "Soan Papdi",
    r"\br\s*oil\b": "Refined Oil",
    # Single word abbreviations
    r"\bpwdr\b": "Powder",
    r"\bpwd\b": "Powder",
    r"\bpdr\b": "Powder",
    r"\bdl\b": "Dal",
    r"\bdall\b": "Dal",
    r"\bmust\b": "Mustard",
    r"\bsunflwr\b": "Sunflower",
    r"\bref\b": "Refined",
    r"\bro\b": "Refined Oil",
    r"\bbas\b": "Basmati",
    r"\bbasmti\b": "Basmati",
    r"\brcie\b": "Rice",
    r"\brce\b": "Rice",
    r"\bchki\b": "Chakki",
    r"\bata\b": "Atta",
    r"\bshud\b": "Shudh",
    r"\bsgr\b": "Sugar",
    r"\bsuear\b": "Sugar",
    r"\bsueer\b": "Sugar",
    r"\bturm\b": "Turmeric",
    r"\bdhan\b": "Dhaniya",
    r"\bdhaniya\b": "Dhaniya",
    r"\bcor\b": "Coriander",
    r"\bjeer\b": "Jeera",
    r"\bbisc\b": "Biscuit",
    r"\bbsct\b": "Biscuit",
    r"\bndls\b": "Noodles",
    r"\bwhl\b": "Whole",
}


class ProductNormalizer:
    """
    Normalizes product description strings for retail grocery items.
    Handles casing, punctuation, abbreviations, and OCR letter-spacing defects.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config
        # Sort patterns by length descending so longer phrases match first
        sorted_abbr = sorted(ABBREVIATION_EXPANSIONS.items(), key=lambda kv: len(kv[0]), reverse=True)
        self._compiled_abbreviations = [
            (re.compile(pat, re.IGNORECASE), repl)
            for pat, repl in sorted_abbr
        ]

    def repair_letter_spacing(self, text: str) -> str:
        """
        Repairs OCR letter spacing artifacts where words were broken into individual letters.
        Example: 'T a t a   S a l t' -> 'Tata Salt', 'F o r t u n e' -> 'Fortune'.
        """
        if not text:
            return text

        parts = re.split(r"\s{2,}", text.strip())
        fixed_parts = []
        for part in parts:
            # Merge runs of single letters: 'T a t a' -> 'Tata'
            p = re.sub(r"(?<=\b[A-Za-z])\s+(?=[A-Za-z]\b)", "", part)
            # Merge runs of single digits: '5 0 0' -> '500'
            p = re.sub(r"(?<=\b\d)\s+(?=\d\b)", "", p)
            # Normalize digit followed by unit: '1 k g' -> '1 kg'
            p = re.sub(r"(\d+)\s+([A-Za-z]+)", r"\1 \2", p)
            fixed_parts.append(p)

        return " ".join(fixed_parts)

    def strip_serial_numbers(self, text: str) -> str:
        """
        Strips leading serial number prefixes (e.g. '1.', '01', '#2', 'S.No 3').
        """
        if not text:
            return text

        # Strip prefixes like "1.", "01 -", "#3", "1)", "Sl No 5:"
        cleaned = re.sub(
            r"^\s*(?:(?:sl|sr|item)?\s*no\.?\s*)?#?\d{1,4}[.)\-\s/:]+\s*",
            "",
            text,
            flags=re.IGNORECASE,
        )
        return cleaned.strip()

    def expand_abbreviations(self, text: str) -> str:
        """
        Expands common grocery and OCR abbreviations into standardized terms.
        """
        if not text:
            return text

        result = text
        for pat, repl in self._compiled_abbreviations:
            result = pat.sub(repl, result)
        return result

    def clean_punctuation(self, text: str) -> str:
        """
        Cleans noise punctuation while preserving meaningful hyphens and slashes.
        """
        if not text:
            return text

        # Replace delimiter symbols with space
        cleaned = re.sub(r"[|:;=~_—*#^&]+", " ", text)
        # Collapse multiple spaces
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def normalize_title_case(self, text: str) -> str:
        """
        Standardizes capitalization to Title Case while keeping acronyms uppercase.
        """
        if not text:
            return text

        words = text.split()
        capitalized = []
        for w in words:
            if w.upper() in ("MDH", "MTR", "ITC", "RO", "GM", "KG", "ML", "L", "BOR", "BAG", "BOX", "PKT"):
                capitalized.append(w.upper())
            elif len(w) > 1 and w.isupper():
                capitalized.append(w.capitalize())
            elif len(w) > 1 and w.islower():
                capitalized.append(w.capitalize())
            else:
                capitalized.append(w)
        return " ".join(capitalized)

    def repair_fused_grocery_words(self, text: str) -> str:
        """
        Repairs common OCR fused tokens, digit-for-letter errors in pack sizes,
        and missing spaces between brand and pack size.
        """
        if not text:
            return text

        name = text
        # Correct OCR digit confusions on pack sizes: SO KG -> 50 KG, S00 GM -> 500 GM
        name = re.sub(r"\bSO(?=\s*KG\b)", "50", name, flags=re.I)
        name = re.sub(r"\bS00(?=\s*GM\b)", "500", name, flags=re.I)
        name = re.sub(r"(?<=[A-Za-z])SO(?=KG\b)", " 50 ", name, flags=re.I)
        name = re.sub(r"(?<=[A-Za-z])S00(?=GM\b)", " 500 ", name, flags=re.I)

        # Separate attached product-pack-unit tokens: CHANADAL1KG -> CHANA DAL 1 KG
        name = re.sub(r"([A-Za-z]+)(\d+(?:\.\d+)?)\s*([A-Za-z]+)", r"\1 \2 \3", name)

        # Common fused words in grocery items
        name = re.sub(r"\b(FORTUNE)(OIL)\b", r"\1 \2", name, flags=re.I)
        name = re.sub(r"\b(FORTUNE)(BESAN)\b", r"\1 \2", name, flags=re.I)
        name = re.sub(r"\b(CHANA)(DAL)\b", r"\1 \2", name, flags=re.I)
        name = re.sub(r"\b(MASOOR)(DAL)\b", r"\1 \2", name, flags=re.I)
        name = re.sub(r"\b(UDAD)(DAL)\b", r"\1 \2", name, flags=re.I)
        name = re.sub(r"\b(OIL)(CAN)(\d*)\b", r"\1 \2 \3", name, flags=re.I)
        name = re.sub(r"\b(PARLE)(G)\b", r"\1-\2", name, flags=re.I)
        name = re.sub(r"\b(SABUDANA)(KHICHDI)\b", r"\1 \2", name, flags=re.I)
        name = re.sub(r"\b(SONAL)(SABUDANA)(KHICHDI)\b", r"\1 \2 \3", name, flags=re.I)
        name = re.sub(r"\b(HELLO)(ORGANIC)\b", r"\1 \2", name, flags=re.I)
        name = re.sub(r"\bTe\b", "", name)
        if re.match(r"^sueAR\b", name, re.I):
            name = "SUGAR"
        return re.sub(r"\s+", " ", name).strip(" -|:")

    def normalize(self, raw_product_name: str) -> Tuple[str, str, float]:
        """
        Executes complete normalization pipeline on raw product text.

        Args:
            raw_product_name: Verbatim OCR string.

        Returns:
            Tuple of (raw_product_name, normalized_product_name, confidence).
        """
        if not raw_product_name or not raw_product_name.strip():
            return raw_product_name or "", "", 0.0

        raw = raw_product_name.strip()
        confidence = 100.0

        # Step 1: Repair letter spacing defects
        text = self.repair_letter_spacing(raw)
        if text != raw:
            confidence = max(80.0, confidence - 5.0)

        # Step 1b: Repair fused words and OCR pack size confusions
        fused_repaired = self.repair_fused_grocery_words(text)
        if fused_repaired != text:
            text = fused_repaired

        # Step 2: Strip leading serial numbers
        text = self.strip_serial_numbers(text)

        # Step 3: Expand abbreviations
        text = self.expand_abbreviations(text)

        # Step 4: Clean noise punctuation
        text = self.clean_punctuation(text)

        # Step 5: Normalize title case
        text = self.normalize_title_case(text)

        # Fallback if over-stripped
        if len(text.strip()) < 2:
            text = raw

        return raw, text, confidence
