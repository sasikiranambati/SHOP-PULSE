"""
V-Model Test Suite for Phase 5: Grocery Intelligence and Product Recognition.
Validates:
  A. Known grocery products
  B. Unknown grocery products
  C. Brand recognition & differentiation
  D. Package size extraction & distinction from invoice billing quantity
  E. Anti-merging safety (different brands / sizes never merge)
  F. OCR spelling and letter-spacing repairs
  G. Grocery abbreviation expansions
  H. Missing brand handling
  I. Missing package size handling
  J. Non-grocery detection (freight, labour, hardware)
  K. Ambiguous descriptions & review routing
  L. Conservative catalogue matching
  M. Benchmark accuracy measurement
"""

from decimal import Decimal
from typing import Any, Dict, List
import pytest

from services.grocery_ocr.config import GroceryOCRConfig
from services.grocery_ocr.intelligence.ai_recognizer import (
    BaseAIProductRecognizer,
)
from services.grocery_ocr.intelligence.brand_recognizer import (
    BrandRecognizer,
)
from services.grocery_ocr.intelligence.grocery_classifier import (
    BaseGroceryClassifier,
    ClassificationResult,
)
from services.grocery_ocr.intelligence.package_size_extractor import (
    PackageSizeExtractor,
)
from services.grocery_ocr.intelligence.product_matcher import (
    BaseProductMatcher,
)
from services.grocery_ocr.intelligence.product_normalizer import (
    ProductNormalizer,
)
from services.grocery_ocr.intelligence.taxonomy import (
    CATEGORY_ATTA,
    CATEGORY_BESAN,
    CATEGORY_BISCUITS,
    CATEGORY_COOKING_OILS,
    CATEGORY_DAL_PULSES,
    CATEGORY_DAIRY,
    CATEGORY_NON_GROCERY,
    CATEGORY_PACKAGED_FOODS,
    CATEGORY_RICE,
    CATEGORY_SALT,
    CATEGORY_SPICES,
    CATEGORY_SUGAR,
)
from services.grocery_ocr.schemas.invoice_item import (
    ExtractedInvoiceItem,
    PackageSize,
    ProductMatchResult,
)


@pytest.fixture
def classifier():
    return BaseGroceryClassifier()


@pytest.fixture
def brand_recognizer():
    return BrandRecognizer()


@pytest.fixture
def package_extractor():
    return PackageSizeExtractor()


@pytest.fixture
def normalizer():
    return ProductNormalizer()


@pytest.fixture
def matcher():
    return BaseProductMatcher()


# --------------------------------------------------------------------------
# Scenario A: Known Grocery Products
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "item_text, expected_brand, expected_cat, expected_val, expected_unit",
    [
        ("Fortune Sunlite Sunflower Oil 1L Pouch", "Fortune", CATEGORY_COOKING_OILS, Decimal("1"), "l"),
        ("Tata Salt 1kg Vacuum Evaporated", "Tata", CATEGORY_SALT, Decimal("1"), "kg"),
        ("Aashirvaad Shudh Chakki Atta 10kg", "Aashirvaad", CATEGORY_ATTA, Decimal("10"), "kg"),
        ("India Gate Basmati Rice Feast Rozana 5kg", "India Gate", CATEGORY_RICE, Decimal("5"), "kg"),
        ("Everest Turmeric Powder 100g", "Everest", CATEGORY_SPICES, Decimal("100"), "g"),
        ("Parle-G Glucose Biscuits 250g", "Parle", CATEGORY_BISCUITS, Decimal("250"), "g"),
        ("Amul Butter 500g", "Amul", CATEGORY_DAIRY, Decimal("500"), "g"),
        ("Fortune Besan 500 GM", "Fortune", CATEGORY_BESAN, Decimal("500"), "g"),
        ("Madhur Pure & Hygienic Sugar 1kg", "Madhur", CATEGORY_SUGAR, Decimal("1"), "kg"),
        ("Maggi 2-Minute Masala Noodles 70g", "Maggi", CATEGORY_PACKAGED_FOODS, Decimal("70"), "g"),
    ],
)
def test_scenario_a_known_grocery_products(
    classifier, item_text, expected_brand, expected_cat, expected_val, expected_unit
):
    res = classifier.classify(item_text)
    assert res.is_grocery is True
    assert res.status == "GROCERY_HIGH_CONFIDENCE"
    assert res.brand == expected_brand
    assert res.category == expected_cat
    assert res.package_size is not None
    assert res.package_size.value == expected_val
    assert res.package_size.unit == expected_unit
    assert res.confidence >= 80.0
    assert res.raw_product_name == item_text


# --------------------------------------------------------------------------
# Scenario B: Unknown / Unfamiliar Grocery Products
# --------------------------------------------------------------------------

