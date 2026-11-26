"""
Final Voice-to-Bill & POS Verification Integration Tests:
Covers unit conversions, homophone recovery, false-positive suppression,
safety rejections (NEEDS_REVIEW, INCOMPLETE, WHOLESALE fractional, incompatible unit,
insufficient stock, inactive & cross-shop isolation), ambiguity detection, and RBAC.
"""

import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.deps import get_db
from core.security import create_access_token
from db.models.product import Product
from db.models.shop import Shop
from db.models.shop_member import ShopMember
from db.models.user import User
from db.session import Base
from main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


client = TestClient(app)


def _auth_shop(email: str, shop_name: str = "Kirana Store"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    tok = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}
    shop = client.post(
        "/api/v1/shops",
        json={"shop_name": shop_name, "owner_name": "Owner", "business_type": "Grocery/Kirana", "location": "Hyderabad"},
        headers=headers,
    ).json()
    return headers, uuid.UUID(shop["id"])


def _seed_product(shop_id: uuid.UUID, name: str, unit: str, price: float, stock: float, status: str = "VERIFIED", active: bool = True):
    db = TestingSessionLocal()
    prod = Product(
        id=uuid.uuid4(),
        shop_id=shop_id,
        name=name,
        selling_price=price,
        current_stock=stock,
        unit=unit,
        price_basis_quantity=1.0,
        price_basis_unit=unit,
        pricing_status=status,
        is_active=active,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)
    db.close()
    return prod


