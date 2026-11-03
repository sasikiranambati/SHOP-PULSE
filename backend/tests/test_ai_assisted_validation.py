"""
Comprehensive V-Model Test Suite for Phase 8: AI-Assisted Extraction and Intelligent Validation.
Tests Scenarios A through N, critical financial protection rules, caching, and audit logging.
"""

from decimal import Decimal
import io
import os
import pytest
from PIL import Image

from services.grocery_ocr.ai.cache import ProductNormalizationCache
from services.grocery_ocr.ai.providers.mock_provider import MockAIProvider
from services.grocery_ocr.ai.schemas import (
    AIAuditEntry,
    AIProductSuggestionRequest,
    AIProductSuggestionResponse,
    AITelemetry,
)
from services.grocery_ocr.ai.service import AIInterpretationService
from services.grocery_ocr.config import GroceryOCRConfig
from services.grocery_ocr.engines.ocr_engine import MockOCREngine
from services.grocery_ocr.exceptions import (
    AIHallucinationSecurityViolation,
    AIProviderUnavailableError,
    AIRateLimitError,
    AIResponseValidationError,
    AITimeoutError,
)
from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline
from services.grocery_ocr.schemas.invoice import ExtractedInvoice, InvoiceProcessingMetadata
from services.grocery_ocr.schemas.invoice_item import ExtractedInvoiceItem, PackageSize
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRLine, OCRPageResult, OCRWord
from services.grocery_ocr.validation.cross_validator import UnifiedValidationService


# --------------------------------------------------------------------------
# Fixtures & Helpers
# --------------------------------------------------------------------------

@pytest.fixture
def mock_item():
    """Provides a baseline extracted item for validation."""
    return ExtractedInvoiceItem(
        item_id="item_test_01",
        raw_product_name="FORTUNE BESAAN 500GM",
        quantity=Decimal("10"),
        raw_quantity="10",
        unit="PCS",
        raw_unit="PCS",
        purchase_price=Decimal("45.00"),
        mrp=Decimal("55.00"),
        printed_amount=Decimal("450.00"),
        calculated_amount=Decimal("450.00"),
        ocr_confidence=88.0,
        name_confidence=60.0,
        classification_status="UNKNOWN_REVIEW_REQUIRED",
        raw_row_text="FORTUNE BESAAN 500GM 10 PCS 45.00 55.00 450.00",
        raw_cells={"product": "FORTUNE BESAAN 500GM", "qty": "10", "rate": "45.00", "total": "450.00"},
    )


# --------------------------------------------------------------------------
# Scenario A: Valid AI Response
# --------------------------------------------------------------------------

def test_scenario_a_valid_ai_response(mock_item):
    """Verifies that a valid AI response normalizes product title and brand without altering financials."""
    provider = MockAIProvider()
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(mock_item, invoice_id="inv_test_a")
    assert suggestion is not None
    assert suggestion.suggested_normalized_name == "Fortune Besan"
    assert suggestion.suggested_brand == "Fortune"
    assert suggestion.suggested_category == "Besan"
    assert suggestion.suggested_package_size == "500 GM"
    assert suggestion.confidence == 0.92

    # Apply to item
    updated_item = service.apply_to_item(mock_item, suggestion)
    assert updated_item.normalized_product_name == "Fortune Besan"
    assert updated_item.brand == "Fortune"
    assert updated_item.category == "Besan"
    assert updated_item.metadata.get("ai_assisted") is True

    # Financial invariants strictly maintained
    assert updated_item.quantity == Decimal("10")
    assert updated_item.purchase_price == Decimal("45.00")
    assert updated_item.printed_amount == Decimal("450.00")
    assert updated_item.calculated_amount == Decimal("450.00")


# --------------------------------------------------------------------------
# Scenario B: Invalid AI Response (Malformed JSON / Unparseable)
# --------------------------------------------------------------------------

def test_scenario_b_invalid_ai_response(mock_item):
    """Verifies that unparseable or corrupted AI output is safely caught and falls back to deterministic."""
    provider = MockAIProvider(simulate_invalid_json=True)
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(mock_item, invoice_id="inv_test_b")
    assert suggestion is None
    assert service.telemetry.failure_count == 1
    assert service.telemetry.fallback_count == 1
    assert len(service.audit_log) == 1
    assert service.audit_log[0].accepted is False
    assert "Validation error" in service.audit_log[0].rejection_reason


