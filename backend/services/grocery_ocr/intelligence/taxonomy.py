"""
Configurable Indian Grocery Taxonomy definitions and semantic aliases.
Supports standardized categories, HSN prefixes, and non-grocery triggers for Phase 5.
"""

from typing import Dict, List, Optional, Tuple

# Standardized Grocery Categories as required by Section 2
CATEGORY_RICE = "Rice"
CATEGORY_WHEAT = "Wheat"
CATEGORY_ATTA = "Atta"
CATEGORY_MAIDA = "Maida"
CATEGORY_BESAN = "Besan"
CATEGORY_DAL_PULSES = "Dal and pulses"
CATEGORY_COOKING_OILS = "Cooking oils"
CATEGORY_SUGAR = "Sugar"
CATEGORY_SALT = "Salt"
CATEGORY_SPICES = "Spices"
CATEGORY_TEA = "Tea"
CATEGORY_COFFEE = "Coffee"
CATEGORY_BISCUITS = "Biscuits"
CATEGORY_PACKAGED_FOODS = "Packaged foods"
CATEGORY_DRY_FRUITS = "Dry fruits"
CATEGORY_NUTS = "Nuts"
CATEGORY_CEREALS = "Cereals"
CATEGORY_FLOURS = "Flours"
CATEGORY_DAIRY = "Dairy products"
CATEGORY_OTHER_GROCERY = "Other grocery products"
CATEGORY_NON_GROCERY = "Non-grocery products"

ALL_GROCERY_CATEGORIES = [
    CATEGORY_RICE,
    CATEGORY_WHEAT,
    CATEGORY_ATTA,
    CATEGORY_MAIDA,
    CATEGORY_BESAN,
    CATEGORY_DAL_PULSES,
    CATEGORY_COOKING_OILS,
    CATEGORY_SUGAR,
    CATEGORY_SALT,
    CATEGORY_SPICES,
    CATEGORY_TEA,
    CATEGORY_COFFEE,
    CATEGORY_BISCUITS,
    CATEGORY_PACKAGED_FOODS,
    CATEGORY_DRY_FRUITS,
    CATEGORY_NUTS,
    CATEGORY_CEREALS,
    CATEGORY_FLOURS,
    CATEGORY_DAIRY,
    CATEGORY_OTHER_GROCERY,
    CATEGORY_NON_GROCERY,
]

