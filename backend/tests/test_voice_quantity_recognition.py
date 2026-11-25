"""Phase 9 & Phase 10 contextual quantity recognition, false-positive guard,
confidence gating, and speech replay tests for Voice-to-Bill."""

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
from services.voice_context import (
    classify_voice_replay_outcome,
    resolve_contextual_homophones,
)
from services.voice_parser import extract_items_from_transcript


def _cand(name: str, unit: str = "packet", price: float = 20.0, category: str = "Grocery") -> dict:
    return VoiceProductCandidate(
        id=str(uuid.uuid4()),
        name=name,
        selling_price=price,
        current_stock=100,
        unit=unit,
        category=category,
        pricing_status="VERIFIED",
        price_basis_quantity=1.0,
        price_basis_unit=unit,
        mrp=price * 2,
    ).model_dump()


CATALOG = [
    _cand("Maggi Noodles", unit="packet", price=14.0, category="Noodles"),
    _cand("Colgate Dental Cream", unit="tube", price=55.0, category="Toothpaste"),
    _cand("Lux Soap", unit="pcs", price=35.0, category="Personal Care"),
    _cand("Parle-G Biscuits", unit="packet", price=10.0, category="Biscuits"),
    _cand("Basmati Rice", unit="kg", price=80.0, category="Grains"),
    _cand("Sunflower Cooking Oil", unit="L", price=160.0, category="Oils"),
    _cand("Sugar", unit="kg", price=45.0, category="Grocery"),
    _cand("Red Label Tea", unit="packet", price=120.0, category="Beverages"),
]


# ---------------------------------------------------------------------------
# 1. Exact Recognition Baseline
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("phrase,expected", [
    ("Two Maggie", [("Maggi Noodles", 2)]),
    ("2 Maggie", [("Maggi Noodles", 2)]),
    ("Two packets Maggie", [("Maggi Noodles", 2)]),
])
def test_exact_recognition_unchanged(phrase, expected):
    extracted = extract_items_from_transcript(phrase, catalog=CATALOG)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, CATALOG)
    assert [(m.name, m.quantity) for m in matched] == expected
    assert ambig == [] and unmatched == []


# ---------------------------------------------------------------------------
# 2. Context-Aware STT Homophone Correction
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("phrase,expected,orig_tok", [
    ("To Maggie", [("Maggi Noodles", 2)], "to"),
    ("Too Maggie", [("Maggi Noodles", 2)], "too"),
    ("For Colgate", [("Colgate Dental Cream", 4)], "for"),
    ("Won rice", [("Basmati Rice", 1)], "won"),
    ("Tree soaps", [("Lux Soap", 3)], "tree"),
    ("Ate biscuits", [("Parle-G Biscuits", 8)], "ate"),
    ("to packets of Maggie", [("Maggi Noodles", 2)], "to"),
    ("Give me to Maggie", [("Maggi Noodles", 2)], "to"),
])
def test_common_stt_homophone_errors_resolved_with_catalog_context(phrase, expected, orig_tok):
    extracted = extract_items_from_transcript(phrase, catalog=CATALOG)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, CATALOG)
    assert [(m.name, m.quantity) for m in matched] == expected, f"Failed for {phrase!r}: ambig={ambig}, unmatched={unmatched}"
    assert matched[0].quantity_source == "contextual_homophone"
    assert matched[0].original_quantity_token == orig_tok
    assert matched[0].quantity_confidence >= 0.82
    assert ambig == [] and unmatched == []


# ---------------------------------------------------------------------------
# 3. False-Positive Prevention (Never corrupt ordinary English)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("prose", [
    "Go to the counter",
    "Give it to him",
    "Too expensive",
    "For my family",
    "Four people came",
    "I want to go to the shop",
])
def test_ordinary_english_never_becomes_bill_quantity(prose):
    extracted = extract_items_from_transcript(prose, catalog=CATALOG)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, CATALOG)
    assert matched == [], f"Unexpected matched items for {prose!r}: {matched}"
    assert ambig == [], f"Unexpected ambiguous items for {prose!r}: {ambig}"
    assert extracted == [], f"False bill quantity extracted for conversational prose {prose!r}: {extracted}"


