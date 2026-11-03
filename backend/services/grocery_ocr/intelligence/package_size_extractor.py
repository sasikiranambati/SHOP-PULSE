"""
Package size extraction and normalization component.
Extracts physical package sizes (e.g. 50 kg, 500 gm, 1 L, 975 ml x 2, Pack of 4)
strictly separately from invoice billing quantities (e.g. 1 BOR, 10 BAG).
Never converts package sizes into billing quantities or invents conversion factors.
"""

import re
from decimal import Decimal
from typing import List, Optional, Tuple

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice_item import PackageSize

logger = get_logger("intelligence.package_size_extractor")

# Standard unit canonicalization mapping
UNIT_NORMALIZATION: dict[str, str] = {
    # Weight
    "kg": "kg",
    "kgs": "kg",
    "kilo": "kg",
    "kilos": "kg",
    "kilogram": "kg",
    "kilograms": "kg",
    "g": "g",
    "gm": "g",
    "gms": "g",
    "gram": "g",
    "grams": "g",
    "mg": "mg",
    "quintal": "quintal",
    "qtl": "quintal",

    # Volume
    "l": "l",
    "lt": "l",
    "ltr": "l",
    "ltrs": "l",
    "litre": "l",
    "litres": "l",
    "liter": "l",
    "liters": "l",
    "ml": "ml",
    "mls": "ml",
    "millilitre": "ml",
    "millilitres": "ml",
    "cl": "cl",

    # Count / Packaging
    "pc": "pcs",
    "pcs": "pcs",
    "piece": "pcs",
    "pieces": "pcs",
    "pack": "pack",
    "packs": "pack",
    "pkt": "pack",
    "pkts": "pack",
    "packet": "pack",
    "packets": "pack",
    "pouch": "pouch",
    "pouches": "pouch",
    "box": "box",
    "boxes": "box",
    "bx": "box",
    "can": "can",
    "cans": "can",
    "tin": "tin",
    "tins": "tin",
    "jar": "jar",
    "jars": "jar",
    "bottle": "bottle",
    "bottles": "bottle",
    "btl": "bottle",
    "btls": "bottle",
    "sachet": "sachet",
    "sachets": "sachet",
}

# Regex 1: Multi-pack formats like "975 ml x 2", "500gm * 4", "1L X 12"
MULTIPACK_REGEX = re.compile(
    r"\b(?P<val>\d+(?:\.\d+)?)\s*(?P<unit>[a-zA-Z]+)\s*(?:[xX*])\s*(?P<mult>\d+)\b"
)

# Regex 2: "Pack of 4", "Pack of 12"
PACK_OF_REGEX = re.compile(
    r"\b(?:pack|box|set)\s+of\s+(?P<mult>\d+)\b",
    re.I
)

# Regex 3: Standard single pack size e.g. "50 KG", "500 GM", "1.5 L", "100G"
# NOTE: billing/wholesale container units (BOR, BAG, CTN, BOX, DZ, DOZ, CS, TUB)
# are NOT pack sizes — they are invoice billing units. Exclude them here.
STANDARD_PACK_REGEX = re.compile(
    r"\b(?P<val>\d+(?:\.\d+)?)\s*(?P<unit>kg|kgs|kilo|kilogram|g|gm|gms|gram|grams|mg|l|lt|ltr|ltrs|litre|litres|liter|liters|ml|mls|quintal|qtl|pack|packs|pkt|pkts|packet|pouch|box|boxes|can|tin|jar|bottle|btl|sachet|pc|pcs)\b",
    re.I
)

# Units that are invoice billing / wholesale container units — should NEVER be extracted
# as pack sizes. These are quantities of the billing unit (BOR = borsa/sack, CTN = carton, etc.)
BILLING_UNIT_KEYWORDS = frozenset([
    "bor", "bag", "bags", "ctn", "carton", "cartons", "dz", "doz", "dozen", "cs", "case",
    "tub", "tubs", "drum", "drums", "bale", "bales", "roll", "rolls", "reel", "reels",
    "bundle", "bundles", "unit", "units",
])


class PackageSizeExtractor:
    """
    Extracts physical package sizes from grocery invoice product descriptions.
    Enforces distinction between packaging size and invoice billing quantity.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    def extract_package_size(self, text: str) -> Tuple[Optional[PackageSize], str]:
        """
        Extracts package size specification from the description and returns the
        extracted PackageSize and the description text with the size removed.

        Args:
            text: Product description text (e.g. "CHANA 50 KG", "FORTUNE BESAN 500 GM", "COKE 975 ML X 2")

        Returns:
            Tuple of (PackageSize or None, residual_text_without_size).
        """
        if not text or len(text.strip()) < 2:
            return None, text

        # 1. Check for Multipack patterns like "975 ML X 2"
        match_multi = MULTIPACK_REGEX.search(text)
        if match_multi:
            raw_unit = match_multi.group("unit").lower()
            if raw_unit in UNIT_NORMALIZATION:
                val = Decimal(match_multi.group("val"))
                mult = int(match_multi.group("mult"))
                norm_unit = UNIT_NORMALIZATION[raw_unit]
                raw_token = match_multi.group(0)

                # Remove token from text
                start, end = match_multi.span()
                residual = f"{text[:start]} {text[end:]}".strip()
                residual = re.sub(r"\s+", " ", residual)

                pkg = PackageSize(
                    value=val,
                    unit=norm_unit,
                    raw_text=raw_token,
                    multiplier=mult,
                    confidence=95.0,
                )
                return pkg, residual

        # 2. Check for "Pack of N" pattern
        match_pack_of = PACK_OF_REGEX.search(text)
        if match_pack_of:
            mult = int(match_pack_of.group("mult"))
            raw_token = match_pack_of.group(0)
            start, end = match_pack_of.span()
            residual = f"{text[:start]} {text[end:]}".strip()
            residual = re.sub(r"\s+", " ", residual)

            pkg = PackageSize(
                value=Decimal(mult),
                unit="pack",
                raw_text=raw_token,
                multiplier=mult,
                confidence=92.0,
            )
            return pkg, residual

        # 3. Check for standard "50 KG", "500 GM", "1 L"
        # Search all matches, prefer matches with known grocery units
        matches = list(STANDARD_PACK_REGEX.finditer(text))
        if matches:
            # Take the most relevant match (typically the last one if at end of description, e.g. "Besan 500 GM")
            best_match = matches[-1]
            raw_unit = best_match.group("unit").lower()
            if raw_unit in UNIT_NORMALIZATION:
                val = Decimal(best_match.group("val"))

                # Guard: zero or negative pack sizes are invalid
                if val <= Decimal("0"):
                    logger.warning("Discarding zero/negative pack size value: %s in '%s'", val, text)
                    return None, text

                norm_unit = UNIT_NORMALIZATION[raw_unit]
                raw_token = best_match.group(0)

                start, end = best_match.span()
                residual = f"{text[:start]} {text[end:]}".strip()
                residual = re.sub(r"\s+", " ", residual)

                pkg = PackageSize(
                    value=val,
                    unit=norm_unit,
                    raw_text=raw_token,
                    multiplier=1,
                    confidence=96.0,
                )
                return pkg, residual

        return None, text