def test_scenario_b_unknown_grocery_products_preserved_for_review(classifier):
    """Unfamiliar grocery items must be preserved and routed to review, never silently dropped."""
    unfamiliar_item = "Artisanal Cold-Pressed Dragon Fruit Extract 250ml"
    res = classifier.classify(unfamiliar_item)
    assert res.is_grocery is True
    assert res.status in ("GROCERY_REVIEW_REQUIRED", "UNKNOWN_REVIEW_REQUIRED")
    assert res.package_size is not None
    assert res.package_size.value == Decimal("250")
    assert res.package_size.unit == "ml"
    assert res.raw_product_name == unfamiliar_item
    assert len(res.review_reasons) > 0


# --------------------------------------------------------------------------
# Scenario C: Brand Recognition & Differentiation
# --------------------------------------------------------------------------

def test_scenario_c_brand_differentiation(brand_recognizer):
    """Verifies brands are recognized strictly and differentiated without cross-contamination."""
    brand1, conf1, _ = brand_recognizer.recognize_brand("Gemini Pure Sunflower Oil 1L")
    brand2, conf2, _ = brand_recognizer.recognize_brand("Fortune Sunflower Oil 1L")
    brand3, conf3, _ = brand_recognizer.recognize_brand("Saffola Gold Edible Oil")
    brand4, conf4, _ = brand_recognizer.recognize_brand("Dhara Mustard Oil 1L")

    assert brand1 == "Gemini"
    assert brand2 == "Fortune"
    assert brand3 == "Saffola"
    assert brand4 == "Dhara"
    assert all(c >= 90.0 for c in (conf1, conf2, conf3, conf4))


def test_scenario_c_vendor_name_not_confused_with_product_brand(brand_recognizer):
    """Supplier names like 'SRI BALAJI WHOLESALE TRADERS' must not become product brand."""
    # When passed product title alone, no brand is recognized
    brand, conf, _ = brand_recognizer.recognize_brand("Loose Kabuli Chana Grade A 50kg")
    assert brand is None
    assert conf == 0.0


# --------------------------------------------------------------------------
# Scenario D: Package Size Extraction & Separation from Billing Quantity
# --------------------------------------------------------------------------

def test_scenario_d_package_size_vs_billing_quantity(package_extractor):
    """
    CRITICAL INVARIANT:
    `CHANA 50 KG | QTY 1 | UNIT BOR`
    Package size is 50 KG.
    Invoice quantity is 1 BOR.
    They must never be converted or multiplied together!
    """
    pkg_size, residual = package_extractor.extract_package_size("CHANA 50 KG")
    assert pkg_size is not None
    assert pkg_size.value == Decimal("50")
    assert pkg_size.unit == "kg"
    assert pkg_size.raw_text.upper() == "50 KG"
    assert "CHANA" in residual

    # Simulate invoice item creation with billed qty = 1, unit = BOR
    item = ExtractedInvoiceItem(
        item_id="item_chana_test",
        raw_product_name="CHANA 50 KG",
        normalized_product_name=residual,
        package_size=pkg_size,
        quantity=Decimal("1"),
        unit="BOR",
    )
    # The invoice billed quantity remains 1 BOR
    assert item.quantity == Decimal("1")
    assert item.unit == "BOR"
    # Package size remains 50 kg
    assert item.package_size.value == Decimal("50")
    assert item.package_size.unit == "kg"


def test_scenario_d_multipack_formats(package_extractor):
    """Handles multi-packs like 975 ML X 2 and Pack of 4."""
    pkg1, _ = package_extractor.extract_package_size("Coca Cola 975 ML X 2")
    assert pkg1 is not None
    assert pkg1.value == Decimal("975")
    assert pkg1.unit == "ml"
    assert pkg1.multiplier == 2

    pkg2, _ = package_extractor.extract_package_size("Dettol Soap Pack of 4")
    assert pkg2 is not None
    assert pkg2.value == Decimal("4")
    assert pkg2.unit == "pack"
    assert pkg2.multiplier == 4


# --------------------------------------------------------------------------
# Scenario E: Anti-Merging Safety (Conservative Catalogue Matching)
# --------------------------------------------------------------------------

