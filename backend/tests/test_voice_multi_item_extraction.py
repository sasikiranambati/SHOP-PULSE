"""Comprehensive Phase 11-13 test suite for multi-item voice extraction, normalization,
catalog-aware segmentation, confidence matching, command actions, and end-to-end API billing."""

import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.deps import get_db
from db.session import Base
from main import app
from schemas.voice import VoiceProductCandidate
from services.inventory_matcher import match_items_to_inventory
from services.voice_parser import extract_items_from_transcript, normalize_digits_and_numbers


def _cand(
    name: str,
    unit: str = "packet",
    price: float = 20.0,
    stock: float = 100,
    category: str = "Grocery",
    pricing_status: str = "VERIFIED",
    pid: str | None = None,
) -> dict:
    return VoiceProductCandidate(
        id=pid or str(uuid.uuid4()),
        name=name,
        selling_price=price,
        current_stock=stock,
        unit=unit,
        category=category,
        pricing_status=pricing_status,
        price_basis_quantity=1.0,
        price_basis_unit=unit,
        mrp=price * 2 if price > 0 else 100.0,
    ).model_dump()


KIRANA_FIXTURE_CATALOG = [
    _cand("Maggi Noodles", unit="packet", price=14.0, category="Instant Noodles"),
    _cand("Colgate Dental Cream", unit="tube", price=55.0, category="Toothpaste"),
    _cand("Lux Soap", unit="pcs", price=35.0, category="Personal Care"),
    _cand("Parle-G Biscuits", unit="packet", price=10.0, category="Biscuits"),
    _cand("Basmati Rice", unit="kg", price=80.0, category="Grains"),
    _cand("Sunflower Cooking Oil", unit="L", price=160.0, category="Oils"),
    _cand("Surf Excel Detergent", unit="kg", price=120.0, category="Detergent"),
]


# ---------------------------------------------------------------------------
# 1. Normalization & Compound Number Tests
# ---------------------------------------------------------------------------

def test_number_word_and_compound_normalization():
    assert "25 Maggi" in normalize_digits_and_numbers("twenty five Maggi")
    assert "23 Colgate" in normalize_digits_and_numbers("twenty-three Colgate")
    assert "120 rupees" in normalize_digits_and_numbers("one hundred twenty rupees")
    assert "1 litre oil" in normalize_digits_and_numbers("a litre oil")
    # Standalone 'a' inside brand/grade strings must not turn into '1'
    assert "Grade A Rice" == normalize_digits_and_numbers("Grade A Rice")
    parsed_litre = extract_items_from_transcript("a litre oil", catalog=KIRANA_FIXTURE_CATALOG)
    assert len(parsed_litre) == 1 and parsed_litre[0].quantity == 1 and parsed_litre[0].unit == "L"


# ---------------------------------------------------------------------------
# 2. Basic Quantities, Number Words & Packaging Variations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("phrase,expected_name_sub,expected_qty,expected_unit", [
    ("One Maggie", "magg", 1, None),
    ("Two Maggie", "magg", 2, None),
    ("Two Maggie packets", "magg", 2, "packet"),
    ("2 packets of Maggie", "magg", 2, "packet"),
    ("Five Maggi packets", "magg", 5, "packet"),
    ("5 Maggi", "magg", 5, None),
    ("Maggie five packets", "magg", 5, "packet"),
    ("Ten Maggie", "magg", 10, None),
    ("Five Colgate", "colgate", 5, None),
    ("Three Lux", "lux", 3, None),
    ("Ten soaps", "soap", 10, None),
    ("5 bottles oil", "oil", 5, "bottle"),
])
def test_basic_quantity_and_number_word_phrases(phrase, expected_name_sub, expected_qty, expected_unit):
    items = extract_items_from_transcript(phrase, catalog=KIRANA_FIXTURE_CATALOG)
    assert len(items) == 1, f"Expected 1 item for {phrase!r}, got {items}"
    assert expected_name_sub in items[0].name.lower()
    assert items[0].quantity == expected_qty
    assert items[0].unit == expected_unit


