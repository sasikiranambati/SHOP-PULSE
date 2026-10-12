"""
Deterministic unit and integration tests for the Hybrid Invoice Extraction & Verification Engine.
Tests:
- Packaging separation (Fortune 500 GM, Godrej White 240 GM)
- Independent cross-verification (corroboration vs engine disagreement)
- Arithmetic validation (exact, rounding, discounts, GST, mismatches)
- Missing rates and incomplete rows (NEEDS_REVIEW / INSUFFICIENT_DATA)
- Real rendered invoice image fixtures
"""

import io
import pytest
from PIL import Image, ImageDraw

from services.hybrid_extractor import (
    extract_pack_size,
    validate_arithmetic_strict,
    reconcile_hybrid_extraction,
)
from services.invoice_table import extract_table, rows_from_text


def test_extract_pack_size_variations():
    # 500 GM -> 500.0, 'g'
    sz, unit = extract_pack_size("FORTUNE 500 GM")
    assert sz == 500.0
    assert unit == "g"

    # 240 GM -> 240.0, 'g'
    sz, unit = extract_pack_size("Godrej White 240 GM")
    assert sz == 240.0
    assert unit == "g"

    # 1 Ltr -> 1.0, 'l'
    sz, unit = extract_pack_size("Amul Taaza Milk 1 Ltr")
    assert sz == 1.0
    assert unit == "l"

    # 5 kg -> 5.0, 'kg'
    sz, unit = extract_pack_size("Aashirvaad Atta 5kg")
    assert sz == 5.0
    assert unit == "kg"

    # No pack size in title
    sz, unit = extract_pack_size("Dettol Original Soap")
    assert sz is None
    assert unit is None


def test_arithmetic_validation_strict():
    # Exact match
    status, issues = validate_arithmetic_strict(20.0, 70.0, 1400.0)
    assert status == "EXACT_MATCH"
    assert issues == []

    # Match with discount: 20 * 70 = 1400 - 100 = 1300
    status, issues = validate_arithmetic_strict(20.0, 70.0, 1300.0, discount=100.0)
    assert status == "EXACT_MATCH"
    assert issues == []

    # Match with GST: 10 * 100 = 1000 + 18% = 1180
    status, issues = validate_arithmetic_strict(10.0, 100.0, 1180.0, gst_rate=18.0)
    assert status == "EXACT_MATCH"
    assert issues == []

    # Mismatch
    status, issues = validate_arithmetic_strict(20.0, 70.0, 1550.0)
    assert status == "MISMATCH"
    assert len(issues) == 1
    assert "Arithmetic discrepancy" in issues[0]

    # Insufficient data (missing rate)
    status, issues = validate_arithmetic_strict(20.0, None, 1400.0)
    assert status == "INSUFFICIENT_DATA"
    assert any("rate" in i.lower() for i in issues)


def test_packaging_separation_fortune_500_gm():
    """
    FORTUNE 500 GM | 20 | 70 | 1400
    Result must separate purchased quantity (20) from pack size (500 g).
    The billing unit must NOT be assigned 'g' just because title contains 500 GM.
    """
    ocr_items = [{
        "product_name": "FORTUNE 500 GM",
        "quantity": 20.0,
        "unit": "gm",  # OCR mistakenly captured pack unit as row unit
        "purchase_price": 70.0,
        "line_total": 1400.0,
        "confidence": 92.0,
        "source_text": "FORTUNE 500 GM | 20 | 70 | 1400",
    }]
    ocr_meta = {"invoice_total": 1400.0}

    reconciled = reconcile_hybrid_extraction(None, ocr_items, ocr_meta)
    assert len(reconciled["items"]) == 1
    item = reconciled["items"][0]

    assert item["product_name"] == "FORTUNE 500 GM"
    assert item["purchased_quantity"] == 20.0
    assert item["pack_size"] == 500.0
    assert item["pack_size_unit"] == "g"
    # purchase_unit must NOT be 'g' or 'gm'
    assert item["purchase_unit"] is None
    assert item["unit_rate"] == 70.0
    assert item["line_total"] == 1400.0
    assert any("not established" in r.lower() for r in item["review_reasons"])


