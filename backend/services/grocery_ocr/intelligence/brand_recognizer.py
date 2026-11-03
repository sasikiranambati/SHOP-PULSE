"""
Grocery brand recognition service.
Identifies canonical manufacturer and FMCG brands strictly from product description tokens.
Supports configurable brand aliases, spelling tolerance, and auditable confidence scoring.
"""

import re
from typing import Dict, List, Optional, Set, Tuple

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.logger import get_logger

logger = get_logger("intelligence.brand_recognizer")

# Canonical brand definitions: (canonical_name, list_of_regex_patterns_or_aliases)
DEFAULT_BRAND_REGISTRY: List[Tuple[str, List[str]]] = [
    # 1. Atta, Flours & Staple Brands
    ("Aashirvaad", [r"\baashirvaad\b", r"\baashirwad\b", r"\bashirvad\b", r"\bashirvaad\b"]),
    ("Fortune", [r"\bfortune\b", r"\bfortuen\b"]),
    ("Patanjali", [r"\bpatanjali\b", r"\bpatanjli\b"]),
    ("Rajdhani", [r"\brajdhani\b"]),
    ("Pillsbury", [r"\bpillsbury\b"]),
    ("Nature Fresh", [r"\bnature\s*fresh\b"]),
    ("Shakti Bhog", [r"\bshakti\s*bhog\b"]),
    ("24 Mantra", [r"\b24\s*mantra\b"]),
    ("Organic Tattva", [r"\borganic\s*tattva\b"]),

    # 2. Rice Brands
    ("India Gate", [r"\bindia\s*gate\b", r"\bindiagate\b"]),
    ("Daawat", [r"\bdaawat\b", r"\bdawaat\b", r"\bdawat\b"]),
    ("Kohinoor", [r"\bkohinoor\b", r"\bkoh-i-noor\b"]),
    ("Lal Qilla", [r"\blal\s*qilla\b", r"\blal\s*killa\b"]),
    ("Aeroplane", [r"\baeroplane\b", r"\bairoplane\b"]),
    ("Unity", [r"\bunity\b"]),
    ("Rozana", [r"\brozana\b"]),
    ("Royal", [r"\broyal\b(?!\s*enfield)"]),

    # 3. Cooking Oils & Ghee
    ("Gemini", [r"\bgemini\b"]),
    ("Saffola", [r"\bsaffola\b", r"\bsafola\b"]),
    ("Dhara", [r"\bdhara\b"]),
    ("Sundrop", [r"\bsundrop\b"]),
    ("Sunpure", [r"\bsunpure\b"]),
    ("Freedom", [r"\bfreedom\b(?!\s*fighter)"]),
    ("Ruchi Gold", [r"\bruchi\s*gold\b", r"\bruchi\b"]),
    ("Gold Winner", [r"\bgold\s*winner\b"]),
    ("Emami", [r"\bemami\b", r"\bhealthy\s*&\s*tasty\b"]),
    ("Anupam", [r"\banupam\b"]),
    ("Dalda", [r"\bdalda\b"]),
    ("Gowardhan", [r"\bgowardhan\b", r"\bgovardhan\b"]),

    # 4. Salt, Sugar & Spices
    ("Tata", [r"\btata\b", r"\btata\s*sampann\b", r"\btata\s*salt\b"]),
    ("Everest", [r"\beverest\b"]),
    ("MDH", [r"\bmdh\b"]),
    ("Catch", [r"\bcatch\b(?!\s*up)"]),
    ("MTR", [r"\bmtr\b"]),
    ("Badshah", [r"\bbadshah\b"]),
    ("Ramdev", [r"\bramdev\b"]),
    ("Goldiee", [r"\bgoldiee\b", r"\bgoldie\b"]),
    ("Rajesh", [r"\brajesh\s*masala\b", r"\brajesh\b"]),
    ("Eastern", [r"\beastern\b(?!\s*railway)"]),
    ("Aachi", [r"\baachi\b"]),
    ("Madhur", [r"\bmadhur\b"]),
    ("Mawana", [r"\bmawana\b"]),
    ("Trust", [r"\btrust\s*sugar\b", r"\btrust\b(?!\s*bank)"]),
    ("Parry's", [r"\bparry'?s\b", r"\bparrys\b"]),

    # 5. Tea & Coffee
    ("Brooke Bond", [r"\bbrooke\s*bond\b", r"\bred\s*label\b", r"\btaj\s*mahal\b", r"\btaaza\b"]),
    ("Wagh Bakri", [r"\bwagh\s*bakri\b", r"\bwaghbakri\b"]),
    ("Tetley", [r"\btetley\b"]),
    ("Society", [r"\bsociety\s*tea\b", r"\bsociety\b"]),
    ("Nescafe", [r"\bnescafe\b", r"\bnescaf[eé]\b"]),
    ("Bru", [r"\bbru\b"]),
    ("Continental", [r"\bcontinental\s*coffee\b", r"\bcontinental\b"]),

    # 6. Biscuits, Snacks & Packaged Foods
    ("Parle", [r"\bparle\b", r"\bparle-?g\b", r"\bkrackjack\b", r"\bmonaco\b", r"\bhide\s*&\s*seek\b"]),
    ("Britannia", [r"\bbritannia\b", r"\bbritania\b", r"\bgood\s*day\b", r"\bmarie\s*gold\b", r"\bbourbon\b"]),
    ("Sunfeast", [r"\bsunfeast\b", r"\bdark\s*fantasy\b", r"\bmom'?s\s*magic\b"]),
    ("Cadbury", [r"\bcadbury\b", r"\boreo\b", r"\bbournvita\b"]),
    ("Haldiram", [r"\bhaldiram'?s?\b", r"\bhaldirams?\b"]),
    ("Bikaji", [r"\bbikaji\b"]),
    ("Balaji", [r"\bbalaji\s*wafers?\b"]),
    ("Maggi", [r"\bmaggi\b", r"\bmaggie\b"]),
    ("Knorr", [r"\bknorr\b"]),
    ("Yippee", [r"\byippee\b", r"\byipee\b"]),
    ("Ching's", [r"\bching'?s\b", r"\bchings\b"]),
    ("Top Ramen", [r"\btop\s*ramen\b"]),
    ("Kissan", [r"\bkissan\b"]),
    ("Kellogg's", [r"\bkellogg'?s\b", r"\bkelloggs\b"]),
    ("Horlicks", [r"\bhorlicks\b"]),
    ("Complan", [r"\bcomplan\b"]),
    ("Boost", [r"\bboost\b"]),

    # 7. Dairy
    ("Amul", [r"\bamul\b"]),
    ("Mother Dairy", [r"\bmother\s*dairy\b"]),
    ("Nandini", [r"\bnandini\b"]),
    ("Milky Mist", [r"\bmilky\s*mist\b"]),
    ("Nestle", [r"\bnestle\b", r"\bnestl[eé]\b", r"\beveryday\b"]),

    # 8. Kirana Home & Personal Care Essentials
    ("Colgate", [r"\bcolgate\b"]),
    ("Dettol", [r"\bdettol\b"]),
    ("Lifebuoy", [r"\blifebuoy\b", r"\blifeboy\b"]),
    ("Lux", [r"\blux\b"]),
    ("Santoor", [r"\bsantoor\b"]),
    ("Dove", [r"\bdove\b"]),
    ("Pepsodent", [r"\bpepsodent\b"]),
    ("Close Up", [r"\bclose\s*up\b"]),
    ("Surf Excel", [r"\bsurf\s*excel\b", r"\bsurf\b"]),
    ("Ariel", [r"\bariel\b"]),
    ("Rin", [r"\brin\b"]),
    ("Tide", [r"\btide\b"]),
    ("Ghadi", [r"\bghadi\b", r"\bghari\b"]),
    ("Wheel", [r"\bwheel\b"]),
    ("Vim", [r"\bvim\b"]),
    ("Pril", [r"\bpril\b"]),
    ("Exo", [r"\bexo\b"]),
    ("Lizol", [r"\blizol\b"]),
    ("Harpic", [r"\bharpic\b"]),
    ("Godrej", [r"\bgodrej\b", r"\bgood\s*knight\b"]),
    ("All Out", [r"\ball\s*out\b"]),
]