def test_package_size_not_confused_with_purchase_quantity():
    items = extract_items_from_transcript("2 Maggie packets of 70 grams", catalog=KIRANA_FIXTURE_CATALOG)
    assert len(items) == 1
    assert items[0].quantity == 2
    assert items[0].unit == "packet"
    assert items[0].package_size == "70g"
    assert "70" not in items[0].name

    multi = extract_items_from_transcript("2 Maggie packets of 70 grams 3 Colgate", catalog=KIRANA_FIXTURE_CATALOG)
    assert len(multi) == 2
    assert (multi[0].quantity, multi[0].package_size) == (2, "70g")
    assert (multi[1].quantity, multi[1].name.lower()) == (3, "colgate")


# ---------------------------------------------------------------------------
# 3. Continuous Speech & Multi-Item Segmentation (Unpunctuated)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("utterance,expected_pairs", [
    ("5 Maggie 2 Colgate", [("Maggi Noodles", 5), ("Colgate Dental Cream", 2)]),
    ("2 Maggie and 3 Colgate", [("Maggi Noodles", 2), ("Colgate Dental Cream", 3)]),
    ("5 Maggie, 2 Colgate, 3 soaps", [("Maggi Noodles", 5), ("Colgate Dental Cream", 2), ("Lux Soap", 3)]),
    ("5 Maggie, 2 Colgate, 3 Lux", [("Maggi Noodles", 5), ("Colgate Dental Cream", 2), ("Lux Soap", 3)]),
    ("I want five Maggie and two Colgate", [("Maggi Noodles", 5), ("Colgate Dental Cream", 2)]),
    ("Give me 3 Parle-G and 4 Lux soaps", [("Parle-G Biscuits", 3), ("Lux Soap", 4)]),
    ("I need 2 kilograms of rice and 1 litre of oil", [("Basmati Rice", 2), ("Sunflower Cooking Oil", 1)]),
    ("Give me three soaps four biscuits and two litres oil", [("Lux Soap", 3), ("Parle-G Biscuits", 4), ("Sunflower Cooking Oil", 2)]),
    ("Add five Maggie two Colgate and three Lux soap", [("Maggi Noodles", 5), ("Colgate Dental Cream", 2), ("Lux Soap", 3)]),
    ("5 Maggie packets and 2 toothpaste tubes", [("Maggi Noodles", 5), ("Colgate Dental Cream", 2)]),
])
def test_multi_item_and_continuous_speech_e2e_matching(utterance, expected_pairs):
    extracted = extract_items_from_transcript(utterance, catalog=KIRANA_FIXTURE_CATALOG)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, KIRANA_FIXTURE_CATALOG)
    assert len(ambig) == 0, f"Unexpected ambiguity for {utterance!r}: {ambig}"
    assert len(unmatched) == 0, f"Unexpected unmatched for {utterance!r}: {unmatched}"
    got = [(m.name, m.quantity) for m in matched]
    assert got == expected_pairs


def test_multi_item_container_units_match_correctly():
    bag_oil_catalog = [
        _cand("Rice Bag", unit="bag", price=550.0, category="Grains"),
        _cand("Cooking Oil Bottle", unit="bottle", price=165.0, category="Oils"),
        _cand("Lux Soap", unit="pcs", price=35.0, category="Personal Care"),
    ]
    extracted = extract_items_from_transcript("add two rice bags and five oil bottles and three soaps", catalog=bag_oil_catalog)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, bag_oil_catalog)
    assert [(m.name, m.quantity) for m in matched] == [
        ("Rice Bag", 2),
        ("Cooking Oil Bottle", 5),
        ("Lux Soap", 3),
    ]
    assert ambig == [] and unmatched == []