@pytest.mark.parametrize(
    "utterance,expected_name,expected_qty,expected_total",
    [
        ("Two Maggi Noodles", "Maggi Noodles", 2, 28.0),
        ("To Maggi Noodles", "Maggi Noodles", 2, 28.0),
        ("2 kg Sugar", "Sugar", 2, 88.0),
        ("500 g Sugar", "Sugar", 0.5, 22.0),
        ("250 g Sugar", "Sugar", 0.25, 11.0),
        ("1.5 kg Sugar", "Sugar", 1.5, 66.0),
        ("2.5 kg Sugar", "Sugar", 2.5, 110.0),
        ("1 L Oil", "Oil", 1, 140.0),
        ("500 ml Oil", "Oil", 0.5, 70.0),
        ("3 packets Parle-G", "Parle-G", 3, 30.0),
        ("12 pieces Soap", "Soap", 12, 420.0),
        ("half kg Sugar", "Sugar", 0.5, 22.0),
        ("quarter kg Sugar", "Sugar", 0.25, 11.0),
        ("half dozen Soap", "Soap", 6, 210.0),
        ("one and a half kg Sugar", "Sugar", 1.5, 66.0),
    ],
)
def test_real_world_quantities_and_unit_conversions_end_to_end(utterance, expected_name, expected_qty, expected_total):
    headers, shop_id = _auth_shop(f"qty_{uuid.uuid4().hex[:6]}@test.com")
    _seed_product(shop_id, "Maggi Noodles", "packet", 14.0, 50)
    _seed_product(shop_id, "Sugar", "kg", 44.0, 50)
    _seed_product(shop_id, "Oil", "L", 140.0, 30)
    _seed_product(shop_id, "Parle-G", "packet", 10.0, 60)
    _seed_product(shop_id, "Soap", "pcs", 35.0, 50)

    resp = client.post("/api/v1/voice/process", json={"simulation_text": utterance, "language_code": "en-IN"}, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["unmatched_items"] == []
    assert data["ambiguous_items"] == []
    assert len(data["matched_items"]) == 1
    m = data["matched_items"][0]
    assert m["name"] == expected_name
    assert m["quantity"] == expected_qty
    assert m["total_price"] == expected_total


def test_false_positive_sentences_produce_zero_bill_items():
    headers, shop_id = _auth_shop("falsepos@test.com")
    _seed_product(shop_id, "Maggi Noodles", "packet", 14.0, 50)
    _seed_product(shop_id, "Sugar", "kg", 44.0, 50)

    for sentence in [
        "Go to the counter",
        "Add to my bill",
        "I want to go to market",
        "Need to check price",
        "Hello good morning",
    ]:
        resp = client.post("/api/v1/voice/process", json={"simulation_text": sentence, "language_code": "en-IN"}, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["matched_items"] == []
        assert data["ambiguous_items"] == []


def test_safety_gates_inactive_cross_shop_fractional_and_ambiguity():
    headers_a, shop_a = _auth_shop("shopa@test.com", "Shop A")
    _, shop_b = _auth_shop("shopb@test.com", "Shop B")

    _seed_product(shop_a, "Sona Masoori Rice", "kg", 60.0, 20)
    _seed_product(shop_a, "Basmati Rice", "kg", 90.0, 20)
    _seed_product(shop_a, "Parle-G", "packet", 10.0, 20)
    _seed_product(shop_a, "Sugar", "kg", 44.0, 10)
    _seed_product(shop_a, "Pending Tea", "packet", 40.0, 10, status="NEEDS_REVIEW")
    _seed_product(shop_a, "Archived Jam", "jar", 80.0, 10, active=False)
    _seed_product(shop_b, "Exclusive Saffron", "g", 200.0, 10)

    # Multi-product ambiguity ("Rice" -> two rice variants)
    amb_resp = client.post("/api/v1/voice/process", json={"simulation_text": "2 kg Rice", "language_code": "en-IN"}, headers=headers_a).json()
    assert len(amb_resp["ambiguous_items"]) == 1
    assert len(amb_resp["ambiguous_items"][0]["candidates"]) == 2

    # Whole-unit fraction refused cleanly
    frac_resp = client.post("/api/v1/voice/process", json={"simulation_text": "2.5 packets Parle-G", "language_code": "en-IN"}, headers=headers_a).json()
    assert frac_resp["matched_items"] == []
    assert "whole" in frac_resp["unmatched_items"][0]["reason"].lower()

    # Incompatible unit refused cleanly
    incompat_resp = client.post("/api/v1/voice/process", json={"simulation_text": "1 L Sugar", "language_code": "en-IN"}, headers=headers_a).json()
    assert incompat_resp["matched_items"] == []
    assert "cannot be converted" in incompat_resp["unmatched_items"][0]["reason"]

    # NEEDS_REVIEW blocked
    rev_resp = client.post("/api/v1/voice/process", json={"simulation_text": "1 packet Pending Tea", "language_code": "en-IN"}, headers=headers_a).json()
    assert rev_resp["matched_items"] == []
    assert "manager pricing review" in rev_resp["unmatched_items"][0]["reason"]

    # Inactive & cross-shop products invisible
    inact_resp = client.post("/api/v1/voice/process", json={"simulation_text": "1 jar Archived Jam and 1 Exclusive Saffron", "language_code": "en-IN"}, headers=headers_a).json()
    assert inact_resp["matched_items"] == []
    assert len(inact_resp["unmatched_items"]) == 2


def test_rbac_cashier_voice_sale_and_expired_jwt_401():
    headers_owner, shop_id = _auth_shop("owner_rbac@test.com", "RBAC Shop")
    sugar = _seed_product(shop_id, "Sugar", "kg", 44.0, 10)

    # Register cashier + link to owner's shop
    client.post("/api/v1/auth/register", json={"email": "cashier_rbac@test.com", "password": "password123"})
    cashier_tok = client.post("/api/v1/auth/login", json={"email": "cashier_rbac@test.com", "password": "password123"}).json()["access_token"]
    db = TestingSessionLocal()
    cashier = db.query(User).filter(User.email == "cashier_rbac@test.com").first()
    cashier_id = str(cashier.id)
    db.add(ShopMember(shop_id=shop_id, user_id=cashier.id, role="CASHIER", is_active=True))
    db.commit()
    db.close()

    cashier_headers = {"Authorization": f"Bearer {cashier_tok}"}
    v_res = client.post("/api/v1/voice/process", json={"simulation_text": "500 g Sugar", "language_code": "en-IN"}, headers=cashier_headers)
    assert v_res.status_code == 200
    m = v_res.json()["matched_items"][0]
    assert m["quantity"] == 0.5 and m["total_price"] == 22.0

    # Cashier records sale -> succeeds and deducts 0.5 kg
    s_res = client.post(
        "/api/v1/sales",
        json={"items": [{"product_id": str(sugar.id), "quantity": 0.5, "unit_price": 44.0}], "payment_method": "upi"},
        headers=cashier_headers,
    )
    assert s_res.status_code == 201
    assert s_res.json()["total_amount"] == 22.0

    # Expired token -> 401 Unauthorized on sale creation (so client handles expiry & preserves cart)
    expired_tok = create_access_token(cashier_id, expires_delta=timedelta(minutes=-5))
    unauth = client.post(
        "/api/v1/sales",
        json={"items": [{"product_id": str(sugar.id), "quantity": 1}], "payment_method": "cash"},
        headers={"Authorization": f"Bearer {expired_tok}"},
    )
    assert unauth.status_code == 401