# --------------------------------------------------------------------------
# Scenario C: Missing Fields in AI Response
# --------------------------------------------------------------------------

def test_scenario_c_missing_fields_in_ai_response(mock_item):
    """Verifies that AI responses lacking required fields are rejected."""
    provider = MockAIProvider(simulate_missing_fields=True)
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(mock_item, invoice_id="inv_test_c")
    assert suggestion is None
    assert service.telemetry.failure_count == 1
    assert service.telemetry.fallback_count == 1


# --------------------------------------------------------------------------
# Scenario D: Unexpected Output Types
# --------------------------------------------------------------------------

def test_scenario_d_unexpected_output_types(mock_item):
    """Verifies that AI responses with invalid types (e.g. string for confidence) are rejected."""
    provider = MockAIProvider(simulate_unexpected_types=True)
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(mock_item, invoice_id="inv_test_d")
    assert suggestion is None
    assert service.telemetry.failure_count == 1


# --------------------------------------------------------------------------
# Scenario E: Hallucinated Numeric Values (Anti-Hallucination Guard)
# --------------------------------------------------------------------------

def test_scenario_e_hallucinated_numeric_values_rejected(mock_item):
    """
    CRITICAL: AI must NEVER supply or inject purchase prices, quantities, rates, or amounts.
    Attempts to inject financial numbers must raise validation error and be blocked.
    """
    provider = MockAIProvider(simulate_hallucinated_numerics=True)
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(mock_item, invoice_id="inv_test_e")
    # Must be None because validator strictly forbids financial fields
    assert suggestion is None
    assert service.telemetry.failure_count == 1


# --------------------------------------------------------------------------
# Scenario F: Ambiguous Product Descriptions
# --------------------------------------------------------------------------

def test_scenario_f_ambiguous_product_descriptions():
    """Verifies resolution of abbreviated / truncated descriptions (e.g. 'Ind Gate B-Rice 5kg')."""
    item = ExtractedInvoiceItem(
        item_id="item_f",
        raw_product_name="IND GATE B-RICE 5KG",
        quantity=Decimal("5"),
        purchase_price=Decimal("450.00"),
        printed_amount=Decimal("2250.00"),
        ocr_confidence=85.0,
        classification_status="UNKNOWN_REVIEW_REQUIRED",
    )

    provider = MockAIProvider()
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(item)
    assert suggestion is not None
    assert suggestion.suggested_normalized_name == "India Gate Basmati Rice"
    assert suggestion.suggested_brand == "India Gate"
    assert suggestion.suggested_category == "Rice"
    assert suggestion.suggested_package_size == "5 KG"


# --------------------------------------------------------------------------
# Scenario G: OCR Spelling Mistakes Correction
# --------------------------------------------------------------------------

def test_scenario_g_ocr_spelling_mistakes():
    """Verifies that heavily misspelled OCR titles ('Ttaa Slat 1kg') are intelligently corrected."""
    item = ExtractedInvoiceItem(
        item_id="item_g",
        raw_product_name="Ttaa Slat 1kg",
        quantity=Decimal("20"),
        purchase_price=Decimal("22.00"),
        printed_amount=Decimal("440.00"),
        ocr_confidence=65.0,
        classification_status="UNKNOWN_REVIEW_REQUIRED",
    )

    provider = MockAIProvider()
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(item)
    assert suggestion is not None
    assert suggestion.suggested_normalized_name == "Tata Salt 1kg"
    assert suggestion.suggested_brand == "Tata"
    assert suggestion.suggested_category == "Salt"

    updated = service.apply_to_item(item, suggestion)
    assert updated.normalized_product_name == "Tata Salt 1kg"
    assert updated.brand == "Tata"


# --------------------------------------------------------------------------
# Scenario H: Unknown Grocery Products Preserved
# --------------------------------------------------------------------------