def test_price_connector_for_never_converted_to_four():
    extracted = extract_items_from_transcript("3 Red Label Tea for 100 rupees", catalog=CATALOG)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, CATALOG)
    assert len(matched) == 1
    assert matched[0].quantity == 3
    assert matched[0].total_price == 100.0


def test_product_containing_homophone_word_is_not_rewritten():
    ext_cat = CATALOG + [_cand("Tea Tree Oil", unit="bottle", price=180.0, category="Oils")]
    extracted = extract_items_from_transcript("Tea Tree Oil", catalog=ext_cat)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, ext_cat)
    assert [(m.name, m.quantity) for m in matched] == [("Tea Tree Oil", 1)]
    assert ambig == [] and unmatched == []


# ---------------------------------------------------------------------------
# 4. Multi-Item + Homophone Combinations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("utterance,expected", [
    ("To Maggie two Colgate", [("Maggi Noodles", 2), ("Colgate Dental Cream", 2)]),
    ("Five Maggie to Colgate", [("Maggi Noodles", 5), ("Colgate Dental Cream", 2)]),
    ("To Maggie for Colgate", [("Maggi Noodles", 2), ("Colgate Dental Cream", 4)]),
    ("Tree soaps two biscuits", [("Lux Soap", 3), ("Parle-G Biscuits", 2)]),
])
def test_multi_item_with_homophones(utterance, expected):
    extracted = extract_items_from_transcript(utterance, catalog=CATALOG)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, CATALOG)
    assert [(m.name, m.quantity) for m in matched] == expected
    assert ambig == [] and unmatched == []


# ---------------------------------------------------------------------------
# 5. Moderate Confidence Confirmation ("Did you mean?") & STT Alternatives
# ---------------------------------------------------------------------------

def test_moderate_confidence_mid_phrase_emits_quantity_confirmation():
    # "sugar for tea" -> "for" after bare unquantified noun "sugar" is ambiguous vs "4 Red Label Tea"
    extracted = extract_items_from_transcript("sugar for tea", catalog=CATALOG)
    matched, ambig, unmatched, *_ = match_items_to_inventory(extracted, CATALOG)
    assert [(m.name, m.quantity) for m in matched] == [("Sugar", 1)]
    assert len(ambig) == 1
    assert ambig[0].ambiguity_type == "quantity"
    assert ambig[0].suggested_quantity == 4
    assert ambig[0].fallback_quantity == 1
    assert len(ambig[0].options) == 2
    assert ambig[0].options[0].quantity == 4 and ambig[0].options[0].name == "Red Label Tea"
    assert ambig[0].options[1].quantity == 1 and ambig[0].options[1].name == "Red Label Tea"


def test_stt_alternative_corroboration_upgrades_confidence():
    ctx = resolve_contextual_homophones(
        "to Maggie",
        CATALOG,
        speech_alternatives=["two Maggie", "to Maggi"],
    )
    assert "__qauto_2_to_" in ctx.resolved_text
    assert ctx.corrections[0].source == "stt_alternative"
    assert ctx.corrections[0].confidence == 1.0


# ---------------------------------------------------------------------------
# 6. Phase 10 Replay Failure Classification + API Integration + Performance
# ---------------------------------------------------------------------------