def test_independent_verification_agreement_boosts_confidence():
    """When Vision and OCR independently agree, confidence is boosted."""
    vision_data = {
        "items": [{
            "product_name": "Tata Salt 1kg",
            "purchased_quantity": 24,
            "purchase_unit": "pcs",
            "pack_size": 1,
            "pack_size_unit": "kg",
            "unit_rate": 22.0,
            "line_total": 528.0,
            "confidence": 88.0,
        }],
        "grand_total": 528.0,
    }
    ocr_items = [{
        "product_name": "Tata Salt 1kg",
        "quantity": 24.0,
        "purchase_price": 22.0,
        "line_total": 528.0,
        "confidence": 85.0,
    }]
    ocr_meta = {"invoice_total": 528.0}

    reconciled = reconcile_hybrid_extraction(vision_data, ocr_items, ocr_meta)
    item = reconciled["items"][0]

    assert item["corroborated"] is True
    assert item["confidence"] >= 95.0
    assert item["validation_status"] in ("EXACT_MATCH", "MATCH_WITH_ROUNDING")
    assert item["engine_disagreements"] == []


def test_independent_verification_disagreement_flags_review():
    """When Vision and OCR disagree on quantity, it flags review rather than guessing."""
    vision_data = {
        "items": [{
            "product_name": "Godrej White 240 GM",
            "purchased_quantity": 10,
            "unit_rate": 45.0,
            "line_total": 450.0,
            "confidence": 90.0,
        }],
        "grand_total": 450.0,
    }
    ocr_items = [{
        "product_name": "Godrej White 240 GM",
        "quantity": 12.0,  # OCR saw 12 instead of 10
        "purchase_price": 45.0,
        "line_total": 450.0,
        "confidence": 80.0,
    }]
    ocr_meta = {"invoice_total": 450.0}

    reconciled = reconcile_hybrid_extraction(vision_data, ocr_items, ocr_meta)
    item = reconciled["items"][0]

    assert item["corroborated"] is False
    assert len(item["engine_disagreements"]) > 0
    assert item["validation_status"] == "NEEDS_REVIEW"
    assert any("disagreement" in r.lower() for r in item["review_reasons"])


def test_rendered_invoice_image_fixture_ocr():
    """Renders a synthetic invoice image fixture with text, table, and packaging."""
    img = Image.new("RGB", (700, 300), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 20), "Wholesale Supermart", fill="black")
    draw.text((20, 50), "Description            Qty    Rate     Total", fill="black")
    draw.text((20, 80), "FORTUNE 500 GM         20     70.00    1400.00", fill="black")
    draw.text((20, 110), "Godrej White 240 GM    10     45.00    450.00", fill="black")
    draw.text((20, 150), "Grand Total: 1850.00", fill="black")

    # Pass lines through table extractor
    text = (
        "Wholesale Supermart\n"
        "Description            Qty    Rate     Total\n"
        "FORTUNE 500 GM         20     70.00    1400.00\n"
        "Godrej White 240 GM    10     45.00    450.00\n"
        "Grand Total: 1850.00\n"
    )
    res = extract_table(rows_from_text(text), text_mode=True, extraction_method="TABLE_STRUCTURED")
    assert len(res.items) == 2

    ocr_item_dicts = [{
        "product_name": it.product_name,
        "quantity": it.quantity,
        "purchase_price": it.purchase_price,
        "line_total": it.line_total,
        "arithmetic_status": it.arithmetic_status,
        "confidence": it.confidence,
    } for it in res.items]

    reconciled = reconcile_hybrid_extraction(None, ocr_item_dicts, {"invoice_total": 1850.0})
    items = reconciled["items"]
    assert len(items) == 2

    # Fortune line
    f = items[0]
    assert f["purchased_quantity"] == 20.0
    assert f["pack_size"] == 500.0
    assert f["pack_size_unit"] == "g"
    assert f["purchase_unit"] is None
    assert f["unit_rate"] == 70.0
    assert f["line_total"] == 1400.0

    # Godrej line
    g = items[1]
    assert g["purchased_quantity"] == 10.0
    assert g["pack_size"] == 240.0
    assert g["pack_size_unit"] == "g"
    assert g["purchase_unit"] is None
    assert g["unit_rate"] == 45.0
    assert g["line_total"] == 450.0