def test_scenario_h_unknown_grocery_products_preserved():
    """Verifies that novel or exotic grocery items are preserved with REVIEW_REQUIRED, never discarded."""
    item = ExtractedInvoiceItem(
        item_id="item_h",
        raw_product_name="AMLA CANDY 250G",
        quantity=Decimal("12"),
        purchase_price=Decimal("60.00"),
        printed_amount=Decimal("720.00"),
        ocr_confidence=80.0,
        classification_status="UNKNOWN_REVIEW_REQUIRED",
    )

    provider = MockAIProvider()
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(item)
    assert suggestion is not None
    assert suggestion.suggested_normalized_name == "Amla Candy"
    assert suggestion.requires_review is True  # Flags review for unfamiliar product

    updated = service.apply_to_item(item, suggestion)
    assert updated.raw_product_name == "AMLA CANDY 250G"
    assert updated.normalized_product_name == "Amla Candy"
    assert updated.validation_status == "REVIEW_REQUIRED"
    assert updated.quantity == Decimal("12")


# --------------------------------------------------------------------------
# Scenario I: Provider Timeout Handling
# --------------------------------------------------------------------------

def test_scenario_i_provider_timeout_handling(mock_item):
    """Verifies that when AI provider times out, pipeline catches error cleanly and falls back."""
    provider = MockAIProvider(simulate_timeout=True)
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(mock_item, invoice_id="inv_test_i")
    assert suggestion is None
    assert service.telemetry.failure_count == 1
    assert service.telemetry.fallback_count == 1
    assert "Timeout" in service.audit_log[0].rejection_reason


# --------------------------------------------------------------------------
# Scenario J: API Rate Limits Handling (HTTP 429)
# --------------------------------------------------------------------------

def test_scenario_j_api_rate_limits_handling(mock_item):
    """Verifies that HTTP 429 rate limit is handled gracefully with deterministic fallback."""
    provider = MockAIProvider(simulate_rate_limit=True)
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(mock_item, invoice_id="inv_test_j")
    assert suggestion is None
    assert service.telemetry.failure_count == 1
    assert "Rate limit" in service.audit_log[0].rejection_reason


# --------------------------------------------------------------------------
# Scenario K: AI Provider Unavailable (HTTP 503)
# --------------------------------------------------------------------------

def test_scenario_k_ai_provider_unavailable(mock_item):
    """Verifies that provider outage does not crash processing and initiates immediate fallback."""
    provider = MockAIProvider(simulate_unavailable=True)
    service = AIInterpretationService(provider=provider)

    suggestion = service.interpret_product(mock_item, invoice_id="inv_test_k")
    assert suggestion is None
    assert service.telemetry.failure_count == 1
    assert "unavailable" in service.audit_log[0].rejection_reason.lower()


# --------------------------------------------------------------------------
# Scenario L: Deterministic Fallback Mode
# --------------------------------------------------------------------------

