"""
Standardized Indian Retail Category Master Taxonomy.

Defines the 12 canonical Indian retail categories, aliases for legacy mapping,
and non-destructive normalization routines.
"""

from typing import Dict, List, Optional, Tuple, Any

INDIAN_RETAIL_CATEGORIES: Tuple[str, ...] = (
    "Dairy",
    "Staples",
    "Grains and Pulses",
    "Snacks",
    "Beverages",
    "Bakery",
    "Personal Care",
    "Household and Cleaning",
    "Spices",
    "Edible Oils",
    "Baby Care",
    "Other",
)

CATEGORY_METADATA: List[Dict[str, Any]] = [
    {
        "code": "DAIRY",
        "name": "Dairy",
        "description": "Fresh milk (pouch/tetra), curd (dahi), paneer, butter, cheese, ghee-butter, and dairy drinks.",
        "display_order": 1,
    },
    {
        "code": "STAPLES",
        "name": "Staples",
        "description": "Atta (wheat flour), maida, sooji, besan, salt, refined sugar, and jaggery.",
        "display_order": 2,
    },
    {
        "code": "GRAINS_PULSES",
        "name": "Grains and Pulses",
        "description": "Basmati/raw rice, toor dal, moong dal, urad dal, chana, rajma, and whole pulses.",
        "display_order": 3,
    },
    {
        "code": "SNACKS",
        "name": "Snacks",
        "description": "Biscuits, cookies, namkeen, bhujia, potato chips, instant noodles, and savory snacks.",
        "display_order": 4,
    },
    {
        "code": "BEVERAGES",
        "name": "Beverages",
        "description": "Packaged CTC tea, Assam tea, instant coffee, soft drinks, bottled water, and juices.",
        "display_order": 5,
    },
    {
        "code": "BAKERY",
        "name": "Bakery",
        "description": "Fresh bread (white/brown/milk), pav, burger buns, rusks, and tea cakes.",
        "display_order": 6,
    },
    {
        "code": "PERSONAL_CARE",
        "name": "Personal Care",
        "description": "Bathing soaps, shampoos, oral care (toothpaste), hair oils, and grooming essentials.",
        "display_order": 7,
    },
    {
        "code": "HOUSEHOLD_CLEANING",
        "name": "Household and Cleaning",
        "description": "Detergents, dishwash bars/liquids, floor disinfectants (Lizol), and surface cleaners.",
        "display_order": 8,
    },
    {
        "code": "SPICES",
        "name": "Spices",
        "description": "Turmeric (haldi), red chili powder, coriander, garam masala, cumin, and whole spices.",
        "display_order": 9,
    },
    {
        "code": "EDIBLE_OILS",
        "name": "Edible Oils",
        "description": "Mustard oil, sunflower oil, groundnut oil, sesame oil, and cooking ghee.",
        "display_order": 10,
    },
    {
        "code": "BABY_CARE",
        "name": "Baby Care",
        "description": "Baby milk formula (Cerelac), diapers, baby wipes, and baby care toiletries.",
        "display_order": 11,
    },
    {
        "code": "OTHER",
        "name": "Other",
        "description": "Matches, pooja items, batteries, stationery, and miscellaneous non-food goods.",
        "display_order": 12,
    },
]

# Case-insensitive mapping for unambiguous legacy & test categories
UNAMBIGUOUS_LEGACY_MAPPINGS: Dict[str, str] = {
    "dairy": "Dairy",
    "bakery": "Bakery",
    "beverages": "Beverages",
    "personal care": "Personal Care",
    "household": "Household and Cleaning",
    "household and cleaning": "Household and Cleaning",
    "cleaning": "Household and Cleaning",
    "snacks": "Snacks",
    "snack": "Snacks",
    "biscuits": "Snacks",
    "biscuit": "Snacks",
    "spices": "Spices",
    "spice": "Spices",
    "edible oils": "Edible Oils",
    "edible oil": "Edible Oils",
    "oils": "Edible Oils",
    "oil": "Edible Oils",
    "grains": "Grains and Pulses",
    "grain": "Grains and Pulses",
    "grains and pulses": "Grains and Pulses",
    "pulses": "Grains and Pulses",
    "pulse": "Grains and Pulses",
    "baby care": "Baby Care",
}


def normalize_product_category(
    raw_category: Optional[str],
    product_name: Optional[str] = None
) -> Tuple[Optional[str], bool]:
    """
    Non-destructively normalizes an input category to the Indian retail master taxonomy.

    Returns:
        (standardized_category, needs_category_review)

    Rules:
        - If raw_category is empty/None:
            Returns (None, True).
        - If raw_category matches an unambiguous category:
            Returns (CanonicalCategory, False).
        - If raw_category is 'Staples':
            Inspects product_name for rice/dal/oil hints.
            If confident, maps accordingly (False review). Otherwise returns ("Staples", False).
        - If raw_category is 'Groceries', 'General', 'Other', or unmapped string:
            Preserves as "Other" and flags for user review (needs_category_review = True).
    """
    if not raw_category or not str(raw_category).strip():
        return None, True

    cleaned = str(raw_category).strip()
    norm_key = cleaned.lower()

    # Contextual resolution for 'Staples' (e.g. legacy Kirana stores filing rice or oil under Staples)
    pname_lower = (product_name or "").lower()
    if norm_key == "staples":
        if any(w in pname_lower for w in ["oil", "ghee", "mustard oil", "sunflower"]):
            return "Edible Oils", False
        if any(w in pname_lower for w in ["rice", "chawal", "dal", "pulses", "chana", "rajma", "poha"]):
            return "Grains and Pulses", False
        if any(w in pname_lower for w in ["salt", "sugar", "atta", "flour", "maida", "sooji", "besan"]):
            return "Staples", False
        return "Staples", False

    # Exact canonical match
    for canonical in INDIAN_RETAIL_CATEGORIES:
        if norm_key == canonical.lower():
            return canonical, False

    # Unambiguous legacy mapping
    if norm_key in UNAMBIGUOUS_LEGACY_MAPPINGS:
        return UNAMBIGUOUS_LEGACY_MAPPINGS[norm_key], False

    # Ambiguous categories ('Groceries', 'General', 'Other', or arbitrary string)
    # Check if product name gives a high-confidence match
    if any(w in pname_lower for w in ["milk", "curd", "dahi", "paneer", "butter", "cheese"]):
        return "Dairy", False
    if any(w in pname_lower for w in ["bread", "bun", "pav", "rusk"]):
        return "Bakery", False
    if any(w in pname_lower for w in ["soap", "shampoo", "colgate", "toothpaste"]):
        return "Personal Care", False
    if any(w in pname_lower for w in ["biscuit", "chips", "maggi", "noodles"]):
        return "Snacks", False

    # Do not force uncertain products; flag for review
    return "Other", True