def test_catalog_embedded_numbers_do_not_mis_segment():
    embedded_cat = [
        _cand("Tata Salt 1kg", unit="packet", price=28.0),
        _cand("5 Star Chocolate", unit="pcs", price=10.0),
        _cand("Colgate Toothpaste", unit="tube", price=50.0),
    ]
    extracted = extract_items_from_transcript("5 Tata Salt 1 kg 2 5 Star Chocolate 3 Colgate", catalog=embedded_cat)
    assert len(extracted) == 3
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, embedded_cat)
    assert [(m.name, m.quantity) for m in matched] == [
        ("Tata Salt 1kg", 5),
        ("5 Star Chocolate", 2),
        ("Colgate Toothpaste", 3),
    ]
    assert ambig == [] and unmatched == []


# ---------------------------------------------------------------------------
# 4. Product Matching Variants & Confidence Gating
# ---------------------------------------------------------------------------

def test_product_matching_variations_and_confidence():
    for phrase in ["2 Maggi", "2 Maggie", "2 Maggi noodles", "3 Parle G", "3 Parle-G", "2 Colgate", "2 Colgate toothpaste"]:
        extracted = extract_items_from_transcript(phrase, catalog=KIRANA_FIXTURE_CATALOG)
        matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, KIRANA_FIXTURE_CATALOG)
        assert len(matched) == 1, f"Failed for {phrase!r}: ambig={ambig}, unmatched={unmatched}"
        assert (matched[0].match_confidence or 0) >= 0.85


def test_partial_failure_does_not_drop_valid_items():
    catalog = KIRANA_FIXTURE_CATALOG + [
        _cand("Unverified Dal", unit="kg", price=110.0, pricing_status="NEEDS_REVIEW"),
        _cand("Zero Price Biscuit", unit="packet", price=0.0, pricing_status="INCOMPLETE"),
    ]
    utterance = "5 Maggie 2 Colgate 1 UnknownProduct 2 kg Unverified Dal 1 Zero Price Biscuit 2 liter Rice"
    extracted = extract_items_from_transcript(utterance, catalog=catalog)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, catalog)

    assert [(m.name, m.quantity) for m in matched] == [
        ("Maggi Noodles", 5),
        ("Colgate Dental Cream", 2),
    ]
    assert ambig == []
    unmatched_reasons = " | ".join(f"{u.queried_name}:{u.reason}" for u in unmatched).lower()
    assert "unknownproduct" in unmatched_reasons
    assert "review" in unmatched_reasons
    assert "incomplete" in unmatched_reasons
    assert "cannot be converted" in unmatched_reasons


def test_ambiguous_variants_never_silently_picked():
    variant_catalog = [
        _cand("Maggi 70g Masala", unit="packet", price=14.0),
        _cand("Maggi 140g Twin", unit="packet", price=28.0),
    ]
    extracted = extract_items_from_transcript("2 Maggie packets", catalog=variant_catalog)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, variant_catalog)
    assert len(matched) == 0 and len(unmatched) == 0
    assert len(ambig) == 1 and len(ambig[0].candidates) == 2

    # Specifying package size resolves cleanly
    specific = extract_items_from_transcript("2 Maggie packets of 70 grams", catalog=variant_catalog)
    matched2, ambig2, unmatched2, *_ = match_items_to_inventory(specific, variant_catalog)
    assert len(matched2) == 1 and matched2[0].name == "Maggi 70g Masala" and matched2[0].quantity == 2


# ---------------------------------------------------------------------------
# 5. Speech Commands & Performance
# ---------------------------------------------------------------------------

def test_command_action_parsing():
    add_more = extract_items_from_transcript("Add two more Maggie")
    assert len(add_more) == 1 and add_more[0].action == "add" and add_more[0].quantity == 2 and add_more[0].name == "Maggie"

    inc = extract_items_from_transcript("Increase Maggie to 5")
    assert len(inc) == 1 and inc[0].action == "update" and inc[0].quantity == 5 and inc[0].name == "Maggie"

    make_qty = extract_items_from_transcript("Make Maggie quantity 4")
    assert len(make_qty) == 1 and make_qty[0].action == "update" and make_qty[0].quantity == 4 and make_qty[0].name == "Maggie"

    make_it = extract_items_from_transcript("Make it 5 Maggie instead of 3")
    assert len(make_it) == 1 and make_it[0].action == "update" and make_it[0].quantity == 5 and make_it[0].name == "Maggie"

    rem_all = extract_items_from_transcript("Remove Colgate")
    assert len(rem_all) == 1 and rem_all[0].action == "remove" and rem_all[0].explicit_quantity is False and rem_all[0].name == "Colgate"

    rem_qty = extract_items_from_transcript("Delete 2 soaps")
    assert len(rem_qty) == 1 and rem_qty[0].action == "remove" and rem_qty[0].explicit_quantity is True and rem_qty[0].quantity == 2