# Configurable alias mappings: regex pattern -> (canonical_product_name, category)
GROCERY_TAXONOMY_ALIASES: List[Tuple[str, str, str]] = [
    # 1. Atta & Flours
    (r"\b(?:atta|chakki\s*atta|shudh\s*atta|wheat\s*flour)\b", "Atta", CATEGORY_ATTA),
    (r"\b(?:besan|gram\s*flour|chickpea\s*flour)\b", "Besan", CATEGORY_BESAN),
    (r"\b(?:maida|all\s*purpose\s*flour)\b", "Maida", CATEGORY_MAIDA),
    (r"\b(?:sooji|suji|rava|semolina)\b", "Suji", CATEGORY_FLOURS),
    (r"\b(?:rice\s*flour|chawal\s*atta)\b", "Rice Flour", CATEGORY_FLOURS),
    (r"\b(?:corn\s*flour|makka\s*atta)\b", "Corn Flour", CATEGORY_FLOURS),
    (r"\b(?:ragi\s*flour|millet\s*flour)\b", "Ragi Flour", CATEGORY_FLOURS),

    # 2. Rice, Wheat & Cereals
    (r"\b(?:basmati\s*rice|basmati)\b", "Basmati Rice", CATEGORY_RICE),
    (r"\b(?:sona\s*masoor[ie]|sonamasoor[ie])\b", "Sona Masoori Rice", CATEGORY_RICE),
    (r"\b(?:kolam\s*rice|wada\s*kolam)\b", "Kolam Rice", CATEGORY_RICE),
    (r"\b(?:rice|chawal|tandul|arisi)\b", "Rice", CATEGORY_RICE),
    (r"\b(?:wheat|gehun|godhumai)\b", "Wheat", CATEGORY_WHEAT),
    (r"\b(?:poha|avalakki|aval|flattened\s*rice|chivda)\b", "Poha", CATEGORY_CEREALS),
    (r"\b(?:dalia|broken\s*wheat|lapsi)\b", "Dalia", CATEGORY_CEREALS),
    (r"\b(?:oats|corn\s*flakes|muesli|cereals?)\b", "Breakfast Cereals", CATEGORY_CEREALS),
    (r"\b(?:sabudana|sago|tapioca)\b", "Sabudana", CATEGORY_CEREALS),

    # 3. Dal and Pulses
    (r"\b(?:chana\s*dal|gram\s*dal)\b", "Chana Dal", CATEGORY_DAL_PULSES),
    (r"\b(?:chana|chickpeas?|chole|kabuli\s*chana|kala\s*chana)\b", "Chana", CATEGORY_DAL_PULSES),
    (r"\b(?:toor\s*dal|tur\s*dal|arhar\s*dal|tuvar\s*dal)\b", "Toor Dal", CATEGORY_DAL_PULSES),
    (r"\b(?:moong\s*dal|mung\s*dal|moong\s*dhuli|moong\s*chilka|green\s*gram)\b", "Moong Dal", CATEGORY_DAL_PULSES),
    (r"\b(?:urad\s*dal|udad\s*dal|urad\s*gotta|black\s*gram)\b", "Urad Dal", CATEGORY_DAL_PULSES),
    (r"\b(?:masoor\s*dal|masur\s*dal|red\s*lentil)\b", "Masoor Dal", CATEGORY_DAL_PULSES),
    (r"\b(?:rajma|rajmah|kidney\s*beans)\b", "Rajma", CATEGORY_DAL_PULSES),
    (r"\b(?:soyabean|soya\s*chunks|soya\s*bari|mealmaker)\b", "Soya Chunks", CATEGORY_DAL_PULSES),
    (r"\b(?:dal|dall?|pulses?|lentils?)\b", "Dal", CATEGORY_DAL_PULSES),

    # 4. Cooking Oils & Fats
    (r"\b(?:sunflower\s*oil|sun\s*flower\s*oil)\b", "Sunflower Oil", CATEGORY_COOKING_OILS),
    (r"\b(?:groundnut\s*oil|peanut\s*oil|sing\s*tel)\b", "Groundnut Oil", CATEGORY_COOKING_OILS),
    (r"\b(?:mustard\s*oil|sarson\s*tel|kachi\s*ghani)\b", "Mustard Oil", CATEGORY_COOKING_OILS),
    (r"\b(?:soybean\s*oil|soya\s*oil)\b", "Soybean Oil", CATEGORY_COOKING_OILS),
    (r"\b(?:palm\s*oil|palmolein)\b", "Palm Oil", CATEGORY_COOKING_OILS),
    (r"\b(?:rice\s*bran\s*oil)\b", "Rice Bran Oil", CATEGORY_COOKING_OILS),
    (r"\b(?:sesame\s*oil|til\s*oil|gingelly\s*oil)\b", "Sesame Oil", CATEGORY_COOKING_OILS),
    (r"\b(?:cooking\s*oil|edible\s*oil|refined\s*oil|vegetable\s*oil)\b", "Cooking Oil", CATEGORY_COOKING_OILS),
    (r"\b(?:ghee|desi\s*ghee|pure\s*ghee|cow\s*ghee)\b", "Ghee", CATEGORY_COOKING_OILS),

    # 5. Sugar & Salt
    (r"\b(?:sugar|cheeni|shakar)\b", "Sugar", CATEGORY_SUGAR),
    (r"\b(?:jaggery|gur|gud)\b", "Jaggery", CATEGORY_SUGAR),
    (r"\b(?:salt|namak|tata\s*salt|rock\s*salt|sendha\s*namak)\b", "Salt", CATEGORY_SALT),

    # 6. Biscuits & Packaged Foods (checked before generic spices so 'Maggi Masala Noodles' is Packaged foods)
    (r"\b(?:biscuit|biscuits|cookies?|rusk|parle\s*-?\s*g|marie|bourbon|krackjack|monaco)\b", "Biscuits", CATEGORY_BISCUITS),
    (r"\b(?:noodles?|maggi|pasta|macaroni|vermicelli|sewai|yippee)\b", "Noodles & Pasta", CATEGORY_PACKAGED_FOODS),
    (r"\b(?:chips|namkeen|bhujia|mixture|kurkure|lays)\b", "Snacks & Namkeen", CATEGORY_PACKAGED_FOODS),
    (r"\b(?:sauce|ketchup|jam|spread|mayonnaise)\b", "Sauces & Spreads", CATEGORY_PACKAGED_FOODS),
    (r"\b(?:papads?|appalam)\b", "Papad", CATEGORY_PACKAGED_FOODS),

    # 7. Spices & Seasonings
    (r"\b(?:turmeric|haldi|turmeric\s*powder)\b", "Turmeric", CATEGORY_SPICES),
    (r"\b(?:chilli\s*powder|chili\s*powder|mirch\s*powder|lal\s*mirch)\b", "Chilli Powder", CATEGORY_SPICES),
    (r"\b(?:coriander\s*powder|dhaniya\s*powder|dhania\s*powder)\b", "Coriander Powder", CATEGORY_SPICES),
    (r"\b(?:cumin|jeera|zeera)\b", "Cumin", CATEGORY_SPICES),
    (r"\b(?:black\s*pepper|kali\s*mirch|pepper\s*powder)\b", "Black Pepper", CATEGORY_SPICES),
    (r"\b(?:garam\s*masala|sabji\s*masala|curry\s*powder|kitchen\s*king|sambar\s*masala)\b", "Garam Masala", CATEGORY_SPICES),
    (r"\b(?:mustard\s*seeds?|rai|sarson)\b", "Mustard Seeds", CATEGORY_SPICES),
    (r"\b(?:fenugreek|methi\s*seeds?)\b", "Fenugreek Seeds", CATEGORY_SPICES),
    (r"\b(?:cardamom|elaichi)\b", "Cardamom", CATEGORY_SPICES),
    (r"\b(?:cloves?|laung|lavang)\b", "Cloves", CATEGORY_SPICES),
    (r"\b(?:cinnamon|dalchini)\b", "Cinnamon", CATEGORY_SPICES),
    (r"\b(?:hing|asafoetida)\b", "Asafoetida (Hing)", CATEGORY_SPICES),
    (r"\b(?:spices?|masala)\b", "Spices", CATEGORY_SPICES),

    # 8. Tea & Coffee
    (r"\b(?:tea|chai|patti|green\s*tea|tea\s*bags?)\b", "Tea", CATEGORY_TEA),
    (r"\b(?:coffee|instant\s*coffee|filter\s*coffee)\b", "Coffee", CATEGORY_COFFEE),

    # 9. Dry Fruits & Nuts
    (r"\b(?:almonds?|badam)\b", "Almonds", CATEGORY_DRY_FRUITS),
    (r"\b(?:cashews?|kaju)\b", "Cashews", CATEGORY_NUTS),
    (r"\b(?:raisins?|kismis|kishmish)\b", "Raisins", CATEGORY_DRY_FRUITS),
    (r"\b(?:walnuts?|akhrot)\b", "Walnuts", CATEGORY_NUTS),
    (r"\b(?:pistachios?|pista)\b", "Pistachios", CATEGORY_NUTS),
    (r"\b(?:dry\s*fruits?|dates|khajoor)\b", "Dry Fruits", CATEGORY_DRY_FRUITS),
    (r"\b(?:peanuts?|groundnuts?|singdana)\b", "Peanuts", CATEGORY_NUTS),

    # 10. Dairy Products
    (r"\b(?:milk|doodh|toned\s*milk|full\s*cream\s*milk)\b", "Milk", CATEGORY_DAIRY),
    (r"\b(?:paneer|cottage\s*cheese)\b", "Paneer", CATEGORY_DAIRY),
    (r"\b(?:butter|makhan)\b", "Butter", CATEGORY_DAIRY),
    (r"\b(?:cheese|cheese\s*slice|cheese\s*cube)\b", "Cheese", CATEGORY_DAIRY),
    (r"\b(?:curd|dahi|yogurt)\b", "Curd", CATEGORY_DAIRY),
    (r"\b(?:dairy|milk\s*powder|condensed\s*milk)\b", "Dairy Products", CATEGORY_DAIRY),

    # 11. General Personal & Household Essentials (Groceries store stock)
    (r"\b(?:soap|bath\s*soap|dettol|lifebuoy|lux|santoor|dove)\b", "Bath Soap", CATEGORY_OTHER_GROCERY),
    (r"\b(?:shampoo|conditioner|hair\s*oil)\b", "Hair Care", CATEGORY_OTHER_GROCERY),
    (r"\b(?:toothpaste|colgate|close\s*up|pepsodent|toothbrush)\b", "Oral Care", CATEGORY_OTHER_GROCERY),
    (r"\b(?:detergent|washing\s*powder|surf\s*excel|rin|ariel|tide)\b", "Detergent", CATEGORY_OTHER_GROCERY),
    (r"\b(?:dishwash|vim\s*bar|vim|pril)\b", "Dishwash", CATEGORY_OTHER_GROCERY),
    (r"\b(?:floor\s*cleaner|lizol|phenyl|harpic)\b", "Surface Cleaner", CATEGORY_OTHER_GROCERY),
    (r"\b(?:agarbatti|dhoop|incense)\b", "Pooja Essentials", CATEGORY_OTHER_GROCERY),
]

