"""
Intelligence services for grocery taxonomy classification, brand recognition,
package size extraction, product normalization, AI assistance, and catalogue matching.
"""

from services.grocery_ocr.intelligence.ai_recognizer import (
    AIRecognitionResult,
    BaseAIProductRecognizer,
    IAIProductRecognizer,
)
from services.grocery_ocr.intelligence.brand_recognizer import (
    DEFAULT_BRAND_REGISTRY,
    BrandRecognizer,
)
from services.grocery_ocr.intelligence.grocery_classifier import (
    BaseGroceryClassifier,
    ClassificationResult,
    IGroceryClassifier,
)
from services.grocery_ocr.intelligence.package_size_extractor import (
    PackageSizeExtractor,
)
from services.grocery_ocr.intelligence.product_matcher import (
    BaseProductMatcher,
    IProductMatcher,
    ProductMatchResult,
)
from services.grocery_ocr.intelligence.product_normalizer import (
    ProductNormalizer,
)
from services.grocery_ocr.intelligence.taxonomy import (
    ALL_GROCERY_CATEGORIES,
    CATEGORY_ATTA,
    CATEGORY_BESAN,
    CATEGORY_BISCUITS,
    CATEGORY_CEREALS,
    CATEGORY_COFFEE,
    CATEGORY_COOKING_OILS,
    CATEGORY_DAL_PULSES,
    CATEGORY_DAIRY,
    CATEGORY_DRY_FRUITS,
    CATEGORY_FLOURS,
    CATEGORY_MAIDA,
    CATEGORY_NON_GROCERY,
    CATEGORY_NUTS,
    CATEGORY_OTHER_GROCERY,
    CATEGORY_PACKAGED_FOODS,
    CATEGORY_RICE,
    CATEGORY_SALT,
    CATEGORY_SPICES,
    CATEGORY_SUGAR,
    CATEGORY_TEA,
    CATEGORY_WHEAT,
    GROCERY_HSN_PREFIXES,
    GROCERY_TAXONOMY_ALIASES,
    NON_GROCERY_PATTERNS,
)

__all__ = [
    # Interfaces
    "IGroceryClassifier",
    "IProductMatcher",
    "IAIProductRecognizer",
    # Implementations
    "BaseGroceryClassifier",
    "BaseProductMatcher",
    "BaseAIProductRecognizer",
    "BrandRecognizer",
    "PackageSizeExtractor",
    "ProductNormalizer",
    # Results & Models
    "ClassificationResult",
    "ProductMatchResult",
    "AIRecognitionResult",
    # Taxonomy
    "ALL_GROCERY_CATEGORIES",
    "DEFAULT_BRAND_REGISTRY",
    "GROCERY_HSN_PREFIXES",
    "GROCERY_TAXONOMY_ALIASES",
    "NON_GROCERY_PATTERNS",
    "CATEGORY_RICE",
    "CATEGORY_WHEAT",
    "CATEGORY_ATTA",
    "CATEGORY_MAIDA",
    "CATEGORY_BESAN",
    "CATEGORY_DAL_PULSES",
    "CATEGORY_COOKING_OILS",
    "CATEGORY_SUGAR",
    "CATEGORY_SALT",
    "CATEGORY_SPICES",
    "CATEGORY_TEA",
    "CATEGORY_COFFEE",
    "CATEGORY_BISCUITS",
    "CATEGORY_PACKAGED_FOODS",
    "CATEGORY_DRY_FRUITS",
    "CATEGORY_NUTS",
    "CATEGORY_CEREALS",
    "CATEGORY_FLOURS",
    "CATEGORY_DAIRY",
    "CATEGORY_OTHER_GROCERY",
    "CATEGORY_NON_GROCERY",
]