class BrandRecognizer:
    """
    Intelligent grocery brand recognizer with alias support and word-boundary safety.
    Matches brands strictly against the product's own description.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config
        self._registry: List[Tuple[str, List[re.Pattern]]] = []
        self._init_registry(DEFAULT_BRAND_REGISTRY)

    def _init_registry(self, registry_definitions: List[Tuple[str, List[str]]]) -> None:
        """Compiles regex patterns for fast evaluation."""
        self._registry = []
        for canonical, patterns in registry_definitions:
            compiled = [re.compile(p, re.IGNORECASE) for p in patterns]
            self._registry.append((canonical, compiled))

    def add_brand(self, canonical_name: str, aliases: List[str]) -> None:
        """Dynamically registers or augments a brand definition."""
        patterns = [re.escape(a.strip()) if not a.startswith(r"\b") else a for a in aliases]
        compiled = [re.compile(p if p.startswith(r"\b") else rf"\b{p}\b", re.IGNORECASE) for p in patterns]
        self._registry.insert(0, (canonical_name, compiled))

    def recognize_brand(self, text: str) -> Tuple[Optional[str], float, List[str]]:
        """
        Identifies manufacturer brand from product description text.

        Args:
            text: Raw or normalized product title.

        Returns:
            Tuple of (canonical_brand, confidence, evidence_list).
            Returns (None, 0.0, []) if no brand is recognized.
        """
        if not text or len(text.strip()) < 2:
            return None, 0.0, []

        clean_text = text.strip()

        # Check each registered brand
        for canonical, patterns in self._registry:
            for pattern in patterns:
                match = pattern.search(clean_text)
                if match:
                    matched_str = match.group(0)
                    # Higher confidence for exact canonical match or multi-word match
                    if matched_str.lower() == canonical.lower():
                        confidence = 98.0
                    elif len(matched_str.split()) > 1:
                        confidence = 95.0
                    else:
                        confidence = 90.0

                    evidence = [f"Matched brand '{canonical}' via pattern '{pattern.pattern}' on '{matched_str}'"]
                    return canonical, confidence, evidence

        return None, 0.0, []

