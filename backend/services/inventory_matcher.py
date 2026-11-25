from decimal import Decimal
import re
from typing import List, Tuple, Any, Optional
from uuid import UUID

from schemas.voice import (
    VoiceProductCandidate,
    MatchedVoiceItem,
    AmbiguousVoiceItem,
    UnmatchedVoiceItem,
    StructuredVoiceItem,
)
from services.voice_parser import ExtractedItem, canonical_voice_unit
from services.money import bill_total, quantize_half_up, round_currency, round_price, sale_line_amount, to_decimal, to_number
from services.pricing_engine import calculate_line_price, PricingEngineError, evaluate_mrp_ceiling
from services.stock import format_quantity, quantity_number, to_stock_quantity
from services.unit_registry import FAMILIES, UNITS, UnitError, convert_quantity, try_normalize_unit


class VoiceItemError(ValueError):
    """A spoken line that cannot be sold as said (incompatible unit, fraction of a whole-number unit, ...).
    It is reported as unmatched with this reason; nothing is guessed."""

_RE_SEARCH_CLEAN = re.compile(r"[^a-zA-Z0-9\sऀ-ൿ]")
_RE_REPEAT_CHARS = re.compile(r"(.)\1+")


def normalize_text_for_search(text: str) -> str:
    """Removes punctuation and lowercases text for fuzzy token search while preserving Indic scripts."""
    cleaned = _RE_SEARCH_CLEAN.sub(" ", text)
    return " ".join(cleaned.lower().split())