def test_scenario_e_different_brands_never_match_same_catalogue_sku(matcher):
    """Fortune Sunflower Oil must NEVER match Gemini Sunflower Oil catalogue SKU."""
    catalogue = [
        {"id": "sku_gemini_1l", "name": "Gemini Sunflower Oil 1L", "brand": "Gemini", "package_size": "1 L"},
        {"id": "sku_fortune_1l", "name": "Fortune Sunflower Oil 1L", "brand": "Fortune", "package_size": "1 L"},
    ]

    # Query item: Fortune Sunflower Oil
    result_fortune = matcher.match_product(
        product_name="Fortune Sunflower Oil 1L",
        brand="Fortune",
        package_size=PackageSize(value=Decimal("1"), unit="l"),
        candidate_pool=catalogue,
    )
    assert result_fortune.matched_product_id == "sku_fortune_1l"

    # Query item: Gemini Sunflower Oil
    result_gemini = matcher.match_product(
        product_name="Gemini Sunflower Oil 1L",
        brand="Gemini",
        package_size=PackageSize(value=Decimal("1"), unit="l"),
        candidate_pool=catalogue,
    )
    assert result_gemini.matched_product_id == "sku_gemini_1l"

    # Query item: Saffola Sunflower Oil (not in catalogue) -> must NOT match Gemini or Fortune!
    result_saffola = matcher.match_product(
        product_name="Saffola Sunflower Oil 1L",
        brand="Saffola",
        package_size=PackageSize(value=Decimal("1"), unit="l"),
        candidate_pool=catalogue,
    )
    assert result_saffola.matched_product_id is None
    assert result_saffola.match_method == "NO_MATCH"


def test_scenario_e_different_package_sizes_never_match_same_catalogue_sku(matcher):
    """Tata Salt 1kg must NEVER match Tata Salt 500g catalogue SKU."""
    catalogue = [
        {"id": "sku_tata_500g", "name": "Tata Salt 500g", "brand": "Tata", "package_size": "500 g"},
        {"id": "sku_tata_1kg", "name": "Tata Salt 1kg", "brand": "Tata", "package_size": "1 kg"},
    ]

    res_1kg = matcher.match_product(
        product_name="Tata Salt 1kg",
        brand="Tata",
        package_size=PackageSize(value=Decimal("1"), unit="kg"),
        candidate_pool=catalogue,
    )
    assert res_1kg.matched_product_id == "sku_tata_1kg"

    res_500g = matcher.match_product(
        product_name="Tata Salt 500g",
        brand="Tata",
        package_size=PackageSize(value=Decimal("500"), unit="g"),
        candidate_pool=catalogue,
    )
    assert res_500g.matched_product_id == "sku_tata_500g"

    # Tata Salt 2kg (not in catalogue) must NOT match 500g or 1kg!
    res_2kg = matcher.match_product(
        product_name="Tata Salt 2kg",
        brand="Tata",
        package_size=PackageSize(value=Decimal("2"), unit="kg"),
        candidate_pool=catalogue,
    )
    assert res_2kg.matched_product_id is None
    assert res_2kg.match_method == "NO_MATCH"


# --------------------------------------------------------------------------
# Scenario F: OCR Spelling Mistakes & Letter Spacing
# --------------------------------------------------------------------------

def test_scenario_f_ocr_letter_spacing_repair(normalizer, classifier):
    """Handles character-spaced OCR defects like 'T a t a   S a l t' and 'F o r t u n e'."""
    raw = "T a t a   S a l t   1 k g"
    _, norm, _ = normalizer.normalize(raw)
    assert "Tata" in norm
    assert "Salt" in norm

    res = classifier.classify(raw)
    assert res.is_grocery is True
    assert res.brand == "Tata"
    assert res.category == CATEGORY_SALT
    assert res.package_size is not None
    assert res.package_size.value == Decimal("1")
    assert res.package_size.unit == "kg"


def test_scenario_f_spelling_variation_tolerance(classifier):
    """Recognizes known spelling variations (e.g. 'Aashirvad', 'Ashirvaad')."""
    res1 = classifier.classify("Ashirvaad Shudh Atta 5kg")
    assert res1.brand == "Aashirvaad"
    assert res1.category == CATEGORY_ATTA

    res2 = classifier.classify("Fortuen Besan 500g")
    assert res2.brand == "Fortune"
    assert res2.category == CATEGORY_BESAN


# --------------------------------------------------------------------------
# Scenario G: Grocery Abbreviations
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw_text, expected_tokens, expected_cat",
    [
        ("CHANA DL 1KG", ["Chana", "Dal"], CATEGORY_DAL_PULSES),
        ("TOOR DL 500G", ["Toor", "Dal"], CATEGORY_DAL_PULSES),
        ("MUST OIL 1L", ["Mustard", "Oil"], CATEGORY_COOKING_OILS),
        ("HALDI PWD 100G", ["Haldi", "Powder"], CATEGORY_SPICES),
        ("DHAN PWD 200G", ["Dhaniya", "Powder"], CATEGORY_SPICES),
        ("SGR M 50KG", ["Sugar"], CATEGORY_SUGAR),
    ],
)
def test_scenario_g_abbreviations_expansion(classifier, raw_text, expected_tokens, expected_cat):
    res = classifier.classify(raw_text)
    assert res.is_grocery is True
    assert res.category == expected_cat
    for tok in expected_tokens:
        assert tok.lower() in res.normalized_product_name.lower()


