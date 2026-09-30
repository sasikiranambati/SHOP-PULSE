import uuid
import pytest
from fastapi.testclient import TestClient

from main import app
from core.config import settings
from services.speech import MockSpeechService, SarvamSpeechService, get_speech_service
from services.voice_parser import extract_items_from_transcript
from services.inventory_matcher import match_items_to_inventory, to_candidate
from schemas.voice import VoiceProductCandidate

client = TestClient(app)

# Standard mock catalog matching user scenarios
SAMPLE_CATALOG = [
    {
        "id": uuid.uuid4(),
        "name": "Tata Salt 1kg",
        "selling_price": 28.0,
        "current_stock": 50,
        "unit": "pkt",
        "category": "Staples",
    },
    {
        "id": uuid.uuid4(),
        "name": "Tata Salt 500g",
        "selling_price": 16.0,
        "current_stock": 20,
        "unit": "pkt",
        "category": "Staples",
    },
    {
        "id": uuid.uuid4(),
        "name": "Tata Salt 200g",
        "selling_price": 10.0,
        "current_stock": 15,
        "unit": "pkt",
        "category": "Staples",
    },
    {
        "id": uuid.uuid4(),
        "name": "Parle-G",
        "selling_price": 10.0,
        "current_stock": 100,
        "unit": "pack",
        "category": "Snacks",
    },
    {
        "id": uuid.uuid4(),
        "name": "Aashirvaad Atta",
        "selling_price": 55.0,
        "current_stock": 25,
        "unit": "bag",
        "category": "Staples",
    },
    {
        "id": uuid.uuid4(),
        "name": "Fortune Sunflower Oil (1L)",
        "selling_price": 165.0,
        "current_stock": 2,
        "unit": "pouch",
        "category": "Staples",
    },
]

import asyncio

# ---------------------------------------------------------------------------
# 1. Speech Service Abstraction Tests
# ---------------------------------------------------------------------------
def test_mock_speech_service_simulation():
    service = MockSpeechService()
    result = asyncio.run(service.transcribe(simulation_text="2 Tata Salt and 3 Parle G"))
    assert result.is_mock is True
    assert result.provider == "mock"
    assert result.transcript == "2 Tata Salt and 3 Parle G"

def test_sarvam_speech_service_missing_key():
    service = SarvamSpeechService(api_key=None)
    with pytest.raises(ValueError) as excinfo:
        asyncio.run(service.transcribe(audio_data=b"fake-audio"))
    assert "Sarvam AI API key is not configured" in str(excinfo.value)

def test_speech_service_factory_defaults_to_mock():
    service = get_speech_service()
    assert isinstance(service, MockSpeechService)

# ---------------------------------------------------------------------------
# 2. Voice Parser Natural Language Tests
# ---------------------------------------------------------------------------
def test_parse_single_product_digit():
    items = extract_items_from_transcript("2 Tata Salt")
    assert len(items) == 1
    assert items[0].name == "Tata Salt"
    assert items[0].quantity == 2

def test_parse_multiple_products():
    items = extract_items_from_transcript("3 Parle G and 1 Aashirvaad Atta")
    assert len(items) == 2
    assert items[0].name == "Parle-G"
    assert items[0].quantity == 3
    assert items[1].name == "Aashirvaad Atta"
    assert items[1].quantity == 1

def test_parse_word_numbers():
    items = extract_items_from_transcript("two Tata Salt and three Parle G")
    assert len(items) == 2
    assert items[0].name == "Tata Salt"
    assert items[0].quantity == 2
    assert items[1].name == "Parle-G"
    assert items[1].quantity == 3

def test_parse_conversational_and_packaging_variations():
    # "give me three Parle G"
    items1 = extract_items_from_transcript("give me three Parle G")
    assert len(items1) == 1
    assert items1[0].name == "Parle-G"
    assert items1[0].quantity == 3

    # "2 packets of Tata Salt"
    items2 = extract_items_from_transcript("2 packets of Tata Salt")
    assert len(items2) == 1
    assert items2[0].name == "Tata Salt"
    assert items2[0].quantity == 2

    # "one Aashirvaad atta and two Tata salts"
    items3 = extract_items_from_transcript("one Aashirvaad atta and two Tata salts")
    assert len(items3) == 2
    assert items3[0].name == "Aashirvaad Atta"
    assert items3[0].quantity == 1
    assert items3[1].name == "Tata Salt"
    assert items3[1].quantity == 2

def test_parse_missing_quantity_defaults_to_one():
    items = extract_items_from_transcript("Tata Salt")
    assert len(items) == 1
    assert items[0].name == "Tata Salt"
    assert items[0].quantity == 1

def test_parse_hindi_transliteration():
    items = extract_items_from_transcript("do packet tata salt aur teen parle g")
    assert len(items) == 2
    assert items[0].name == "Tata Salt"
    assert items[0].quantity == 2
    assert items[1].name == "Parle-G"
    assert items[1].quantity == 3

# ---------------------------------------------------------------------------
# 3. Inventory Matching & Ambiguity Tests
# ---------------------------------------------------------------------------
def test_matching_exact_single_product():
    extracted = extract_items_from_transcript("3 Parle G and 1 Aashirvaad Atta")
    matched, ambiguous, unmatched, subtotal, tax, total = match_items_to_inventory(
        extracted, SAMPLE_CATALOG
    )
    assert len(matched) == 2
    assert len(ambiguous) == 0
    assert len(unmatched) == 0
    assert subtotal == (3 * 10.0) + (1 * 55.0)
    assert total == 85.0

