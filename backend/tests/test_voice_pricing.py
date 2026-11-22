"""
Voice-to-Bill pricing and units (final integration).

- A spoken price is kept: "3 tea packets for 100 rupees" is a ₹100.00 line, displayed, sent and saved as
  ₹100.00 (never re-priced from the catalogue, never ₹99.99).
- "100 rupees each" / "45 rupees per kg" is a unit price, never mistaken for the line total.
- The spoken quantity is converted into the product's stock unit (500 g of a kg product -> 0.5 kg);
  incompatible units and fractions of whole-number units are refused with a reason, never guessed.
- Ambiguous matches carry a ready line per candidate, so choosing one keeps the spoken price.
Generic test values only; in-memory database.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from schemas.voice import VoiceProductCandidate
from services.inventory_matcher import VoiceItemError, make_matched_item, match_items_to_inventory
from services.money import sale_line_amount, to_decimal
from services.voice_parser import ExtractedItem, extract_items_from_transcript

_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(bind=_engine)


def _items(text):
    return [(i.name, i.quantity, i.unit, i.spoken_price, i.spoken_unit_price, i.price_unit)
            for i in extract_items_from_transcript(text)]


def _cand(name, unit, price=50.0, stock=100, pid=None):
    return VoiceProductCandidate(id=pid or name, name=name, selling_price=price, current_stock=stock, unit=unit)


# ------------------------------------------------------------------------------------- parser


@pytest.mark.parametrize("text,expected", [
    ("3 tea packets for 100 rupees", [("tea", 3, "packet", 100.0, None, None)]),
    ("3 soap for 100", [("soap", 3, None, 100.0, None, None)]),
    ("3 tea packets 100 rupees each", [("tea", 3, "packet", None, 100.0, None)]),
    ("sugar 2 kg 45 rupees per kg", [("sugar", 2, "kg", None, 45.0, "kg")]),
    ("half kg dal 60 rupees", [("dal", 0.5, "kg", 60.0, None, None)]),
    ("500 g sugar", [("sugar", 500, "g", None, None, None)]),
    ("आधा किलो चीनी 30 रुपये", [("चीनी", 0.5, "kg", 30.0, None, None)]),
    ("2 kg sugar 90 rupees and 3 soap for 100", [("sugar", 2, "kg", 90.0, None, None), ("soap", 3, None, 100.0, None, None)]),
])
def test_parser_reads_quantity_unit_and_price(text, expected):
    assert _items(text) == expected


def test_brand_letters_are_not_units():
    # "Parle G" is a brand, not grams
    assert _items("3 Parle G")[0][2] is None


# ------------------------------------------------------------------------------------- matching


def test_spoken_total_is_kept_and_reproduced_exactly():
    m = make_matched_item(_cand("Tea", "packet", price=40.0), ExtractedItem(name="tea", quantity=3, unit="packet", spoken_price=100))
    assert (m.total_price, m.unit_price, m.price_source) == (100.0, 33.333, "spoken")
    assert sale_line_amount(3, m.unit_price_exact) == to_decimal("100.00")


def test_spoken_unit_price_each():
    m = make_matched_item(_cand("Tea", "packet", price=40.0), ExtractedItem(name="tea", quantity=3, spoken_unit_price=100))
    assert (m.total_price, m.price_source) == (300.0, "spoken")


def test_unit_price_per_kg_with_quantity_in_grams():
    m = make_matched_item(_cand("Sugar", "kg", price=44.0),
                          ExtractedItem(name="sugar", quantity=500, unit="g", spoken_unit_price=45, price_unit="kg"))
    assert (m.quantity, m.unit, m.total_price, m.spoken_quantity) == (0.5, "kg", 22.5, "500 g")


def test_catalogue_price_only_when_nothing_was_said():
    m = make_matched_item(_cand("Sugar", "kg", price=44.0), ExtractedItem(name="sugar", quantity=2.5, unit="kg"))
    assert (m.quantity, m.total_price, m.price_source, m.spoken_quantity) == (2.5, 110.0, "catalogue", None)


def test_colloquial_packets_of_a_pcs_product():
    m = make_matched_item(_cand("Tea", "pcs"), ExtractedItem(name="tea", quantity=3, unit="packet", spoken_price=100))
    assert (m.quantity, m.unit, m.total_price) == (3, "pcs", 100.0)


@pytest.mark.parametrize("product_unit,item,reason", [
    ("kg", ExtractedItem(name="sugar", quantity=2, unit="L"), "cannot be converted"),
    ("packet", ExtractedItem(name="tea", quantity=0.5), "whole"),
    ("pcs", ExtractedItem(name="soap", quantity=2, unit="kg"), "cannot be converted"),
])
def test_unsellable_lines_are_refused_with_a_reason(product_unit, item, reason):
    with pytest.raises(VoiceItemError, match=reason):
        make_matched_item(_cand("X", product_unit), item)
    matched, _, unmatched, *_ = match_items_to_inventory([item], [_cand(item.name.title(), product_unit).model_dump()])
    assert matched == [] and len(unmatched) == 1 and reason in unmatched[0].reason


def test_ambiguous_choice_keeps_the_spoken_price():
    catalog = [_cand("Tea Gold 250g", "packet", 120.0, pid="a").model_dump(),
               _cand("Tea Premium 500g", "packet", 220.0, pid="b").model_dump()]
    _, ambiguous, _, *_ = match_items_to_inventory(extract_items_from_transcript("3 tea packets for 100 rupees"), catalog)
    assert len(ambiguous) == 1 and ambiguous[0].spoken_price == 100.0
    assert {o.product_id: (o.total_price, o.price_source) for o in ambiguous[0].options} == {
        "a": (100.0, "spoken"), "b": (100.0, "spoken")}


# ------------------------------------------------------------------------------------- end to end


@pytest.fixture()
def api():
    import db.models  # noqa: F401
    from api.deps import get_db
    from db.session import Base
    from main import app

    Base.metadata.create_all(bind=_engine)

    def _db():
        s = _Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    email = f"vp{uuid.uuid4().hex[:8]}@example.com"
    c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    h = {"Authorization": "Bearer " + c.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]}
    c.post("/api/v1/shops", json={"shop_name": "K", "owner_name": "R", "business_type": "Grocery/Kirana", "location": "B"}, headers=h)
    yield c, h
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)


def _product(c, h, name, unit, stock, price, pricing_status="VERIFIED"):
    r = c.post("/api/v1/products", json={"name": name, "selling_price": price, "purchase_price": price,
                                         "current_stock": stock, "unit": unit, "pricing_status": pricing_status}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _voice(c, h, text):
    r = c.post("/api/v1/voice/process", json={"simulation_text": text, "language_code": "en-IN"}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _sell(c, h, matched, expect=(200, 201)):
    # What the frontend sends (Stage 4C.1 Decision 1): the catalogue price assertion for normal lines; for a
    # spoken price that differs from the catalogue, the customer-requested line total (approval needed)
    items = [{"product_id": m["product_id"], "quantity": m["quantity"],
              **({"requested_line_total": m["total_price"]} if m["needs_price_approval"] else {"unit_price": m["unit_price_exact"]})}
             for m in matched]
    r = c.post("/api/v1/sales", json={"items": items, "payment_method": "cash"}, headers=h)
    assert r.status_code in expect, r.text
    return r.json()


def _overrides(c, h, product_id):
    trail = c.get(f"/api/v1/products/{product_id}/audit-trail", headers=h).json()
    return [e for e in trail if e["action_type"] == "SALE_PRICE_OVERRIDE"]


def test_three_tea_packets_for_100_rupees_end_to_end(api):
    c, h = api
    tea = _product(c, h, "Tea", "packet", 20, 40.0)
    v = _voice(c, h, "3 tea packets for 100 rupees")
    assert len(v["matched_items"]) == 1 and v["total"] == 100.0
    m = v["matched_items"][0]
    # Decision 1: the spoken ₹100 is a customer request (catalogue ₹120): shown, flagged for approval
    assert (m["quantity"], m["total_price"], m["price_source"], m["catalog_line_total"], m["needs_price_approval"]) == (
        3, 100.0, "spoken", 120.0, True)
    sale = _sell(c, h, v["matched_items"])  # the shop owner approves it
    assert sale["total_amount"] == 100.0
    assert c.get(f"/api/v1/products/{tea['id']}", headers=h).json()["current_stock"] == 17
    (audit,) = _overrides(c, h, tea["id"])
    assert "requested ₹100.00 instead of catalogue ₹120.00" in audit["reason"]


def test_grams_spoken_for_a_kg_product_reduce_stock_in_kg(api):
    c, h = api
    sugar = _product(c, h, "Sugar", "kg", 10, 44.0)
    v = _voice(c, h, "500 g sugar")
    m = v["matched_items"][0]
    assert (m["quantity"], m["unit"], m["total_price"], m["spoken_quantity"]) == (0.5, "kg", 22.0, "500 g")
    assert _sell(c, h, v["matched_items"])["total_amount"] == 22.0
    assert c.get(f"/api/v1/products/{sugar['id']}", headers=h).json()["current_stock"] == 9.5


def test_multiple_items_with_mixed_prices(api):
    c, h = api
    _product(c, h, "Sugar", "kg", 10, 44.0)
    _product(c, h, "Soap", "pcs", 10, 35.0)
    v = _voice(c, h, "2 kg sugar 90 rupees and 3 soap for 100")
    got = {m["name"]: (m["quantity"], m["total_price"], m["price_source"], m["needs_price_approval"]) for m in v["matched_items"]}
    # Sugar 2 kg at ₹90 vs catalogue ₹88 and soap 3 for ₹100 vs ₹105: both need approval
    assert got == {"Sugar": (2, 90.0, "spoken", True), "Soap": (3, 100.0, "spoken", True)}
    assert v["total"] == 190.0 and _sell(c, h, v["matched_items"])["total_amount"] == 190.0  # owner-approved


def test_incompatible_unit_is_not_billed(api):
    c, h = api
    _product(c, h, "Sugar", "kg", 10, 44.0)
    v = _voice(c, h, "2 liter sugar")
    assert v["matched_items"] == [] and "cannot be converted" in v["unmatched_items"][0]["reason"]
