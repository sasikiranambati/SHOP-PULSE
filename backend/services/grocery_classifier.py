"""
Indian Grocery Classification, Normalization, and Pack-Size Extraction Engine for ShopPulse.

Provides:
- Comprehensive Indian grocery taxonomy and alias normalization
- Explicit separation of product pack size (e.g. 50 kg, 500 gm, 1 L) from invoice quantity
- 4-tier classification status: GROCERY_CONFIDENT | GROCERY_REVIEW | NON_GROCERY | UNKNOWN_REVIEW
- Brand extraction and category assignment
- Safe fallback: Ambiguous items are NEVER discarded; they are marked UNKNOWN_REVIEW
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple


@dataclass
class GroceryClassification:
    is_grocery: bool
    status: str  # GROCERY_CONFIDENT | GROCERY_REVIEW | NON_GROCERY | UNKNOWN_REVIEW
    category: str
    normalized_name: str
    brand: Optional[str] = None
    pack_size: Optional[float] = None
    pack_size_unit: Optional[str] = None
    confidence: float = 0.0
    review_reasons: List[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# Taxonomy: Categories and Canonical Terms
# --------------------------------------------------------------------------

GROCERY_CATEGORIES = {
    "GRAINS_STAPLES": "Grains & Staples",
    "PULSES_LENTILS": "Pulses & Lentils",
    "COOKING_OILS": "Cooking Oils & Fats",
    "SPICES_SEASONINGS": "Spices & Seasonings",
    "PACKAGED_FOODS": "Packaged Groceries",
    "DRY_FRUITS": "Dry Fruits & Nuts",
    "HOUSEHOLD": "Household Essentials",
    "NON_GROCERY": "Non-Grocery",
    "OTHER_GROCERY": "Groceries",
}

# Known Indian Brands
KNOWN_BRANDS = [
    "Aashirvaad", "Fortune", "Tata", "Saffola", "Gemini", "Dhara", "Parle",
    "Britannia", "Sunfeast", "Everest", "MDH", "Catch", "Goldiee", "Badshah",
    "Surf Excel", "Rin", "Ariel", "Tide", "Vim", "Dettol", "Lifebuoy", "Colgate",
    "Maggi", "Knorr", "Haldiram", "Bikaji", "Patanjali", "Madhur", "India Gate",
    "Daawat", "Pillsbury", "Sona Sikka", "Freedom", "Emami", "Sundrop", "Anupam",
    "Ruchi", "Mahakosh", "Nutrela", "Catch", "RKG", "Gowardhan", "Amul", "Mother Dairy",
    "Wagh Bakri", "Red Label", "Taj Mahal", "Tata Tea", "Bru", "Nescafe", "Sunbean",
    "Sonal", "Hello Organic", "Sri Balaji",
]

# Alias dictionary: key regex pattern -> (canonical_name, category)
GROCERY_ALIASES: List[Tuple[str, str, str]] = [
    # Grains & Staples
    (r"\b(?:basmati\s*rice|basmati)\b", "Basmati Rice", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:sona\s*masoor[ie]|sonamasoor[ie])\b", "Sona Masoori Rice", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:rice|chawal|tandul|arisi)\b", "Rice", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:wheat|gehun|godhumai)\b", "Wheat", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:atta|chakki\s*atta|shudh\s*atta)\b", "Atta", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:maida|all\s*purpose\s*flour)\b", "Maida", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:rava|sooji|suji|semolina)\b", "Suji", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:poha|avalakki|aval|flattened\s*rice|chivda)\b", "Poha", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:dalia|broken\s*wheat|lapsi)\b", "Dalia", GROCERY_CATEGORIES["GRAINS_STAPLES"]),
    (r"\b(?:sabudana|sago|tapioca)\b", "Sabudana", GROCERY_CATEGORIES["GRAINS_STAPLES"]),

    # Pulses & Lentils
    (r"\b(?:chana\s*dal|chann?a\s*dal|gram\s*dal)\b", "Chana Dal", GROCERY_CATEGORIES["PULSES_LENTILS"]),
    (r"\b(?:chana|chann?a|chickpeas?|chole|kabuli\s*chana|kala\s*chana)\b", "Chana", GROCERY_CATEGORIES["PULSES_LENTILS"]),
    (r"\b(?:besan|gram\s*flour|chickpea\s*flour)\b", "Besan", GROCERY_CATEGORIES["PULSES_LENTILS"]),
    (r"\b(?:toor\s*dal|tur\s*dal|arhar\s*dal|tuvar\s*dal)\b", "Toor Dal", GROCERY_CATEGORIES["PULSES_LENTILS"]),
    (r"\b(?:moong\s*dal|mung\s*dal|moong\s*dhuli|moong\s*chilka)\b", "Moong Dal", GROCERY_CATEGORIES["PULSES_LENTILS"]),
    (r"\b(?:urad\s*dal|udad\s*dal|urad\s*gotta|black\s*gram)\b", "Urad Dal", GROCERY_CATEGORIES["PULSES_LENTILS"]),
    (r"\b(?:masoor\s*dal|masur\s*dal|red\s*lentil)\b", "Masoor Dal", GROCERY_CATEGORIES["PULSES_LENTILS"]),
    (r"\b(?:rajma|rajmah|kidney\s*beans)\b", "Rajma", GROCERY_CATEGORIES["PULSES_LENTILS"]),
    (r"\b(?:soyabean|soya\s*chunks|soya\s*bari|mealmaker)\b", "Soya Chunks", GROCERY_CATEGORIES["PULSES_LENTILS"]),

    # Cooking Oils & Fats
    (r"\b(?:sunflower\s*oil|sun\s*flower\s*oil)\b", "Sunflower Oil", GROCERY_CATEGORIES["COOKING_OILS"]),
    (r"\b(?:groundnut\s*oil|peanut\s*oil|sing\s*tel)\b", "Groundnut Oil", GROCERY_CATEGORIES["COOKING_OILS"]),
    (r"\b(?:mustard\s*oil|sarson\s*tel|kachi\s*ghani)\b", "Mustard Oil", GROCERY_CATEGORIES["COOKING_OILS"]),
    (r"\b(?:soybean\s*oil|soya\s*oil)\b", "Soybean Oil", GROCERY_CATEGORIES["COOKING_OILS"]),
    (r"\b(?:palm\s*oil|palmolein)\b", "Palm Oil", GROCERY_CATEGORIES["COOKING_OILS"]),
    (r"\b(?:ghee|desi\s*ghee|pure\s*ghee|cow\s*ghee)\b", "Ghee", GROCERY_CATEGORIES["COOKING_OILS"]),
    (r"\b(?:oil\s*can|oilcan)\b", "Cooking Oil Can", GROCERY_CATEGORIES["COOKING_OILS"]),

    # Spices & Seasonings
    (r"\b(?:turmeric|haldi|turmeric\s*powder)\b", "Turmeric", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),
    (r"\b(?:chilli|chili|mirch|mirchi|lal\s*mirch)\b", "Chilli Powder", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),
    (r"\b(?:coriander|dhaniya|dhania)\b", "Coriander Powder", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),
    (r"\b(?:cumin|jeera|zeera)\b", "Cumin", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),
    (r"\b(?:black\s*pepper|kali\s*mirch|pepper)\b", "Black Pepper", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),
    (r"\b(?:garam\s*masala|sabji\s*masala|curry\s*powder)\b", "Garam Masala", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),
    (r"\b(?:mustard\s*seeds?|rai|sarson)\b", "Mustard Seeds", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),
    (r"\b(?:fenugreek|methi)\b", "Fenugreek Seeds", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),
    (r"\b(?:hing|asafoetida)\b", "Asafoetida (Hing)", GROCERY_CATEGORIES["SPICES_SEASONINGS"]),

    # Packaged Groceries
    (r"\b(?:sugar|cheeni|shakar)\b", "Sugar", GROCERY_CATEGORIES["PACKAGED_FOODS"]),
    (r"\b(?:salt|namak|tata\s*salt)\b", "Salt", GROCERY_CATEGORIES["PACKAGED_FOODS"]),
    (r"\b(?:tea|chai|patti)\b", "Tea", GROCERY_CATEGORIES["PACKAGED_FOODS"]),
    (r"\b(?:coffee)\b", "Coffee", GROCERY_CATEGORIES["PACKAGED_FOODS"]),
    (r"\b(?:biscuit|biscuits|cookies?|parle\s*-?\s*g|marie)\b", "Biscuits", GROCERY_CATEGORIES["PACKAGED_FOODS"]),
    (r"\b(?:noodles?|maggi|pasta|vermicelli|sewai)\b", "Noodles & Pasta", GROCERY_CATEGORIES["PACKAGED_FOODS"]),
    (r"\b(?:jaggery|gur|gud)\b", "Jaggery", GROCERY_CATEGORIES["PACKAGED_FOODS"]),

    # Dry Fruits
    (r"\b(?:almonds?|badam)\b", "Almonds", GROCERY_CATEGORIES["DRY_FRUITS"]),
    (r"\b(?:cashews?|kaju)\b", "Cashews", GROCERY_CATEGORIES["DRY_FRUITS"]),
    (r"\b(?:raisins?|kismis|kishmish)\b", "Raisins", GROCERY_CATEGORIES["DRY_FRUITS"]),
    (r"\b(?:walnuts?|akhrot)\b", "Walnuts", GROCERY_CATEGORIES["DRY_FRUITS"]),

    # Household Essentials commonly found on Kirana bills
    (r"\b(?:surf\s*excel|surf|detergent|washing\s*powder|rin|ariel|tide)\b", "Detergent", GROCERY_CATEGORIES["HOUSEHOLD"]),
    (r"\b(?:vim|dishwash|dish\s*bar|pril)\b", "Dishwash", GROCERY_CATEGORIES["HOUSEHOLD"]),
    (r"\b(?:soap|bath\s*soap|dettol|lifebuoy|lux)\b", "Bath Soap", GROCERY_CATEGORIES["HOUSEHOLD"]),
    (r"\b(?:colgate|toothpaste|close\s*up|pepsodent)\b", "Toothpaste", GROCERY_CATEGORIES["HOUSEHOLD"]),
    (r"\b(?:agarbatti|incense\s*sticks?|dhoop)\b", "Agarbatti", GROCERY_CATEGORIES["HOUSEHOLD"]),
]

# Explicit Non-Grocery Patterns
NON_GROCERY_PATTERNS = [
    r"\b(?:freight|transport|shipping|delivery\s*charges?|labour|cartage)\b",
    r"\b(?:stationery|pen|pencil|paper|notebook|stapler|toner)\b",
    r"\b(?:hardware|cement|paint|pipe|wire|battery|bulb|led)\b",
    r"\b(?:plastic\s*crate|empty\s*box|packaging\s*charges?|trolley)\b",
    r"\b(?:service\s*charge|handling\s*charge|loading\s*charge)\b",
    r"\b(?:engine\s*oil|motor\s*oil|lubricant|gear\s*oil)\b",
]

# Standard HSN Code Prefixes for Indian Grocery
GROCERY_HSN_PREFIXES = {
    "0713": ("Pulses & Lentils", "Dried Legumes"),
    "1006": ("Grains & Staples", "Rice"),
    "1101": ("Grains & Staples", "Wheat Flour / Atta / Maida"),
    "1102": ("Grains & Staples", "Cereal Flours"),
    "1103": ("Grains & Staples", "Cereal Groats / Suji / Rava"),
    "1507": ("Cooking Oils & Fats", "Soybean Oil"),
    "1508": ("Cooking Oils & Fats", "Groundnut Oil"),
    "1511": ("Cooking Oils & Fats", "Palm Oil"),
    "1512": ("Cooking Oils & Fats", "Sunflower Oil"),
    "1514": ("Cooking Oils & Fats", "Mustard / Rapeseed Oil"),
    "0405": ("Cooking Oils & Fats", "Butter / Ghee"),
    "0901": ("Packaged Groceries", "Coffee"),
    "0902": ("Packaged Groceries", "Tea"),
    "0904": ("Spices & Seasonings", "Pepper / Chilli"),
    "0908": ("Spices & Seasonings", "Nutmeg / Cardamom"),
    "0909": ("Spices & Seasonings", "Cumin / Coriander / Fennel"),
    "0910": ("Spices & Seasonings", "Ginger / Turmeric"),
    "1701": ("Packaged Groceries", "Sugar"),
    "1902": ("Packaged Groceries", "Pasta / Noodles"),
    "1905": ("Packaged Groceries", "Biscuits / Bakery"),
    "2106": ("Packaged Groceries", "Food Preparations"),
    "2501": ("Packaged Groceries", "Salt"),
    "3401": ("Household Essentials", "Soaps"),
    "3402": ("Household Essentials", "Detergents & Surface Cleaning"),
}


# --------------------------------------------------------------------------
# Pack Size & Unit Extraction
# --------------------------------------------------------------------------

# Regex to match pack sizes inside descriptions like "50 KG", "500 GM", "1 L", "1.5 LTR"
PACK_SIZE_RE = re.compile(
    r"\b(?P<size>\d+(?:\.\d+)?)\s*(?P<unit>kg|kgs|kilo|kilogram|g|gm|gms|gram|grams|l|ltr|ltrs|liter|litres|ml|mls|pouch|pkt|pack)\b",
    re.I,
)


def extract_pack_size(raw_text: str) -> Tuple[str, Optional[float], Optional[str]]:
    """
    Identifies and separates package size (e.g. 50 kg, 500 gm, 1 L) from product description.
    Returns: (cleaned_title, pack_size, pack_size_unit)
    
    Example:
    'CHANA 50 KG' -> ('CHANA', 50.0, 'kg')
    'FORTUNE BESAN 500 GM' -> ('FORTUNE BESAN', 500.0, 'g')
    'PARLE-G' -> ('PARLE-G', None, None)
    """
    if not raw_text:
        return "", None, None

    m = PACK_SIZE_RE.search(raw_text)
    if not m:
        return raw_text.strip(), None, None

    val_str = m.group("size")
    unit_raw = m.group("unit").lower()

    try:
        size_val = float(val_str)
    except ValueError:
        return raw_text.strip(), None, None

    # Normalize unit
    if unit_raw in ("kg", "kgs", "kilo", "kilogram"):
        std_unit = "kg"
    elif unit_raw in ("g", "gm", "gms", "gram", "grams"):
        std_unit = "g"
    elif unit_raw in ("l", "ltr", "ltrs", "liter", "litres"):
        std_unit = "L"
    elif unit_raw in ("ml", "mls"):
        std_unit = "ml"
    else:
        std_unit = unit_raw

    # Keep original weight token in cleaned title for customer recognition if desired,
    # but return the explicit structured pack_size and pack_size_unit.
    return raw_text.strip(), size_val, std_unit


def extract_brand(text: str) -> Optional[str]:
    """Finds if a known Indian grocery brand exists in the text."""
    lower = text.lower()
    for brand in KNOWN_BRANDS:
        pattern = r"\b" + re.escape(brand.lower()) + r"\b"
        if re.search(pattern, lower):
            return brand
    return None


# --------------------------------------------------------------------------
# Main Classification Function
# --------------------------------------------------------------------------

def classify_product(
    raw_name: str,
    hsn_code: Optional[str] = None,
    quantity: Optional[float] = None,
    unit: Optional[str] = None,
    price: Optional[float] = None,
) -> GroceryClassification:
    """
    Classifies a recognized invoice line into grocery taxonomy without losing valid items.
    
    Status values:
    - GROCERY_CONFIDENT: Confirmed grocery product with high confidence.
    - GROCERY_REVIEW: Grocery product with warning (e.g. arithmetic mismatch or missing price).
    - NON_GROCERY: Explicit non-grocery item (e.g. delivery fee, stationery).
    - UNKNOWN_REVIEW: Unfamiliar product; preserved for user confirmation, NEVER deleted.
    """
    clean_text = raw_name.strip()
    if not clean_text:
        return GroceryClassification(
            is_grocery=False,
            status="UNKNOWN_REVIEW",
            category=GROCERY_CATEGORIES["OTHER_GROCERY"],
            normalized_name="",
            confidence=0.0,
            review_reasons=["Empty product title"],
        )

    # 1. Check for explicit non-grocery items (transport, stationery, hardware)
    for ng_pat in NON_GROCERY_PATTERNS:
        if re.search(ng_pat, clean_text, re.I):
            return GroceryClassification(
                is_grocery=False,
                status="NON_GROCERY",
                category=GROCERY_CATEGORIES["NON_GROCERY"],
                normalized_name=clean_text,
                confidence=95.0,
                review_reasons=["Identified as non-grocery item (freight, fee, or non-food)"],
            )

    # 2. Extract brand and pack size
    brand = extract_brand(clean_text)
    _, pack_size, pack_size_unit = extract_pack_size(clean_text)

    # 3. Check alias and keyword dictionary
    matched_canonical: Optional[str] = None
    matched_category: Optional[str] = None

    for pattern, canonical_name, cat in GROCERY_ALIASES:
        if re.search(pattern, clean_text, re.I):
            matched_canonical = canonical_name
            matched_category = cat
            break

    # 4. Check HSN code if available
    hsn_category: Optional[str] = None
    if hsn_code:
        hsn_clean = re.sub(r"\D", "", str(hsn_code))
        for prefix, (cat_name, _) in GROCERY_HSN_PREFIXES.items():
            if hsn_clean.startswith(prefix):
                hsn_category = cat_name
                break

    # 5. Build normalized product name
    if matched_canonical:
        # e.g. "Tata Salt 1kg" or "Chana 50 kg"
        norm_parts = []
        if brand and brand.lower() not in matched_canonical.lower():
            norm_parts.append(brand)
        norm_parts.append(matched_canonical)
        if pack_size is not None and pack_size_unit:
            norm_parts.append(f"{int(pack_size) if pack_size.is_integer() else pack_size} {pack_size_unit}")
        normalized_name = " ".join(norm_parts)
        category = matched_category or hsn_category or GROCERY_CATEGORIES["OTHER_GROCERY"]
        confidence = 95.0 if brand else 88.0
        status = "GROCERY_CONFIDENT"
        reasons = []

    elif hsn_category:
        normalized_name = clean_text
        category = hsn_category
        confidence = 85.0
        status = "GROCERY_CONFIDENT"
        reasons = [f"Classified via HSN code {hsn_code}"]

    elif brand:
        normalized_name = clean_text
        category = GROCERY_CATEGORIES["OTHER_GROCERY"]
        confidence = 80.0
        status = "GROCERY_CONFIDENT"
        reasons = [f"Matched brand '{brand}'"]

    else:
        # Ambiguous or unknown item: DO NOT DELETE! Keep for user review.
        normalized_name = clean_text
        category = GROCERY_CATEGORIES["OTHER_GROCERY"]
        confidence = 45.0
        status = "UNKNOWN_REVIEW"
        reasons = ["Product not found in grocery taxonomy; please verify if this is a grocery item"]

    # 6. Check for review flags (e.g. missing price, missing quantity)
    if price is None or price <= 0:
        if status == "GROCERY_CONFIDENT":
            status = "GROCERY_REVIEW"
        reasons.append("Missing or unreadable purchase price")

    if quantity is None or quantity <= 0:
        if status == "GROCERY_CONFIDENT":
            status = "GROCERY_REVIEW"
        reasons.append("Missing purchased quantity")

    return GroceryClassification(
        is_grocery=status != "NON_GROCERY",
        status=status,
        category=category,
        normalized_name=normalized_name,
        brand=brand,
        pack_size=pack_size,
        pack_size_unit=pack_size_unit,
        confidence=confidence,
        review_reasons=reasons,
    )