PRODUCT_CONCEPT_ALIASES = {
    "Rice": [
        "rice", "basmati rice", "chawal", "white rice", "brown rice",
        "బియ్యం", "బాస్మతి బియ్యం", "రైస్",
        "चावल", "बासमती चावल", "राइस",
        "அரிசி", "பாஸ்மதி அரிசி",
        "ಅಕ್ಕಿ", "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ",
        "അരി", "ബസ്മതി അരി",
        "तांदूळ", "बासमती तांदूळ", "भात",
        "চাল", "বাসমতী চাল",
        "ચોખા", "બાસમતી ચોખા",
        "ਚੌਲ", "ਬਾਸਮਤੀ ਚੌਲ",
        "ଚାଉଳ", "ବାସମତୀ ଚାଉଳ",
        "চাউল", "বাসমতী চাউল"
    ],
    "Tata Salt": [
        "tata salt", "tata salt 1kg", "salt", "iodized salt",
        "టాటా సాల్ట్", "టాటా ఉప్పు", "ఉప్పు", "సాల్ట్",
        "टाटा नमक", "टाटा साल्ट", "नमक", "साल्ट",
        "டாடா உப்பு", "டாடா சால்ட்",
        "ಟಾಟಾ ಉಪ್ಪು", "ಟಾಟಾ ಸಾಲ್ಟ್",
        "ടാറ്റ ഉപ്പ്", "ടാറ്റ സോൾട്ട്",
        "टाटा मीठ", "टाटा सॉल्ट", "मीठ",
        "টাটা লবণ", "টাটা নুন", "লবণ", "নুন",
        "ટાટા મીઠું", "ટાટા સોલ્ટ", "મીઠું",
        "ਟਾਟਾ ਲੂਣ", "ਟਾਟਾ ਸਾਲਟ", "ਲੂਣ",
        "ଟାଟା ଲୁଣ", "ଲୁଣ",
        "টাটা নিমখ", "নিমখ"
    ],
    "Parle-G": [
        "parle-g", "parle g", "parleg", "parle g biscuits", "biscuits",
        "పార్లే-జి", "పార్లే జి", "పార్లే జీ", "బిస్కెట్లు", "బిస్కట్",
        "पारले-जी", "पारले जी", "पारलेजी", "बिस्कुट",
        "பார்லே-ஜி", "பார்லே ஜி", "பிஸ்கட்",
        "ಪಾರ್ಲೆ-ಜಿ", "ಪಾರ್ಲೆ ಜಿ", "ಬಿಸ್ಕತ್ತು",
        "പാർലെ-ജി", "പാർലെ ജി", "ബിസ്‌ക്കറ്റ്",
        "पारले-जी", "पारले जी", "बिस्कीट",
        "পার্লে-জি", "পার্লে জি", "বিস্কুট",
        "પાર્લે-જી", "પાર્લે જી", "બિસ્કિટ",
        "ਪਾਰਲੇ-ਜੀ", "ਪਾਰਲੇ ਜੀ", "ਬਿਸਕੁਟ",
        "ପାର୍ଲେ-ଜି", "ପାର୍ଲେ ଜି", "ବିସ୍କୁଟ",
        "পাৰ্লে-জি", "পাৰ্লে জি", "বিস্কুট"
    ],
    "Aashirvaad Atta": [
        "aashirvaad atta", "ashirvad atta", "atta", "wheat flour", "flour",
        "ఆశీర్వాద్ గోధుమ పిండి", "ఆశీర్వాద్ పిండి", "ఆశీర్వాద్ ఆటా", "గోధుమ పిండి", "పిండి", "ఆటా",
        "आशीर्वाद आटा", "आटा", "गेहूं का आटा",
        "ஆசீர்வாத் கோதுமை மாவு", "ஆசீர்வாத் மாவு", "கோதுமை மாவு", "மாவு",
        "ಆಶೀರ್ವಾದ್ ಗೋಧಿ ಹಿಟ್ಟು", "ಆಶೀರ್ವಾದ್ ಹಿಟ್ಟು", "ಗೋಧಿ ಹಿಟ್ಟು", "ಹಿಟ್ಟು",
        "ആശീർവാദ് ഗോതമ്പ് മാവ്", "ഗോതമ്പ് മാവ്",
        "आशीर्वाद आटा", "गव्हाचे पीठ", "आटा",
        "আশীর্বাদ আটা", "গম আটা", "আটা",
        "આશીર્વાદ લોટ", "ઘઉંનો લોਟ", "લોટ",
        "ਆਸ਼ੀਰਵਾਦ ਆਟਾ", "ਕਣਕ ਦਾ ਆਟਾ", "ਆਟਾ",
        "ଆଶୀର୍ବାଦ ଅଟା", "ଗହମ ଅଟା", "ଅଟା",
        "আশীৰ্বাদ আটা", "আটা"
    ],
    "Toned Milk": [
        "toned milk", "toned milk (500ml)", "milk", "amul milk",
        "టోన్డ్ పాలు", "పాలు", "మిల్క్",
        "टोन्ड दूध", "दूध", "मिल्क",
        "டோன்ட் பால்", "பால்",
        "ಟೋನ್ಡ್ ಹಾಲು", "ಹಾಲು",
        "ടോൺഡ് പാൽ", "പാൽ",
        "टोन्ड दूध", "दूध",
        "টোনড দুধ", "দুধ",
        "ટોન્ડ દૂધ", "દૂધ",
        "ਟੋਨਡ ਦੁੱਧ", "ਦੁੱਧ",
        "ଟୋନଡ୍ କ୍ଷୀର", "କ୍ଷୀର",
        "টোনড গাখীৰ", "গাখীৰ"
    ],
    "Fresh White Bread": [
        "fresh white bread", "white bread", "bread", "loaf of bread",
        "వైట్ బ్రెడ్", "బ్రెడ్",
        "व्हाइट ब्रेड", "ब्रेड",
        "வெள்ளை ரொட்டி", "ரொட்டி", "பிரெட்",
        "ವೈಟ್ ಬ್ರೆಡ್", "ಬ್ರೆಡ್",
        "വൈറ്റ് ബ്രെഡ്", "ബ്രെഡ്",
        "व्हाईट ब्रेड", "ब्रेड",
        "সাদা পাউরুটি", "পাউরুটি",
        "વ્હાઇટ બ્રેડ", "બ્રેડ",
        "ਵਾਈਟ ਬਰੈੱਡ", "ਬਰੈੱਡ",
        "ହ୍ୱାଇଟ୍ ବ୍ରେଡ୍", "ବ୍ରେଡ୍",
        "বগা পাউৰুটী", "পাউৰুটী"
    ],
    "Refined Sugar": [
        "refined sugar", "sugar", "sugar (1kg)",
        "చక్కెర", "పంచదార", "షుగర్",
        "चीनी", "शक्कर", "शुगर",
        "சர்க்கரை", "சீனி",
        "ಸಕ್ಕರೆ",
        "പഞ്ചസാര",
        "साखर",
        "চিনি",
        "ખાંડ",
        "ਖੰਡ",
        "ଚିନି",
        "চেনি"
    ],
    "Sunflower Cooking Oil": [
        "sunflower cooking oil", "sunflower oil", "oil", "cooking oil",
        "సన్‌ఫ్లవర్ నూనె", "వంట నూనె", "నూనె", "ఆయిల్",
        "सनफ्लावर तेल", "खाना पकाने का तेल", "तेल", "ऑयल",
        "சூரியகாந்தி எண்ணெய்", "சமையல் எண்ணெய்", "எண்ணெய்",
        "ಸೂರ್ಯಕಾಂತಿ ಎಣ್ಣೆ", "ಅಡುಗೆ ಎಣ್ಣೆ", "ಎಣ್ಣೆ",
        "സൂര്യകാന്തി എണ്ണ", "പാചക എണ്ണ", "എണ്ണ",
        "सूर्यफूल तेल", "खाद्यतेल", "तेल",
        "সূর্যমুখী তেল", "রান্নার তেল", "তেল",
        "સૂર્યમુખી તેલ", "તેલ",
        "ਸੂਰਜਮੁਖੀ ਤੇਲ", "ਤੇਲ",
        "ସୂର୍ଯ୍ୟମୁଖୀ ତେଲ", "ତେଲ",
        "সূৰ্য্যমুখী তেল", "তেল"
    ],
    "Premium Assam Tea": [
        "premium assam tea", "assam tea", "tea", "tea powder",
        "అస్సాం టీ", "టీ", "చాయ్", "టీ పొడి",
        "असम चाय", "चाय", "चाय पत्ती",
        "அசாம் தேநீர்", "தேநீர்", "டீ",
        "ಅಸ್ಸಾಂ ಚಹಾ", "ಚಹಾ", "ಟೀ",
        "അസം ചായ", "ചായ",
        "आसाम चहा", "चहा",
        "আসাম চা", "চা",
        "આસામ ચા", "ચા",
        "ਅਸਾਮ ਚਾਹ", "ਚਾਹ",
        "ଆସାମ ଚା", "ଚା",
        "অসম চাহ", "চাহ"
    ],
    "Coca Cola": [
        "coca cola", "coke", "cola", "cold drink",
        "కోకా కోలా", "కోక్", "కూల్ డ్రింక్",
        "कोका कोला", "कोक", "कोल्ड ड्रिंक",
        "கோகோ கோலா", "கோக்",
        "ಕೋಕಾ ಕೋಲಾ", "ಕೋಕ್",
        "കൊക്കകോള", "കോക്ക്",
        "कोका कोला", "कोक",
        "কোকা কোলা", "কোক",
        "કોકા કોલા", "કોક",
        "ਕੋਕਾ ਕੋਲਾ", "ਕੋਕ",
        "କୋକା କୋଲା", "କୋକ୍",
        "কোকা কোলা", "কোক"
    ]
}

_NORMALIZED_CONCEPT_ALIASES = [
    (concept_name, aliases, [normalize_text_for_search(a) for a in aliases])
    for concept_name, aliases in PRODUCT_CONCEPT_ALIASES.items()
]

