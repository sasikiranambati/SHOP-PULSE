"""
Decimal-safe backend money (Phase 4, workstream 4). Approved rules: Decimal from strings, ROUND_HALF_UP,
no intermediate rounding, sale line rounded to 2 dp and bill = sum of lines, purchase values keep up to
3 dp, plain JSON numbers at the API. Historical records are never rewritten.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from services.money import (
    bill_total, format_rupees, keep_printed_precision, round_currency, round_price, sale_line_amount, sum_decimal,
    to_decimal, to_number,
)

D = Decimal

# ------------------------------------------------------------------------------------- money module


@pytest.mark.parametrize("value,expected", [("1.005", "1.01"), ("2.675", "2.68"), ("0.125", "0.13"),
                                            ("10.245", "10.25"), ("33.375", "33.38"), ("100.005", "100.01")])
def test_currency_rounding_is_half_up(value, expected):
    assert round_currency(D(value)) == D(expected)


def test_decimal_from_float_goes_through_its_text():
    assert to_decimal(0.1) == D("0.1") and to_decimal(0.1) + to_decimal(0.2) == D("0.3")
    assert sum_decimal([0.1, 0.2]) == D("0.30")
    assert to_decimal(float("nan")) is None and to_decimal(True) is None and to_decimal("x") is None


def test_line_and_bill_rules():
    assert sale_line_amount(D("2.500"), D("120.000")) == D("300.00")
    assert sale_line_amount("0.750", "44.500") == D("33.38")  # 33.375 -> 33.38
    assert bill_total([D("300.00"), D("33.38")]) == D("333.38")
    assert sale_line_amount(3, "33.335") == D("100.01")
    assert keep_printed_precision(D(12) * D("5.249")) == D("62.988")  # purchase side keeps 3 dp
    assert D(2500) * D("0.125") == D("312.500")  # no intermediate rounding of a per-gram rate
    assert round_price(D(100) / 3) == D("33.333")
    assert to_number(D("0.30")) == 0.3 and isinstance(to_number(D("1.01")), float)


def test_rupee_formatting_is_half_up_and_keeps_a_printed_third_decimal():
    assert format_rupees("1.005") == "₹1.005" and format_rupees("1.0049") == "₹1.005"
    assert format_rupees("1234.5") == "₹1,234.50" and format_rupees(None) == "₹—"


# ------------------------------------------------------------------------------------- API (in-memory DB)

_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(bind=_engine)


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
    email = f"dec{uuid.uuid4().hex[:8]}@example.com"
    c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    h = {"Authorization": "Bearer " + c.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]}
    c.post("/api/v1/shops", json={"shop_name": "K", "owner_name": "R", "business_type": "Grocery/Kirana", "location": "B"}, headers=h)
    yield c, h
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)


def _product(c, h, name, price=10.0, stock=1000):
    r = c.post("/api/v1/products", json={"name": name, "selling_price": price, "purchase_price": price,
                                         "current_stock": stock, "unit": "pcs"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _sellable(c, h, name, price):
    """A valid retail product at this catalogue price, verified by the shop owner (Stage 4: the catalogue
    price is authoritative and only verified products can be sold)."""
    from tests.pricing_helpers import verify_product
    pid = _product(c, h, name, price=price)
    verify_product(c, h, pid)
    return pid


def _set_price(c, h, pid, price):
    """The owner changes the catalogue price between sales (allowed for a verified product, and audited)."""
    r = c.put(f"/api/v1/products/{pid}", json={"selling_price": price}, headers=h)
    assert r.status_code == 200, r.text


def _sale(c, h, lines):
    r = c.post("/api/v1/sales", json={"items": [{"product_id": p, "quantity": q, "unit_price": u} for p, q, u in lines]},
               headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def test_purchase_totals(api):
    c, h = api
    a, b = _product(c, h, "Item A"), _product(c, h, "Item B")
    r = c.post("/api/v1/purchases", json={"items": [{"product_id": a, "quantity": 1, "purchase_price": 0.1},
                                                    {"product_id": b, "quantity": 1, "purchase_price": 0.2}]}, headers=h)
    assert r.status_code == 201 and r.json()["total_amount"] == 0.3  # was 0.30000000000000004
    r = c.post("/api/v1/purchases", json={"items": [{"product_id": a, "quantity": 12, "purchase_price": 5.249}]}, headers=h)
    assert r.json()["total_amount"] == 62.988  # printed precision kept


@pytest.mark.parametrize("lines,expected", [
    ([(1, 3, 0.1)], 0.3),                          # was 0.30000000000000004
    ([(1, 3, 33.335)], 100.01),                    # line 100.005 -> 100.01 (was 100.005)
    ([(1, 1, 1.005), (2, 1, 2.675)], 3.69),        # 1.01 + 2.68 (was 3.6799999999999997)
    ([(1, 2, 19.995), (2, 3, 0.335), (3, 1, 7.5)], 48.5),  # 39.99 + 1.01 + 7.50
])
def test_sale_lines_are_rounded_and_summed(api, lines, expected):
    c, h = api
    # Each product is sold at its catalogue price (the client price is only an assertion since Stage 4)
    ids = {n: _sellable(c, h, f"P{n}", u) for n, _, u in lines}
    body = _sale(c, h, [(ids[n], q, u) for n, q, u in lines])
    assert body["total_amount"] == expected and isinstance(body["total_amount"], float)
    # unit prices are stored as given (3-dp precision kept); response shape unchanged
    assert sorted(i["unit_price"] for i in body["items"]) == sorted(u for _, _, u in lines)
    assert set(body) >= {"id", "total_amount", "payment_method", "items"}


def test_voice_bill_total_is_reproduced_by_the_sale(api):
    c, h = api
    tea = _sellable(c, h, "Tea Packet", 40.0)
    r = c.post("/api/v1/voice/process", json={"simulation_text": "3 tea packet 100 rupees"}, headers=h)
    item = r.json()["matched_items"][0]
    assert (item["quantity"], item["total_price"], item["unit_price"]) == (3, 100.0, 33.333)
    assert r.json()["total"] == 100.0 and r.json()["subtotal"] == 100.0
    # Stage 4C.1 Decision 1: ₹100 differs from the catalogue ₹120, so it is a requested price the owner approves
    assert item["needs_price_approval"] is True
    r = c.post("/api/v1/sales", json={"items": [{"product_id": tea, "quantity": item["quantity"],
                                                 "requested_line_total": item["total_price"]}]}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["total_amount"] == 100.0  # was 99.99


@pytest.mark.parametrize("qty,spoken", [(3, "100"), (30, "100"), (7, "50"), (12, "99.99"), (1, "45.5")])
def test_voice_exact_unit_price_reproduces_any_spoken_total(qty, spoken):
    from schemas.voice import VoiceProductCandidate
    from services.inventory_matcher import make_matched_item
    from services.voice_parser import ExtractedItem

    prod = VoiceProductCandidate(id="p", name="Item", selling_price=10.0, current_stock=999, unit="pcs")
    m = make_matched_item(prod, ExtractedItem(name="item", quantity=qty, spoken_price=float(spoken)))
    assert m.total_price == float(D(spoken))
    assert sale_line_amount(qty, m.unit_price_exact) == D(spoken).quantize(D("0.01"))
    assert m.unit_price == float(round_price(D(spoken) / qty))


def test_voice_without_spoken_price_uses_the_selling_price():
    from schemas.voice import VoiceProductCandidate
    from services.inventory_matcher import make_matched_item
    from services.voice_parser import ExtractedItem

    prod = VoiceProductCandidate(id="p", name="Item", selling_price=33.335, current_stock=999, unit="pcs")
    m = make_matched_item(prod, ExtractedItem(name="item", quantity=3))
    assert (m.unit_price, m.unit_price_exact, m.total_price) == (33.335, 33.335, 100.01)


def test_reports_use_decimal_and_the_same_line_rule(api):
    c, h = api
    a, b = _sellable(c, h, "Report A", 0.1), _sellable(c, h, "Report B", 1.005)
    _sale(c, h, [(a, 3, 0.1)])
    _set_price(c, h, a, 33.335)
    _sale(c, h, [(a, 3, 33.335), (b, 1, 1.005)])
    dash = c.get("/api/v1/dashboard", headers=h).json()
    assert dash["today_sales"] == 101.32  # 0.30 + (100.01 + 1.01)
    ins = c.get("/api/v1/insights/sales?period=7d", headers=h).json()
    assert ins["overview"]["total_sales"] == 101.32 and ins["overview"]["transaction_count"] == 2
    assert ins["overview"]["average_transaction_value"] == 50.66
    perf = {p["product_name"]: p["revenue"] for p in ins["performance"]["best_selling"]}
    assert perf["Report A"] == 100.31 and perf["Report B"] == 1.01  # per-line rounded, matches the bills
    assert sum(p["revenue"] for p in ins["trends"]["points"]) == 101.32


def test_daily_notification_total(api):
    c, h = api
    a = _sellable(c, h, "Notify A", 1.005)
    _sale(c, h, [(a, 1, 1.005)])
    _set_price(c, h, a, 2.675)
    _sale(c, h, [(a, 1, 2.675)])
    assert c.post("/api/v1/notifications/trigger-evaluation", headers=h).status_code == 200
    notes = c.get("/api/v1/notifications", headers=h).json()["items"]
    summary = [n["message"] for n in notes if n["title"] == "Daily Sales Summary"]
    assert summary and "₹3.69" in summary[0]


def test_historical_records_are_never_rewritten(api):
    """A sale stored before this change (unrounded float total) stays exactly as stored."""
    c, h = api
    from db.models.sale import Sale
    from db.models.shop import Shop

    pid = _sellable(c, h, "Hist A", 33.335)
    s = _Session()
    shop = s.query(Shop).first()
    old = Sale(shop_id=shop.id, total_amount=100.005, payment_method="cash", created_at=datetime.now(timezone.utc))
    s.add(old)
    s.commit()
    old_id = str(old.id)
    s.close()
    _sale(c, h, [(pid, 3, 33.335)])  # a new sale: 100.01
    assert c.get(f"/api/v1/sales/{old_id}", headers=h).json()["total_amount"] == 100.005
    s = _Session()
    assert s.get(Sale, old.id).total_amount == 100.005
    s.close()
    # reports sum the stored values (old 100.005 + new 100.01 = 200.015 -> 200.02), nothing is recalculated
    assert c.get("/api/v1/dashboard", headers=h).json()["today_sales"] == 200.02


# ------------------------------------------------------------------------------------- invoice side (F8 - F10)


@pytest.mark.parametrize("value,expected", [("₹49.995", 49.995), ("289.00", 289.0), (2.675, 2.675), ("1,250.5", 1250.5),
                                            ("1.0049", 1.005), ("0", None), ("abc", None)])
def test_mrp_keeps_a_printed_third_decimal(value, expected):
    from services.mrp_lookup import validate_mrp_value

    assert validate_mrp_value(value) == expected


def test_printed_total_fallback_is_parsed_without_float():
    from services.invoice import extract_metadata

    assert extract_metadata(["Item Qty Rate Amount", "Grand Total ₹1,210.565"], None)["invoice_total"] == 1210.565
    assert extract_metadata(["Item Qty Rate Amount", "Net Amount 557.20"], None)["invoice_total"] == 557.2


def test_misread_rate_keeps_three_decimals():
    from services.invoice import suggest_misread_decimal_rate

    assert suggest_misread_decimal_rate("58575", 4, 234.30) == 58.575  # 4 x 58.575 = 234.30
    assert suggest_misread_decimal_rate("1250", 2, 25.00) == 12.5
    assert suggest_misread_decimal_rate("125", 2, 999.0) is None


def test_validation_engine_rounds_once_half_up():
    from services.grocery_ocr.financial.calculation_engine import FinancialCalculationEngine

    eng = FinancialCalculationEngine()
    r = eng.calculate_line_item(quantity=D(12), unit_rate=D("5.249"), printed_amount=D("62.99"))
    assert r.calculated_amount == D("62.99") and r.is_arithmetic_match  # 62.988 rounded once
    r = eng.calculate_line_item(quantity=D(1), unit_rate=D("1.005"), printed_amount=D("1.01"))
    assert r.calculated_amount == D("1.01")  # half-up (half-even would give 1.00)