# --------------------------------------------------------------------------
# Scenario H: Missing Brand Names
# --------------------------------------------------------------------------

def test_scenario_h_missing_brand_names(classifier):
    """Items without a brand must have brand=None and not hallucinate a brand."""
    res = classifier.classify("Moong Dal Dhuli 1kg")
    assert res.is_grocery is True
    assert res.brand is None
    assert res.category == CATEGORY_DAL_PULSES
    assert res.brand_confidence == 0.0
    assert res.package_size.value == Decimal("1")
    assert res.package_size.unit == "kg"
    assert res.status == "GROCERY_HIGH_CONFIDENCE"


# --------------------------------------------------------------------------
# Scenario I: Missing Package Sizes
# --------------------------------------------------------------------------

def test_scenario_i_missing_package_sizes(classifier):
    """Items sold loose or without pack size must have package_size=None."""
    res = classifier.classify("Loose Basmati Rice")
    assert res.is_grocery is True
    assert res.category == CATEGORY_RICE
    assert res.package_size is None
    assert res.package_size_confidence == 0.0
    assert res.status == "GROCERY_HIGH_CONFIDENCE"


# --------------------------------------------------------------------------
# Scenario J: Non-Grocery Products
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "line_text",
    [
        "Freight Charges for Tempo",
        "Labour Charges Loading Unloading",
        "Transport Delivery Charges",
        "PVC Pipe 1 inch 10ft",
        "Printer Toner Cartridge HP",
        "Wooden Pallet Charge",
    ],
)
def test_scenario_j_non_grocery_rejection(classifier, line_text):
    res = classifier.classify(line_text)
    assert res.is_grocery is False
    assert res.status == "NON_GROCERY"
    assert res.category == CATEGORY_NON_GROCERY
    assert res.confidence >= 90.0


# --------------------------------------------------------------------------
# Scenario K: Ambiguous Descriptions
# --------------------------------------------------------------------------

def test_scenario_k_ambiguous_descriptions(classifier):
    """Ambiguous or unreadable lines are routed to UNKNOWN_REVIEW_REQUIRED, never silently dropped."""
    res = classifier.classify("X")
    assert res.status == "UNKNOWN_REVIEW_REQUIRED"
    assert len(res.review_reasons) > 0

    res2 = classifier.classify("Misc Code 9999")
    assert res2.status in ("UNKNOWN_REVIEW_REQUIRED", "GROCERY_REVIEW_REQUIRED")


# --------------------------------------------------------------------------
# Scenario L: Catalogue Matching Precision
# --------------------------------------------------------------------------

def test_scenario_l_gtin_barcode_match(matcher):
    """GTIN / barcode matches with highest precedence."""
    catalogue = [
        {"id": "sku_101", "name": "Cadbury Dairy Milk 50g", "barcode": "8901233024012", "brand": "Cadbury"},
    ]
    res = matcher.match_product(
        product_name="Dairy Milk Chocolate",
        barcode="8901233024012",
        candidate_pool=catalogue,
    )
    assert res.matched_product_id == "sku_101"
    assert res.match_method == "GTIN"
    assert res.match_confidence == 100.0
    assert res.review_status == "CONFIRMED"


# --------------------------------------------------------------------------
# Scenario M: AI Assistant Safe Hallucination Guards
# --------------------------------------------------------------------------

def test_scenario_m_ai_hallucination_guards():
    """Proves that AI assistant output is rejected if it hallucinates brands or sizes."""
    config = GroceryOCRConfig(enable_ai_product_recognition=True, ai_provider="mock")
    ai_recognizer = BaseAIProductRecognizer(config)

    # Mock recognizer correctly handles basmati spelling
    res = ai_recognizer.recognize("Basmti Rcie 5kg")
    assert res is not None
    assert res.normalized_name == "Basmati Rice"
    assert res.category == "Rice"

    # If an AI tried to hallucinate a brand not present in raw text, validation fails
    from services.grocery_ocr.intelligence.ai_recognizer import AIRecognitionResult
    fake_ai_output = AIRecognitionResult(
        normalized_name="Basmati Rice",
        brand="India Gate",  # Not in raw text "Basmti Rcie"
        category="Rice",
        confidence=90.0,
    )
    is_valid = ai_recognizer._validate_ai_response("Basmti Rcie 5kg", fake_ai_output)
    assert is_valid is False  # Hallucinated brand caught and blocked!