# Non-Grocery Patterns
NON_GROCERY_PATTERNS = [
    r"\b(?:freight|transport|shipping|delivery\s*charges?|labour|cartage|unloading|loading)\b",
    r"\b(?:stationery|pen|pencil|paper|notebook|stapler|toner|cartridge|folder|diary)\b",
    r"\b(?:hardware|cement|paint|pipe|wire|battery|bulb|led|plywood|nails?|hammer)\b",
    r"\b(?:plastic\s*crate|empty\s*box|wooden\s*pallet|trolley|gunny\s*bag\s*charge)\b",
    r"\b(?:service\s*charge|handling\s*charge|late\s*fee|interest\s*charge|penalty)\b",
    r"\b(?:engine\s*oil|motor\s*oil|lubricant|gear\s*oil|brake\s*fluid|coolant)\b",
    r"\b(?:cement|sand|brick|gravel|tiles?|sanitary)\b",
]

# Standard HSN Code Prefixes for Indian Grocery
GROCERY_HSN_PREFIXES: Dict[str, Tuple[str, str]] = {
    "1006": (CATEGORY_RICE, "Rice"),
    "1001": (CATEGORY_WHEAT, "Wheat"),
    "1101": (CATEGORY_ATTA, "Wheat Flour / Atta / Maida"),
    "1102": (CATEGORY_FLOURS, "Cereal Flours"),
    "1103": (CATEGORY_FLOURS, "Cereal Groats / Suji / Rava"),
    "0713": (CATEGORY_DAL_PULSES, "Dried Legumes / Pulses / Dal"),
    "1507": (CATEGORY_COOKING_OILS, "Soybean Oil"),
    "1508": (CATEGORY_COOKING_OILS, "Groundnut Oil"),
    "1511": (CATEGORY_COOKING_OILS, "Palm Oil"),
    "1512": (CATEGORY_COOKING_OILS, "Sunflower Oil"),
    "1514": (CATEGORY_COOKING_OILS, "Mustard / Rapeseed Oil"),
    "0405": (CATEGORY_COOKING_OILS, "Butter / Desi Ghee"),
    "0401": (CATEGORY_DAIRY, "Milk & Cream"),
    "0402": (CATEGORY_DAIRY, "Milk Powder"),
    "0406": (CATEGORY_DAIRY, "Cheese / Paneer"),
    "1701": (CATEGORY_SUGAR, "Sugar"),
    "2501": (CATEGORY_SALT, "Common Salt"),
    "0901": (CATEGORY_COFFEE, "Coffee"),
    "0902": (CATEGORY_TEA, "Tea"),
    "0904": (CATEGORY_SPICES, "Pepper / Chilli"),
    "0908": (CATEGORY_SPICES, "Nutmeg / Cardamom"),
    "0909": (CATEGORY_SPICES, "Cumin / Coriander / Fennel"),
    "0910": (CATEGORY_SPICES, "Ginger / Turmeric"),
    "1902": (CATEGORY_PACKAGED_FOODS, "Pasta / Noodles"),
    "1905": (CATEGORY_BISCUITS, "Biscuits / Bakery Products"),
    "0801": (CATEGORY_NUTS, "Coconuts / Cashews"),
    "0802": (CATEGORY_NUTS, "Almonds / Walnuts"),
    "0806": (CATEGORY_DRY_FRUITS, "Grapes / Raisins"),
    "3401": (CATEGORY_OTHER_GROCERY, "Soaps & Cleansing Products"),
    "3402": (CATEGORY_OTHER_GROCERY, "Detergents"),
}