def test_extraction_latency_under_budget_for_large_catalog():
    large_catalog = [_cand(f"Kirana Item {i}", unit="pcs", price=10.0 + (i % 50)) for i in range(400)] + KIRANA_FIXTURE_CATALOG
    t0 = time.perf_counter()
    for _ in range(25):
        ext = extract_items_from_transcript("5 Maggie 2 Colgate 3 Lux soap and 1 UnknownItem", catalog=large_catalog)
        match_items_to_inventory(ext, large_catalog)
    elapsed_ms = ((time.perf_counter() - t0) / 25) * 1000
    assert elapsed_ms < 100.0, f"Multi-item extraction + matching took {elapsed_ms:.1f}ms avg per call"


# ---------------------------------------------------------------------------
# 6. Full Backend API Integration + Checkout Flow
# ---------------------------------------------------------------------------

def test_api_process_returns_structured_items_and_checks_out():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    try:
        client = TestClient(app)
        email = f"vmi_{uuid.uuid4().hex[:8]}@example.com"
        client.post("/api/v1/auth/register", json={"email": email, "password": "Password123!"})
        tok = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"}).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        client.post("/api/v1/shops", json={"shop_name": "MultiVoice Store", "owner_name": "Owner", "business_type": "Grocery/Kirana", "location": "Hyd"}, headers=h)

        p_maggi = client.post("/api/v1/products", json={
            "name": "Maggi Noodles", "unit": "packet", "selling_price": 14.0, "purchase_price": 10.0, "mrp": 15.0,
            "current_stock": 50, "pricing_status": "VERIFIED",
        }, headers=h).json()
        p_colgate = client.post("/api/v1/products", json={
            "name": "Colgate", "unit": "tube", "selling_price": 45.0, "purchase_price": 32.0, "mrp": 50.0,
            "current_stock": 40, "pricing_status": "VERIFIED",
        }, headers=h).json()
        p_lux = client.post("/api/v1/products", json={
            "name": "Lux Soap", "unit": "pcs", "selling_price": 35.0, "purchase_price": 25.0, "mrp": 40.0,
            "current_stock": 30, "pricing_status": "VERIFIED",
        }, headers=h).json()

        resp = client.post("/api/v1/voice/process", json={
            "simulation_text": "Five Maggie two Colgate and three Lux soap",
            "language_code": "en-IN",
        }, headers=h)
        assert resp.status_code == 200
        body = resp.json()

        assert [(m["name"], m["quantity"], m["total_price"]) for m in body["matched_items"]] == [
            ("Maggi Noodles", 5, 70.0),
            ("Colgate", 2, 90.0),
            ("Lux Soap", 3, 105.0),
        ]
        assert body["total"] == 265.0
        assert len(body["items"]) == 3
        assert all(st["status"] == "MATCHED" and st["match_confidence"] >= 0.85 for st in body["items"])

        sale_res = client.post("/api/v1/sales", json={
            "items": [{"product_id": m["product_id"], "quantity": m["quantity"], "unit_price": m["unit_price_exact"]} for m in body["matched_items"]],
            "payment_method": "cash",
        }, headers=h)
        assert sale_res.status_code in (200, 201)
        assert sale_res.json()["total_amount"] == 265.0
        assert client.get(f"/api/v1/products/{p_maggi['id']}", headers=h).json()["current_stock"] == 45
        assert client.get(f"/api/v1/products/{p_colgate['id']}", headers=h).json()["current_stock"] == 38
        assert client.get(f"/api/v1/products/{p_lux['id']}", headers=h).json()["current_stock"] == 27
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