def test_matching_ambiguous_product():
    # "2 Tata Salt" matches 3 variants: 1kg, 500g, 200g
    extracted = extract_items_from_transcript("2 Tata Salt")
    matched, ambiguous, unmatched, subtotal, tax, total = match_items_to_inventory(
        extracted, SAMPLE_CATALOG
    )
    assert len(matched) == 0
    assert len(ambiguous) == 1
    assert ambiguous[0].queried_name == "Tata Salt"
    assert ambiguous[0].quantity == 2
    assert len(ambiguous[0].candidates) == 3
    candidate_names = [c.name for c in ambiguous[0].candidates]
    assert "Tata Salt 1kg" in candidate_names
    assert "Tata Salt 500g" in candidate_names
    assert "Tata Salt 200g" in candidate_names

def test_matching_specific_variant_is_unambiguous():
    # Spoken specifically: "2 Tata Salt 1kg"
    extracted = extract_items_from_transcript("2 Tata Salt 1kg")
    matched, ambiguous, unmatched, subtotal, tax, total = match_items_to_inventory(
        extracted, SAMPLE_CATALOG
    )
    assert len(matched) == 1
    assert len(ambiguous) == 0
    assert matched[0].name == "Tata Salt 1kg"
    assert matched[0].quantity == 2
    assert matched[0].unit_price == 28.0
    assert matched[0].total_price == 56.0

def test_matching_unknown_product():
    extracted = extract_items_from_transcript("2 Magic Biscuits")
    matched, ambiguous, unmatched, subtotal, tax, total = match_items_to_inventory(
        extracted, SAMPLE_CATALOG
    )
    assert len(matched) == 0
    assert len(ambiguous) == 0
    assert len(unmatched) == 1
    assert unmatched[0].queried_name == "Magic Biscuit"
    assert unmatched[0].quantity == 2

def test_matching_stock_alert_flag():
    # Fortune Sunflower Oil has stock = 2. Request 5 units.
    extracted = extract_items_from_transcript("5 Fortune Sunflower Oil")
    matched, ambiguous, unmatched, subtotal, tax, total = match_items_to_inventory(
        extracted, SAMPLE_CATALOG
    )
    assert len(matched) == 1
    assert matched[0].is_insufficient_stock is True
    assert matched[0].available_stock == 2
    assert matched[0].is_out_of_stock is False

# ---------------------------------------------------------------------------
# 4. API Endpoints Integration Tests
# ---------------------------------------------------------------------------
def test_voice_status_api():
    response = client.get("/api/v1/voice/status")
    assert response.status_code == 200
    data = response.json()
    assert data["voice_mode"] == "mock"
    assert data["provider"] == "mock"
    assert data["is_mock"] is True
    assert len(data["supported_languages"]) > 0

def test_voice_process_api_with_custom_products():
    custom_prods = [
        {
            "id": str(uuid.uuid4()),
            "name": "Tata Salt 1kg",
            "selling_price": 28.0,
            "current_stock": 50,
            "unit": "pkt",
            "category": "Staples"
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Parle-G",
            "selling_price": 10.0,
            "current_stock": 100,
            "unit": "pack",
            "category": "Snacks"
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Aashirvaad Atta",
            "selling_price": 55.0,
            "current_stock": 25,
            "unit": "bag",
            "category": "Staples"
        }
    ]

    payload = {
        "simulation_text": "2 Tata Salt 1kg, 3 Parle-G and 1 Aashirvaad Atta",
        "language_code": "en-IN",
        "custom_products": custom_prods
    }

    response = client.post("/api/v1/voice/process", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_mock"] is True
    assert len(data["matched_items"]) == 3
    assert data["subtotal"] == (2 * 28.0) + (3 * 10.0) + (1 * 55.0)
    assert data["total"] == data["subtotal"]

def test_voice_process_api_telugu_simulation():
    custom_prods = [
        {
            "id": str(uuid.uuid4()),
            "name": "Rice 1kg",
            "selling_price": 60.0,
            "current_stock": 50,
            "unit": "kg",
            "category": "Staples"
        }
    ]

    payload = {
        "simulation_text": "రెండు కిలోల బియ్యం నూట ఇరవై రూపాయలు",
        "language_code": "te-IN",
        "custom_products": custom_prods
    }

    response = client.post("/api/v1/voice/process", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["matched_items"]) == 1
    assert data["matched_items"][0]["name"] == "Rice 1kg"
    assert data["matched_items"][0]["quantity"] == 2
    assert data["matched_items"][0]["total_price"] == 120.0
    assert len(data["unmatched_items"]) == 0

def test_voice_process_api_hindi_simulation():
    custom_prods = [
        {
            "id": str(uuid.uuid4()),
            "name": "Rice 1kg",
            "selling_price": 60.0,
            "current_stock": 50,
            "unit": "kg",
            "category": "Staples"
        }
    ]

    payload = {
        "simulation_text": "दो किलो चावल एक सौ बीस रुपये",
        "language_code": "hi-IN",
        "custom_products": custom_prods
    }

    response = client.post("/api/v1/voice/process", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["matched_items"]) == 1
    assert data["matched_items"][0]["name"] == "Rice 1kg"
    assert data["matched_items"][0]["quantity"] == 2
    assert data["matched_items"][0]["total_price"] == 120.0
    assert len(data["unmatched_items"]) == 0