def to_candidate(p: Any) -> VoiceProductCandidate:
    """Converts a database Product or candidate model/dict to a uniform VoiceProductCandidate."""
    if isinstance(p, VoiceProductCandidate):
        return p
    if hasattr(p, "id"):
        basis_qty = getattr(p, "price_basis_quantity", None)
        basis_qty = float(basis_qty) if basis_qty is not None else 1.0
        basis_unit = getattr(p, "price_basis_unit", None)
        mrp_basis_qty = getattr(p, "mrp_basis_quantity", None)
        mrp_basis_unit = getattr(p, "mrp_basis_unit", None)
        status = getattr(p, "pricing_status", None)
        mrp = getattr(p, "mrp", None)
        return VoiceProductCandidate(
            id=str(p.id),
            name=p.name,
            selling_price=float(p.selling_price if hasattr(p, "selling_price") else getattr(p, "price", 0.0)),
            current_stock=quantity_number(p.current_stock if hasattr(p, "current_stock") else getattr(p, "stock", 0)),
            unit=str(p.unit or "pcs"),
            category=getattr(p, "category", None),
            sku=getattr(p, "sku", None),
            price_basis_quantity=basis_qty,
            price_basis_unit=str(basis_unit) if basis_unit else str(p.unit or "pcs"),
            mrp_basis_quantity=float(mrp_basis_qty) if mrp_basis_qty is not None else None,
            mrp_basis_unit=str(mrp_basis_unit) if mrp_basis_unit else None,
            pricing_status=str(status) if status else "NEEDS_REVIEW",
            mrp=float(mrp) if mrp is not None else None,
        )
    basis_qty = p.get("price_basis_quantity")
    basis_qty = float(basis_qty) if basis_qty is not None else 1.0
    basis_unit = p.get("price_basis_unit")
    mrp_basis_qty = p.get("mrp_basis_quantity")
    mrp_basis_unit = p.get("mrp_basis_unit")
    status = p.get("pricing_status")
    mrp = p.get("mrp")
    return VoiceProductCandidate(
        id=str(p["id"]),
        name=p["name"],
        selling_price=float(p.get("selling_price", p.get("price", 0.0))),
        current_stock=quantity_number(p.get("current_stock", p.get("stock", 0))),
        unit=str(p.get("unit", "pcs")),
        category=p.get("category"),
        sku=p.get("sku"),
        price_basis_quantity=basis_qty,
        price_basis_unit=str(basis_unit) if basis_unit else str(p.get("unit", "pcs")),
        mrp_basis_quantity=float(mrp_basis_qty) if mrp_basis_qty is not None else None,
        mrp_basis_unit=str(mrp_basis_unit) if mrp_basis_unit else None,
        pricing_status=str(status) if status else "VERIFIED",
        mrp=float(mrp) if mrp is not None else None,
    )

# Precision of the exact unit price derived from a spoken total (so quantity x price reproduces the total)
_EXACT_UNIT_PRICE = Decimal("0.0000000001")

WEIGHT_AND_CONTAINER_TOKENS = {
    "1kg", "2kg", "5kg", "10kg", "500g", "250g", "200g", "100g", "50g",
    "1l", "2l", "5l", "500ml", "250ml", "200ml", "100ml",
    "kg", "g", "gm", "gms", "l", "ltr", "liter", "liters", "litre", "litres", "ml",
    "packet", "packets", "pkt", "pkts", "pack", "packs", "pcs", "piece", "pieces",
    "bottle", "bottles", "can", "cans", "box", "boxes", "tin", "tins", "pouch", "pouches",
    "loose", "bag", "bags"
}

DISTINGUISHING_MODIFIERS = {"flour", "powder", "free", "brown", "black", "essential"}

PRODUCT_CONCEPT_COMMODITY_TOKENS = {
    "Rice": {"rice"},
    "Tata Salt": {"salt"},
    "Refined Sugar": {"sugar"},
    "Sunflower Cooking Oil": {"oil"},
    "Premium Assam Tea": {"tea"},
    "Toned Milk": {"milk"},
    "Fresh White Bread": {"bread"},
    "Aashirvaad Atta": {"atta"},
    "Parle-G": {"parle", "biscuit"},
    "Coca Cola": {"cola", "coke"},
}

def stem_token(t: str) -> str:
    """Normalizes simple English plurals for token-level matching."""
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
        return t[:-1]
    return t


def _phonetic_normalize(tok: str) -> str:
    """Canonical phonetic spelling normalization (e.g. 'maggie' -> 'magi', 'aashirvaad' -> 'ashirvad')."""
    if not tok.isascii():
        return tok
    s = _RE_REPEAT_CHARS.sub(r"\1", tok.lower())
    s = s.replace("ie", "i").replace("ee", "i").replace("oo", "u").replace("ph", "f").replace("aa", "a")
    if len(s) > 4 and s.endswith("e"):
        s = s[:-1]
    return s


def _token_char_mask(tok: str) -> int:
    mask = 0
    for ch in tok:
        o = ord(ch)
        if 97 <= o <= 122:
            mask |= 1 << (o - 97)
        elif o > 127:
            mask |= 1 << 26
    return mask


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = curr
    return prev[-1]


def _token_similarity(a: str, b: str) -> float:
    """Dynamic token similarity combining exact/stemmed match, phonetic equivalence, and bounded edit distance."""
    sa, sb = stem_token(a), stem_token(b)
    if sa == sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    if not (sa.isascii() and sb.isascii()):
        return 0.0
    if sa.isdigit() or sb.isdigit():
        return 1.0 if sa == sb else 0.0
    if abs(len(sa) - len(sb)) > 3 or min(len(sa), len(sb)) < 3:
        return 0.0
    # Fast shared character check prunes completely unrelated catalog tokens before DP edit distance
    if not (set(sa) & set(sb)):
        return 0.0
    pa, pb = _phonetic_normalize(sa), _phonetic_normalize(sb)
    if pa and pa == pb and min(len(sa), len(sb)) >= 3:
        return 0.92
    if min(len(sa), len(sb)) < 4:
        return 0.0
    dist = _levenshtein(sa, sb)
    max_len = max(len(sa), len(sb))
    return max(0.0, 1.0 - (dist / max_len))