def test_scenario_l_deterministic_fallback():
    """Verifies complete end-to-end invoice extraction succeeds when AI is disabled or unavailable."""
    cfg = GroceryOCRConfig(enable_ai_assistant=False)
    pipeline = InvoicePipeline(config=cfg)

    # Valid PNG image bytes
    img = Image.new("RGB", (600, 400), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    header_words = [
        OCRWord(text="ITEM", confidence=99.0, bbox=BoundingBox(x0=50, y0=50, x1=150, y1=70)),
        OCRWord(text="QTY", confidence=99.0, bbox=BoundingBox(x0=200, y0=50, x1=250, y1=70)),
        OCRWord(text="RATE", confidence=99.0, bbox=BoundingBox(x0=300, y0=50, x1=350, y1=70)),
        OCRWord(text="AMOUNT", confidence=99.0, bbox=BoundingBox(x0=400, y0=50, x1=480, y1=70)),
    ]
    data_words = [
        OCRWord(text="TATA SALT 1KG", confidence=98.0, bbox=BoundingBox(x0=50, y0=100, x1=180, y1=120)),
        OCRWord(text="10", confidence=98.0, bbox=BoundingBox(x0=200, y0=100, x1=230, y1=120)),
        OCRWord(text="22.00", confidence=98.0, bbox=BoundingBox(x0=300, y0=100, x1=350, y1=120)),
        OCRWord(text="220.00", confidence=98.0, bbox=BoundingBox(x0=400, y0=100, x1=470, y1=120)),
    ]

    mock_page = OCRPageResult(
        page_number=1,
        width=600,
        height=400,
        words=header_words + data_words,
        lines=[
            OCRLine(line_number=1, text="ITEM QTY RATE AMOUNT", words=header_words, bbox=BoundingBox(x0=50, y0=50, x1=480, y1=70)),
            OCRLine(line_number=2, text="TATA SALT 1KG 10 22.00 220.00", words=data_words, bbox=BoundingBox(x0=50, y0=100, x1=470, y1=120)),
        ]
    )

    mock_engine = MockOCREngine(predefined_result=mock_page)
    pipeline = InvoicePipeline(ocr_engine=mock_engine, config=cfg)
    result = pipeline.process(png_bytes, "fallback_test.png")

    assert result.status in ("SUCCESS", "NEEDS_REVIEW")
    assert len(result.items) == 1
    assert result.items[0].raw_product_name == "TATA SALT 1KG"
    assert result.items[0].quantity == Decimal("10")
    assert result.items[0].purchase_price == Decimal("22.00")
    assert result.items[0].calculated_amount == Decimal("220.00")


# --------------------------------------------------------------------------
# Scenario M: Critical Financial Field Protection Invariants
# --------------------------------------------------------------------------

def test_scenario_m1_ai_cannot_invent_missing_mrp():
    """TEST M1: AI suggestion cannot invent or assign a missing MRP."""
    item = ExtractedInvoiceItem(
        item_id="item_m1",
        raw_product_name="CHANA 50 KG",
        quantity=Decimal("1"),
        unit="BOR",
        purchase_price=Decimal("2760.00"),
        mrp=None,  # Missing MRP
        printed_amount=Decimal("2760.00"),
    )

    service = AIInterpretationService()
    suggestion = AIProductSuggestionResponse(
        original_description="CHANA 50 KG",
        suggested_normalized_name="Chana",
        suggested_brand=None,
        suggested_category="Dal and pulses",
        suggested_package_size="50 KG",
        confidence=0.90,
        reason="Normalized Chana",
    )

    updated = service.apply_to_item(item, suggestion)
    assert updated.mrp is None, "CRITICAL: Missing MRP must remain None, never invented!"


def test_scenario_m2_ai_cannot_overwrite_verified_purchase_price():
    """TEST M2: AI cannot overwrite a verified purchase rate."""
    item = ExtractedInvoiceItem(
        item_id="item_m2",
        raw_product_name="FORTUNE SUNFLOWER OIL 1L",
        quantity=Decimal("15"),
        purchase_price=Decimal("135.00"),
        printed_amount=Decimal("2025.00"),
    )

    service = AIInterpretationService()
    suggestion = AIProductSuggestionResponse(
        original_description="FORTUNE SUNFLOWER OIL 1L",
        suggested_normalized_name="Fortune Sunflower Oil",
        suggested_brand="Fortune",
        suggested_category="Cooking oils",
        suggested_package_size="1 L",
        confidence=0.95,
        reason="Matched brand Fortune",
    )

    updated = service.apply_to_item(item, suggestion)
    assert updated.purchase_price == Decimal("135.00"), "CRITICAL: Purchase price cannot be altered!"


def test_scenario_m3_ai_cannot_change_invoice_quantity():
    """TEST M3: AI cannot change invoice quantity without verified evidence."""
    item = ExtractedInvoiceItem(
        item_id="item_m3",
        raw_product_name="AASHIRVAAD ATTA 10KG",
        quantity=Decimal("4"),
        unit="BAG",
        purchase_price=Decimal("420.00"),
        printed_amount=Decimal("1680.00"),
    )

    service = AIInterpretationService()
    suggestion = AIProductSuggestionResponse(
        original_description="AASHIRVAAD ATTA 10KG",
        suggested_normalized_name="Aashirvaad Whole Wheat Atta",
        suggested_brand="Aashirvaad",
        suggested_category="Atta",
        suggested_package_size="10 KG",
        confidence=0.94,
        reason="Normalized Aashirvaad Atta",
    )

    updated = service.apply_to_item(item, suggestion)
    assert updated.quantity == Decimal("4"), "CRITICAL: Invoice quantity cannot be altered!"


# --------------------------------------------------------------------------
# Scenario N: Excel Integrity After AI-Assisted Validation
# --------------------------------------------------------------------------

def test_scenario_n_excel_integrity_after_ai_assisted_validation():
    """Verifies that an invoice with AI-assisted items successfully undergoes Excel roundtrip and passes integrity."""
    img = Image.new("RGB", (800, 600), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    header_words = [
        OCRWord(text="ITEM", confidence=99.0, bbox=BoundingBox(x0=50, y0=50, x1=150, y1=70)),
        OCRWord(text="QTY", confidence=99.0, bbox=BoundingBox(x0=200, y0=50, x1=250, y1=70)),
        OCRWord(text="RATE", confidence=99.0, bbox=BoundingBox(x0=300, y0=50, x1=350, y1=70)),
        OCRWord(text="AMOUNT", confidence=99.0, bbox=BoundingBox(x0=400, y0=50, x1=480, y1=70)),
    ]
    # Intentionally messy description: "FORTUNE BESAAN 500GM" to trigger AI assistance
    data_words = [
        OCRWord(text="FORTUNE BESAAN 500GM", confidence=80.0, bbox=BoundingBox(x0=50, y0=100, x1=220, y1=120)),
        OCRWord(text="10", confidence=98.0, bbox=BoundingBox(x0=200, y0=100, x1=230, y1=120)),
        OCRWord(text="45.00", confidence=98.0, bbox=BoundingBox(x0=300, y0=100, x1=350, y1=120)),
        OCRWord(text="450.00", confidence=98.0, bbox=BoundingBox(x0=400, y0=100, x1=480, y1=120)),
    ]

    mock_page = OCRPageResult(
        page_number=1,
        width=800,
        height=600,
        words=header_words + data_words,
        lines=[
            OCRLine(line_number=1, text="ITEM QTY RATE AMOUNT", words=header_words, bbox=BoundingBox(x0=50, y0=50, x1=480, y1=70)),
            OCRLine(line_number=2, text="FORTUNE BESAAN 500GM 10 45.00 450.00", words=data_words, bbox=BoundingBox(x0=50, y0=100, x1=480, y1=120)),
        ]
    )

    mock_engine = MockOCREngine(predefined_result=mock_page)
    pipeline = InvoicePipeline(ocr_engine=mock_engine)
    result = pipeline.process(png_bytes, "ai_excel_test.png")

    assert result.status in ("SUCCESS", "NEEDS_REVIEW")
    assert len(result.items) == 1
    item = result.items[0]
    # Check AI normalization applied
    assert item.normalized_product_name == "Fortune Besan"
    assert item.brand == "Fortune"

    # Check Excel-first integrity
    props = result.metadata.custom_properties
    assert "excel_integrity_report" in props
    assert props["excel_integrity_report"]["is_intact"] is True
    assert props["excel_integrity_report"]["post_excel_item_count"] == 1
    assert "ai_telemetry" in props
    assert "ai_audit_log" in props


# --------------------------------------------------------------------------
# Caching & Telemetry Verification
# --------------------------------------------------------------------------

def test_ai_cache_prevents_duplicate_calls(mock_item):
    """Verifies that subsequent requests for identical descriptions hit cache with 0ms overhead."""
    cache = ProductNormalizationCache(max_size=100)
    provider = MockAIProvider()
    service = AIInterpretationService(provider=provider, cache=cache)

    # First call: cache miss, provider invoked
    res1 = service.interpret_product(mock_item, invoice_id="inv_1")
    assert res1 is not None
    assert service.telemetry.request_count == 1
    assert service.telemetry.cache_hit_count == 0

    # Second call: cache hit, provider skipped
    res2 = service.interpret_product(mock_item, invoice_id="inv_2")
    assert res2 is not None
    assert service.telemetry.request_count == 2
    assert service.telemetry.cache_hit_count == 1
    assert len(cache) == 1