def test_replay_diagnostics_distinguishes_stt_vs_parser():
    # Case A: Clean STT transcript -> PASS
    ext_clean = extract_items_from_transcript("Two Maggie", catalog=CATALOG)
    m_clean, a_clean, *_ = match_items_to_inventory(ext_clean, CATALOG)
    res_clean = classify_voice_replay_outcome(
        spoken_intent="Two Maggie",
        stt_transcript="Two Maggie",
        extracted_pairs=[(m.name, m.quantity) for m in m_clean],
        expected_pairs=[("Maggi Noodles", 2)],
        ambiguous_count=len(a_clean),
        matched_items_raw=m_clean,
    )
    assert res_clean["classification"] == "PASS"

    # Case B: STT slipped to "To Maggie", contextual parser recovered -> STT_CORRUPTED_RECOVERED
    ext_slip = extract_items_from_transcript("To Maggie", catalog=CATALOG)
    m_slip, a_slip, *_ = match_items_to_inventory(ext_slip, CATALOG)
    res_slip = classify_voice_replay_outcome(
        spoken_intent="Two Maggie",
        stt_transcript="To Maggie",
        extracted_pairs=[(m.name, m.quantity) for m in m_slip],
        expected_pairs=[("Maggi Noodles", 2)],
        ambiguous_count=len(a_slip),
        matched_items_raw=m_slip,
    )
    assert res_slip["classification"] == "STT_CORRUPTED_RECOVERED"
    assert res_slip["stt_drifted"] is True

    # Case C: STT corrupted transcript into unrelated nonsense -> STT_FAILURE (not blamed on parser)
    ext_bad = extract_items_from_transcript("Blue window", catalog=CATALOG)
    m_bad, a_bad, *_ = match_items_to_inventory(ext_bad, CATALOG)
    res_bad = classify_voice_replay_outcome(
        spoken_intent="Two Maggie",
        stt_transcript="Blue window",
        extracted_pairs=[(m.name, m.quantity) for m in m_bad],
        expected_pairs=[("Maggi Noodles", 2)],
        ambiguous_count=len(a_bad),
        matched_items_raw=m_bad,
    )
    assert res_bad["classification"] == "STT_FAILURE"


def test_api_process_resolves_homophone_with_alternatives_and_blocks_false_positive():
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
        email = f"vqr_{uuid.uuid4().hex[:8]}@example.com"
        client.post("/api/v1/auth/register", json={"email": email, "password": "Password123!"})
        tok = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"}).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        client.post("/api/v1/shops", json={"shop_name": "VoiceQty Shop", "owner_name": "Owner", "business_type": "Grocery/Kirana", "location": "Hyd"}, headers=h)
        client.post("/api/v1/products", json={
            "name": "Maggi Noodles", "unit": "packet", "selling_price": 14.0, "purchase_price": 10.0, "mrp": 15.0,
            "current_stock": 50, "pricing_status": "VERIFIED",
        }, headers=h)
        client.post("/api/v1/products", json={
            "name": "Colgate Dental Cream", "unit": "tube", "selling_price": 45.0, "purchase_price": 32.0, "mrp": 50.0,
            "current_stock": 40, "pricing_status": "VERIFIED",
        }, headers=h)

        resp = client.post("/api/v1/voice/process", json={
            "simulation_text": "To Maggie for Colgate",
            "language_code": "en-IN",
            "stt_confidence": 0.78,
            "speech_alternatives": ["Two Maggie four Colgate"],
        }, headers=h)
        assert resp.status_code == 200
        body = resp.json()
        assert [(m["name"], m["quantity"], m["quantity_source"]) for m in body["matched_items"]] == [
            ("Maggi Noodles", 2, "stt_alternative"),
            ("Colgate Dental Cream", 4, "stt_alternative"),
        ]

        fp_resp = client.post("/api/v1/voice/process", json={
            "simulation_text": "Go to the counter",
            "language_code": "en-IN",
        }, headers=h)
        assert fp_resp.status_code == 200
        fp_body = fp_resp.json()
        assert fp_body["matched_items"] == []
        assert fp_body["unmatched_items"] == []
    finally:
        app.dependency_overrides.clear()


def test_contextual_resolution_latency_under_budget_on_400_item_catalog():
    large = [_cand(f"Grocery SKU {i}", price=15.0) for i in range(400)] + CATALOG
    t0 = time.perf_counter()
    for _ in range(25):
        ext = extract_items_from_transcript("To Maggie for Colgate and tree soaps", catalog=large)
        match_items_to_inventory(ext, large)
    avg_ms = ((time.perf_counter() - t0) / 25) * 1000
    assert avg_ms < 100.0, f"Contextual resolution took {avg_ms:.2f}ms avg per call"