def query_matches_alias(query_norm: str, alias_norm: str) -> bool:
    """Matches a spoken query against an alias using token awareness to prevent substring bleed."""
    if query_norm == alias_norm:
        return True
    q_tokens = query_norm.split()
    a_tokens = alias_norm.split()
    if set(q_tokens) == set(a_tokens):
        return True
    q_stemmed = {stem_token(t) for t in q_tokens if t not in WEIGHT_AND_CONTAINER_TOKENS}
    a_stemmed = {stem_token(t) for t in a_tokens if t not in WEIGHT_AND_CONTAINER_TOKENS}
    if q_stemmed and q_stemmed == a_stemmed:
        return True
    return False

def candidate_matches_concept(cand: VoiceProductCandidate, concept_name: str, aliases: List[str]) -> bool:
    """Checks if a catalog candidate product corresponds to a generic concept without false-positive bleed."""
    c_norm = normalize_text_for_search(cand.name)
    concept_norm = normalize_text_for_search(concept_name)
    alias_norms = [normalize_text_for_search(a) for a in aliases]

    if c_norm == concept_norm or c_norm in alias_norms:
        return True

    c_tokens = set(c_norm.split())
    c_stemmed = {stem_token(t) for t in c_tokens if t not in WEIGHT_AND_CONTAINER_TOKENS}

    for a_norm in [concept_norm] + alias_norms:
        a_stemmed = {stem_token(t) for t in a_norm.split() if t not in WEIGHT_AND_CONTAINER_TOKENS}
        if c_stemmed and c_stemmed == a_stemmed:
            return True

    # Commodity subset matching: e.g. "Sona Masoori Rice 1kg" matches generic concept "Rice"
    commodity_tokens = PRODUCT_CONCEPT_COMMODITY_TOKENS.get(concept_name)
    if commodity_tokens and any(t in c_stemmed for t in commodity_tokens):
        extra_modifiers = c_stemmed & DISTINGUISHING_MODIFIERS
        if not extra_modifiers:
            return True

    concept_tokens = {stem_token(t) for t in concept_norm.split() if t not in WEIGHT_AND_CONTAINER_TOKENS}
    if concept_tokens and concept_tokens.issubset(c_stemmed):
        extra_modifiers = (c_stemmed - concept_tokens) & DISTINGUISHING_MODIFIERS
        if not extra_modifiers:
            return True

    if cand.category:
        cat_norm = normalize_text_for_search(str(cand.category))
        if concept_norm in cat_norm:
            extra_modifiers = c_stemmed & DISTINGUISHING_MODIFIERS
            if not extra_modifiers:
                return True

    return False


def _kind(unit_id: str) -> str:
    return FAMILIES[UNITS[unit_id].family].kind


def _colloquial(spoken: Optional[str], target: Optional[str]) -> bool:
    """Spoken count/package word for a product counted in another count/package unit ("3 tea packets" of a
    product stocked in pcs): one spoken item is one product unit. Measures (kg, g, L, ml) always convert."""
    return bool(spoken and target and spoken != target and UNITS[spoken].family != UNITS[target].family
                and _kind(spoken) != "measure" and _kind(target) != "measure")


def _spoken_unit(item: ExtractedItem) -> Optional[str]:
    return canonical_voice_unit(getattr(item, "unit", None))


def _stock_quantity(prod: VoiceProductCandidate, item: ExtractedItem) -> Decimal:
    """Spoken quantity in the product's stock unit: 500 g of a kg product -> 0.5. Incompatible units
    (L for a kg product) and fractions of whole-number units are refused, never guessed."""
    spoken = _spoken_unit(item)
    product_unit = try_normalize_unit(prod.unit) if prod.unit else None
    given = spoken
    if spoken and product_unit is None:
        given = spoken if _kind(spoken) == "measure" else None
    elif _colloquial(spoken, product_unit):
        given = None
    try:
        return to_stock_quantity(item.quantity, given, prod)
    except ValueError as exc:
        raise VoiceItemError(str(exc)) from None


def _quantity_for_price(item: ExtractedItem, prod: VoiceProductCandidate) -> Decimal:
    """Quantity in the unit a spoken unit price is per ("45 rupees per kg" for 500 g -> 0.5)."""
    qty = to_decimal(item.quantity)
    spoken = _spoken_unit(item) or (try_normalize_unit(prod.unit) if prod.unit else None)
    per = canonical_voice_unit(getattr(item, "price_unit", None))
    if per is None or spoken is None or per == spoken or _colloquial(spoken, per):
        return qty  # "each": per spoken unit
    try:
        return convert_quantity(qty, spoken, per)
    except UnitError as exc:
        raise VoiceItemError(f"'{prod.name}': the price is per {UNITS[per].label}, but {exc}") from None


def make_matched_item(
    prod: VoiceProductCandidate,
    item: ExtractedItem,
    match_confidence: Optional[float] = None,
) -> MatchedVoiceItem:
    """The sale line for a spoken item. Resolves price and stock deduction authoritatively via PricingEngine.
    A spoken price agreement is kept with price_source='spoken' and validated against statutory MRP.

    Raises VoiceItemError when the line cannot be sold as said (unverified status, incomplete pricing,
    wholesale violation, incompatible units, MRP exceeded)."""
    # 1. Gate check product pricing status
    status = str(prod.pricing_status or "VERIFIED").strip().upper()
    if status == "NEEDS_REVIEW":
        raise VoiceItemError(f"Product '{prod.name}' requires manager pricing review before checkout.")
    if status == "INCOMPLETE":
        raise VoiceItemError(f"Product '{prod.name}' has incomplete pricing (₹0.00). Cannot be sold.")

    spoken = _spoken_unit(item)
    product_unit = try_normalize_unit(prod.unit) if prod.unit else None

    # 2. Strict Wholesale Container Validation
    if status == "WHOLESALE_ONLY":
        req_u = spoken or product_unit or "pcs"
        norm_req = try_normalize_unit(req_u)
        norm_inv = product_unit
        if norm_req != norm_inv:
            raise VoiceItemError(f"Product '{prod.name}' is wholesale-only. Must purchase in '{prod.unit}', not in '{req_u}'.")
        qty_dec = to_decimal(item.quantity)
        if qty_dec != qty_dec.to_integral_value():
            raise VoiceItemError(f"Product '{prod.name}' is wholesale-only. Must purchase whole containers, not fractional ({item.quantity}).")

    # 3. Determine requested unit (respecting colloquial count units like packet of pcs)
    if spoken and product_unit and _colloquial(spoken, product_unit):
        req_unit = product_unit
    else:
        req_unit = spoken or product_unit or "pcs"

    # 4. Universal Decimal Pricing Engine Calculation
    basis_qty = prod.price_basis_quantity if prod.price_basis_quantity is not None else Decimal("1.0")
    basis_unit = prod.price_basis_unit if prod.price_basis_unit else prod.unit

    try:
        pricing_result = calculate_line_price(
            quantity=item.quantity,
            requested_unit=req_unit,
            selling_price=prod.selling_price,
            price_basis_quantity=basis_qty,
            price_basis_unit=basis_unit,
            inventory_unit=prod.unit,
            product_conversions=None,
            client_unit_price=None,
            pricing_status=status,
            product_name=prod.name,
            mrp=prod.mrp,
            mrp_basis_quantity=getattr(prod, "mrp_basis_quantity", None),
            mrp_basis_unit=getattr(prod, "mrp_basis_unit", None),
        )
    except PricingEngineError as exc:
        raise VoiceItemError(str(exc)) from None
    except ValueError as exc:
        raise VoiceItemError(str(exc)) from None

    qty = pricing_result.stock_deduction_quantity
    catalog_line_total = pricing_result.line_total

    # 5. Evaluate Spoken Price vs Catalog Price
    spoken_total = to_decimal(getattr(item, "spoken_price", None))
    spoken_unit_price = to_decimal(getattr(item, "spoken_unit_price", None))

    if spoken_total is not None and spoken_total > 0:
        line = round_currency(spoken_total)
        source = "spoken"
    elif spoken_unit_price is not None and spoken_unit_price > 0:
        line = sale_line_amount(_quantity_for_price(item, prod), spoken_unit_price)
        source = "spoken"
    else:
        line = catalog_line_total
        source = "catalogue"

    # 6. Statutory MRP Ceiling Enforcement for Spoken Prices (Legal Metrology Act)
    if source == "spoken" and pricing_result.line_mrp_total is not None:
        if line > pricing_result.line_mrp_total:
            raise VoiceItemError(
                f"Spoken price ₹{to_number(line)} for '{prod.name}' exceeds statutory MRP ₹{to_number(pricing_result.line_mrp_total)}."
            )

    # 7. Unit price formatting
    if source == "spoken":
        exact = quantize_half_up(line / qty, _EXACT_UNIT_PRICE)
        shown = round_price(exact)
    else:
        exact = pricing_result.effective_unit_price
        shown = round_price(exact)

    said = f"{format_quantity(item.quantity)} {UNITS[spoken].label}" if spoken else None
    stocked = f"{format_quantity(qty)} {prod.unit}"

    return MatchedVoiceItem(
        product_id=prod.id,
        name=prod.name,
        quantity=quantity_number(qty),
        unit_price=to_number(shown),
        unit_price_exact=to_number(exact),
        total_price=to_number(line),
        unit=prod.unit,
        current_stock=prod.current_stock,
        is_out_of_stock=prod.current_stock <= 0,
        is_insufficient_stock=float(qty) > prod.current_stock,
        available_stock=max(0, prod.current_stock),
        price_source=source,
        spoken_quantity=said if said and said != stocked else None,
        pricing_status=status,
        mrp=to_number(pricing_result.line_mrp_total) if pricing_result.line_mrp_total is not None else (float(prod.mrp) if prod.mrp is not None else None),
        catalog_line_total=to_number(catalog_line_total),
        action=getattr(item, "action", None) or "add",
        explicit_quantity=bool(getattr(item, "explicit_quantity", True)),
        match_confidence=match_confidence,
        quantity_source=getattr(item, "quantity_source", None) or "explicit",
        quantity_confidence=float(getattr(item, "quantity_confidence", 1.0) or 1.0),
        original_quantity_token=getattr(item, "original_quantity_token", None),
        raw_text=getattr(item, "raw_text", None),
        package_size=getattr(item, "package_size", None),
    )


def _filter_by_weights(cands: List[VoiceProductCandidate], query_weights: List[str], pkg_size: Optional[str]) -> List[VoiceProductCandidate]:
    """Filters candidate variants when the user specified a pack size or weight (e.g. '1kg' or 'of 70g')."""
    probes = list(query_weights)
    if pkg_size:
        probes.append(pkg_size.lower())
        spaced = re.sub(r"(\d+(?:\.\d+)?)([a-zA-Z]+)", r"\1 \2", pkg_size.lower())
        probes.append(spaced)
    if not probes:
        return cands
    filtered = []
    for c in cands:
        cnorm = normalize_text_for_search(c.name)
        ccompact = re.sub(r"\s+", "", cnorm)
        if any(p in cnorm or re.sub(r"\s+", "", p) in ccompact for p in probes):
            filtered.append(c)
    return filtered if filtered else cands


def match_items_to_inventory(
    extracted_items: List[ExtractedItem],
    catalog: List[Any],
) -> Tuple[List[MatchedVoiceItem], List[AmbiguousVoiceItem], List[UnmatchedVoiceItem], float, float, float]:
    """
    Matches extracted natural language items against inventory products using catalog-aware
    exact, alias, stemmed token, and dynamic phonetic/fuzzy scoring with confidence tiers.
    Returns: (matched_items, ambiguous_items, unmatched_items, subtotal, tax, total).
    """
    candidates_catalog = [to_candidate(p) for p in catalog]

    # Pre-normalize catalog entries once per call to avoid O(items * catalog) regex re-computation
    precomputed_catalog = []
    for c in candidates_catalog:
        c_norm = normalize_text_for_search(c.name)
        c_compact = c_norm.replace(" ", "")
        c_tokens_all = c_norm.split()
        c_stemmed_all = {stem_token(t) for t in c_tokens_all}
        c_name_stemmed = [stem_token(t) for t in c_tokens_all if t not in WEIGHT_AND_CONTAINER_TOKENS] or [stem_token(t) for t in c_tokens_all]
        c_name_meta = [(ct, _phonetic_normalize(ct), len(ct), _token_char_mask(ct)) for ct in c_name_stemmed]
        cat_stemmed = [stem_token(t) for t in normalize_text_for_search(str(c.category or "")).split() if len(t) > 2]
        precomputed_catalog.append((c, c_norm, c_compact, c_stemmed_all, c_name_stemmed, cat_stemmed, c_name_meta))

    normalized_concept_aliases = _NORMALIZED_CONCEPT_ALIASES

    matched_items: List[MatchedVoiceItem] = []
    ambiguous_items: List[AmbiguousVoiceItem] = []
    unmatched_items: List[UnmatchedVoiceItem] = []

    def add_match(prod: VoiceProductCandidate, item: ExtractedItem, confidence: float = 1.0) -> None:
        if getattr(item, "needs_quantity_confirmation", False):
            # Moderate contextual homophone confidence: offer lightweight "Did you mean? N × Product vs Add without quantity"
            suggested_qty = item.quantity
            fallback_item = item.model_copy(update={
                "quantity": 1,
                "explicit_quantity": False,
                "quantity_source": "default",
                "needs_quantity_confirmation": False,
            })
            options: List[MatchedVoiceItem] = []
            try:
                options.append(make_matched_item(prod, item, match_confidence=round(confidence, 3)))
                options.append(make_matched_item(prod, fallback_item, match_confidence=round(confidence, 3)))
            except VoiceItemError as exc:
                unmatched_items.append(UnmatchedVoiceItem(queried_name=item.name, quantity=item.quantity, reason=str(exc)))
                return
            spoken = to_decimal(getattr(item, "spoken_price", None))
            orig_tok = getattr(item, "original_quantity_token", None)
            raw_phrase = getattr(item, "raw_text", None) or item.name
            if orig_tok and re.match(rf"^{re.escape(str(suggested_qty))}\b", raw_phrase):
                raw_phrase = re.sub(rf"^{re.escape(str(suggested_qty))}\b", orig_tok, raw_phrase, count=1)
            ambiguous_items.append(AmbiguousVoiceItem(
                queried_name=item.name,
                quantity=suggested_qty,
                candidates=[prod],
                spoken_price=to_number(round_currency(spoken)) if spoken is not None and spoken > 0 else None,
                options=options,
                ambiguity_type="quantity",
                suggested_quantity=suggested_qty,
                fallback_quantity=1,
                raw_phrase=raw_phrase,
                reason=f"Detected possible homophone quantity '{orig_tok or ''}' -> {suggested_qty}",
            ))
            return
        try:
            matched_items.append(make_matched_item(prod, item, match_confidence=round(confidence, 3)))
        except VoiceItemError as exc:
            # Cannot be sold as said: shown for correction, never turned into a different sale
            unmatched_items.append(UnmatchedVoiceItem(queried_name=item.name, quantity=item.quantity, reason=str(exc)))

    def add_ambiguous(item: ExtractedItem, cands: List[VoiceProductCandidate]) -> None:
        options = []
        for cand in cands:
            try:
                options.append(make_matched_item(cand, item, match_confidence=0.75))
            except VoiceItemError:
                pass  # this candidate cannot be sold as said; the others stay selectable
        spoken = to_decimal(getattr(item, "spoken_price", None))
        ambiguous_items.append(AmbiguousVoiceItem(
            queried_name=item.name, quantity=item.quantity, candidates=cands,
            spoken_price=to_number(round_currency(spoken)) if spoken is not None and spoken > 0 else None,
            options=options,
        ))

    weights = ["1kg", "500g", "200g", "5kg", "100g", "400g", "70g", "140g", "1l", "2l"]

    for item in extracted_items:
        query_norm = normalize_text_for_search(item.name)
        if not query_norm:
            continue

        pkg_size = getattr(item, "package_size", None)
        q_tokens = [w for w in query_norm.split() if len(w) > 1 or w.isdigit()]
        q_meaningful = [stem_token(t) for t in q_tokens if t not in WEIGHT_AND_CONTAINER_TOKENS]
        if not q_meaningful:
            q_meaningful = [stem_token(t) for t in q_tokens]
        query_weights = [w for w in weights if w in query_norm or w in re.sub(r"\s+", "", query_norm)]

        # 1. Exact Catalog Match (Confidence 1.0)
        exact_matches = [c for c, c_norm, *_ in precomputed_catalog if c_norm == query_norm]

        if len(exact_matches) == 1:
            add_match(exact_matches[0], item, confidence=1.0)
            continue
        elif len(exact_matches) > 1:
            filtered = _filter_by_weights(exact_matches, query_weights, pkg_size)
            if len(filtered) == 1:
                add_match(filtered[0], item, confidence=1.0)
                continue
            add_ambiguous(item, filtered)
            continue

        # 2. Multilingual Concept Alias Search (Token-Aware, Confidence 0.95)
        alias_matched_prod = None
        alias_handled = False
        for concept_name, aliases, norm_aliases in normalized_concept_aliases:
            if any(query_matches_alias(query_norm, na) for na in norm_aliases):
                c_matches = [
                    c for c in candidates_catalog
                    if candidate_matches_concept(c, concept_name, aliases)
                ]
                if len(c_matches) == 1:
                    alias_matched_prod = c_matches[0]
                    break
                elif len(c_matches) > 1:
                    if len(q_meaningful) > 1:
                        specific_matches = [
                            c for c in c_matches
                            if set(q_meaningful).issubset({stem_token(t) for t in normalize_text_for_search(c.name).split() if t not in WEIGHT_AND_CONTAINER_TOKENS})
                        ]
                        if len(specific_matches) == 1:
                            alias_matched_prod = specific_matches[0]
                            break
                        elif len(specific_matches) > 1:
                            c_matches = specific_matches
                    filtered = _filter_by_weights(c_matches, query_weights, pkg_size)
                    if len(filtered) == 1 and filtered is not c_matches:
                        alias_matched_prod = filtered[0]
                        break
                    add_ambiguous(item, filtered)
                    alias_handled = True
                    break

        if alias_handled:
            continue
        elif alias_matched_prod:
            add_match(alias_matched_prod, item, confidence=0.95)
            continue

        # 3. Stemmed Token Containment Search (all query tokens present in candidate stems, Confidence 0.92)
        all_token_matches = []
        query_compact_full = query_norm.replace(" ", "")
        for c, c_norm, c_compact, c_stemmed, _, _, _ in precomputed_catalog:
            if q_meaningful and all(
                qt in c_stemmed or any((len(qt) >= 3 and qt in ct and abs(len(qt) - len(ct)) <= 3) for ct in c_stemmed)
                for qt in q_meaningful
            ):
                # Do not silently bleed onto a product with an unrequested distinguishing modifier (e.g. Rice Flour, Essential Oil)
                extra_mods = (c_stemmed - set(q_meaningful)) & DISTINGUISHING_MODIFIERS
                if not extra_mods or set(q_meaningful) & DISTINGUISHING_MODIFIERS:
                    all_token_matches.append(c)
            elif len(q_meaningful) >= 1 and len(query_compact_full) >= 4 and query_compact_full == c_compact:
                all_token_matches.append(c)

        if len(all_token_matches) > 1:
            all_token_matches = _filter_by_weights(all_token_matches, query_weights, pkg_size)

        if len(all_token_matches) == 1:
            add_match(all_token_matches[0], item, confidence=0.92)
            continue
        elif len(all_token_matches) > 1:
            add_ambiguous(item, all_token_matches)
            continue

        # 4. Dynamic Catalog-Aware Phonetic & Fuzzy Similarity with Confidence Tiers
        scored_candidates: List[Tuple[float, float, bool, VoiceProductCandidate]] = []
        q_set = set(q_meaningful)
        q_meta = [(qt, _phonetic_normalize(qt), len(qt), _token_char_mask(qt), qt.isascii() and not qt.isdigit()) for qt in q_meaningful]
        for c, c_norm, _, c_stemmed_all, c_name_stemmed, cat_stemmed, c_name_meta in precomputed_catalog:

            # Fast bitmask/stem prefilter before full token similarity scan
            plausible = False
            for qt, qp, q_len, q_mask, q_ok in q_meta:
                for ct, cp, c_len, c_mask in c_name_meta:
                    if qt == ct or (qp and qp == cp and q_len >= 3 and c_len >= 3):
                        plausible = True
                        break
                    if q_ok and q_len >= 4 and c_len >= 4:
                        max_len = q_len if q_len > c_len else c_len
                        max_dist = int(max_len * 0.22 + 1e-9)
                        if max_dist > 0 and abs(q_len - c_len) <= max_dist and (q_mask ^ c_mask).bit_count() <= 2 * max_dist:
                            plausible = True
                            break
                if plausible:
                    break
            if not plausible and not cat_stemmed:
                continue

            # Guard distinguishing modifiers in candidate that weren't asked for (e.g. Rice -> Rice Flour)
            extra_cand_mods = (set(c_name_stemmed) - q_set) & DISTINGUISHING_MODIFIERS
            if extra_cand_mods:
                continue

            matched_sims: List[float] = []
            unmatched_dist_mod = False
            matched_primary = False

            for qt, qp, q_len, q_mask, q_ok in q_meta:
                best_name_sim = 0.0
                for ct, cp, c_len, c_mask in c_name_meta:
                    if qt == ct:
                        best_name_sim = 1.0
                        break
                    if qp and qp == cp and q_len >= 3 and c_len >= 3:
                        sim = 0.92
                    elif q_ok and q_len >= 4 and c_len >= 4:
                        max_len = q_len if q_len > c_len else c_len
                        max_dist = int(max_len * 0.22 + 1e-9)
                        if max_dist > 0 and abs(q_len - c_len) <= max_dist and (q_mask ^ c_mask).bit_count() <= 2 * max_dist:
                            sim = _token_similarity(qt, ct)
                        else:
                            sim = 0.0
                    else:
                        sim = 0.0
                    if sim > best_name_sim:
                        best_name_sim = sim
                if best_name_sim >= 0.78:
                    matched_primary = True
                    matched_sims.append(best_name_sim)
                elif qt not in DISTINGUISHING_MODIFIERS and cat_stemmed:
                    best_cat_sim = max((_token_similarity(qt, ct) for ct in cat_stemmed), default=0.0)
                    if best_cat_sim >= 0.85:
                        matched_primary = True
                        matched_sims.append(0.86)
                        continue
                    matched_sims.append(0.0)
                else:
                    if qt in DISTINGUISHING_MODIFIERS:
                        unmatched_dist_mod = True
                    matched_sims.append(0.0)

            if not matched_primary or not q_meaningful:
                continue

            matched_count = sum(1 for sim in matched_sims if sim >= 0.78)
            coverage = matched_count / len(q_meaningful)
            avg_sim = sum(matched_sims) / len(q_meaningful)

            # Check whole compact similarity for joined words like "surfexel" vs "surf excel"
            q_compact = re.sub(r"\s+", "", "".join(q_meaningful))
            c_compact = re.sub(r"\s+", "", "".join(c_name_stemmed))
            if len(q_compact) >= 4 and len(c_compact) >= 4:
                compact_sim = _token_similarity(q_compact, c_compact)
                if compact_sim > avg_sim:
                    avg_sim = compact_sim
                    coverage = max(coverage, 1.0 if compact_sim >= 0.80 else coverage)

            confidence = min(0.94, 0.55 * coverage + 0.45 * avg_sim)
            if coverage >= 0.60 and confidence >= 0.60:
                scored_candidates.append((confidence, coverage, unmatched_dist_mod, c))

        if scored_candidates:
            scored_candidates.sort(key=lambda x: (-x[0], -x[1]))
            top_conf, top_cov, _, _ = scored_candidates[0]
            top_group = [entry for entry in scored_candidates if entry[0] >= top_conf - 0.05]
            best_cands = [entry[3] for entry in top_group]

            if len(best_cands) > 1:
                best_cands = _filter_by_weights(best_cands, query_weights, pkg_size)

            if len(best_cands) == 1:
                chosen_entry = next(e for e in top_group if e[3].id == best_cands[0].id)
                chosen_conf, chosen_cov, has_unmatched_mod, chosen_cand = chosen_entry
                if chosen_conf >= 0.85 and chosen_cov >= 0.99 and not has_unmatched_mod:
                    add_match(chosen_cand, item, confidence=chosen_conf)
                elif chosen_conf >= 0.60:
                    add_ambiguous(item, [chosen_cand])
                else:
                    unmatched_items.append(UnmatchedVoiceItem(
                        queried_name=item.name,
                        quantity=item.quantity,
                        reason="Product not found in shop inventory",
                    ))
            else:
                add_ambiguous(item, best_cands)
        else:
            unmatched_items.append(
                UnmatchedVoiceItem(
                    queried_name=item.name,
                    quantity=item.quantity,
                    reason="Product not found in shop inventory",
                )
            )

    # Bill = sum of the rounded lines (Decimal); no GST is calculated for voice bills
    subtotal_d = bill_total(to_decimal(m.total_price) for m in matched_items)
    tax_d = Decimal("0")
    subtotal, tax, total = to_number(subtotal_d), to_number(tax_d), to_number(round_currency(subtotal_d + tax_d))

    return matched_items, ambiguous_items, unmatched_items, subtotal, tax, total


def build_structured_voice_items(
    extracted_items: List[ExtractedItem],
    matched_items: List[MatchedVoiceItem],
    ambiguous_items: List[AmbiguousVoiceItem],
    unmatched_items: List[UnmatchedVoiceItem],
) -> List[StructuredVoiceItem]:
    """Builds Phase 6 per-item structured extraction + matching telemetry without altering tuple contracts."""
    structured: List[StructuredVoiceItem] = []
    matched_pool = list(matched_items)
    amb_pool = list(ambiguous_items)
    un_pool = list(unmatched_items)

    for ext in extracted_items:
        raw_txt = getattr(ext, "raw_text", None) or ext.name
        act = getattr(ext, "action", None) or "add"
        exp_qty = bool(getattr(ext, "explicit_quantity", True))
        pkg = getattr(ext, "package_size", None)

        m_idx = next((i for i, m in enumerate(matched_pool) if (m.raw_text == ext.raw_text or m.name.lower() == ext.name.lower() or ext.name.lower() in m.name.lower())), None)
        if m_idx is not None:
            m = matched_pool.pop(m_idx)
            structured.append(StructuredVoiceItem(
                raw_text=raw_txt,
                product_name=m.name,
                quantity=m.quantity,
                unit=m.unit,
                package_size=pkg,
                action=act,
                explicit_quantity=exp_qty,
                matched_product_id=m.product_id,
                match_confidence=m.match_confidence or 1.0,
                quantity_source=getattr(ext, "quantity_source", None) or "explicit",
                quantity_confidence=float(getattr(ext, "quantity_confidence", 1.0) or 1.0),
                original_quantity_token=getattr(ext, "original_quantity_token", None),
                status="MATCHED",
            ))
            continue

        a_idx = next((i for i, a in enumerate(amb_pool) if a.queried_name.lower() == ext.name.lower()), None)
        if a_idx is not None:
            a_pool_item = amb_pool.pop(a_idx)
            structured.append(StructuredVoiceItem(
                raw_text=raw_txt,
                product_name=a_pool_item.candidates[0].name if (a_pool_item.ambiguity_type == "quantity" and a_pool_item.candidates) else ext.name,
                quantity=ext.quantity,
                unit=ext.unit,
                package_size=pkg,
                action=act,
                explicit_quantity=exp_qty,
                matched_product_id=a_pool_item.candidates[0].id if a_pool_item.candidates else None,
                match_confidence=0.75,
                quantity_source=getattr(ext, "quantity_source", None) or "explicit",
                quantity_confidence=float(getattr(ext, "quantity_confidence", 1.0) or 1.0),
                original_quantity_token=getattr(ext, "original_quantity_token", None),
                status="AMBIGUOUS",
                reason=a_pool_item.reason or f"Multiple candidates ({len(a_pool_item.candidates)}) found",
            ))
            continue

        u_idx = next((i for i, u in enumerate(un_pool) if u.queried_name.lower() == ext.name.lower()), None)
        if u_idx is not None:
            u = un_pool.pop(u_idx)
            is_invalid = any(k in u.reason.lower() for k in ("review", "incomplete", "wholesale", "mrp", "converted", "whole"))
            structured.append(StructuredVoiceItem(
                raw_text=raw_txt,
                product_name=u.queried_name,
                quantity=u.quantity,
                unit=ext.unit,
                package_size=pkg,
                action=act,
                explicit_quantity=exp_qty,
                matched_product_id=None,
                match_confidence=0.0,
                status="INVALID" if is_invalid else "UNMATCHED",
                reason=u.reason,
            ))

    return structured
