"""
Stage 3C: Pricing Basis Authorization, Compatibility Validation & Audit Trail Tests.

Covers all required matrix scenarios against an isolated in-memory SQLite database:
- Owner and Manager approved updates to pricing basis / MRP basis / unit on VERIFIED products
- Cashier blocked (403) from mutating any of selling_price, mrp, price_basis_quantity,
  price_basis_unit, mrp_basis_quantity, mrp_basis_unit, unit on VERIFIED products
- Cashier allowed to edit non-pricing fields (stock/name) on VERIFIED products when basis/unit unchanged
- Unverified (NEEDS_REVIEW) product updates follow existing rules without bypassing validation
- Incompatible inventory/pricing/MRP units and unknown/empty/null units rejected (400)
- Zero, negative, null, NaN/Inf, malformed basis quantities rejected (400 / 422 / ValueError)
- Immutable PricingAuditLog captures product_id, shop_id, acting_user_id, action_type,
  previous/new values, and created_at timestamp
- Cross-shop tenant isolation enforced (403, zero mutation)
"""

import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from db.session import Base
from db.models.user import User
from db.models.product import Product
from db.models.pricing_audit_log import PricingAuditLog
from api.deps import get_db
from schemas.product import ProductUpdate
from services.product import update_product as service_update_product

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


def create_user_and_token(email: str, password: str = "password123") -> tuple[uuid.UUID, dict]:
    reg = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert reg.status_code in (200, 201), reg.text
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        return user.id, headers
    finally:
        db.close()


def create_shop_for_user(headers: dict, shop_name: str = "Stage 3C Kirana") -> uuid.UUID:
    res = client.post(
        "/api/v1/shops",
        json={
            "shop_name": shop_name,
            "owner_name": "Shop Owner",
            "business_type": "Grocery/Kirana",
            "location": "Hyderabad",
        },
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return uuid.UUID(res.json()["id"])


def setup_shop_with_staff_and_verified_product(prefix: str):
    owner_id, owner_headers = create_user_and_token(f"{prefix}_owner@test.com")
    shop_id = create_shop_for_user(owner_headers, f"{prefix} Shop")

    manager_id, manager_headers = create_user_and_token(f"{prefix}_mgr@test.com")
    cashier_id, cashier_headers = create_user_and_token(f"{prefix}_cashier@test.com")

    res_m = client.post(
        f"/api/v1/shops/{shop_id}/members",
        json={"user_id": str(manager_id), "role": "MANAGER"},
        headers=owner_headers,
    )
    assert res_m.status_code == 201, res_m.text
    res_c = client.post(
        f"/api/v1/shops/{shop_id}/members",
        json={"user_id": str(cashier_id), "role": "CASHIER"},
        headers=owner_headers,
    )
    assert res_c.status_code == 201, res_c.text

    prod_res = client.post(
        "/api/v1/products",
        json={
            "name": "Toor Dal Premium",
            "selling_price": 140.0,
            "mrp": 180.0,
            "unit": "kg",
            "price_basis_quantity": 1.0,
            "price_basis_unit": "kg",
            "mrp_basis_quantity": 1.0,
            "mrp_basis_unit": "kg",
            "current_stock": 50.0,
            "pricing_status": "VERIFIED",
        },
        headers=owner_headers,
    )
    assert prod_res.status_code == 201, prod_res.text
    prod_id = prod_res.json()["id"]

    return {
        "shop_id": shop_id,
        "owner_id": owner_id,
        "owner_headers": owner_headers,
        "manager_id": manager_id,
        "manager_headers": manager_headers,
        "cashier_id": cashier_id,
        "cashier_headers": cashier_headers,
        "product_id": prod_id,
    }


def test_owner_can_update_pricing_basis_and_records_audit():
    ctx = setup_shop_with_staff_and_verified_product("own_basis")
    prod_id = ctx["product_id"]

    # Owner changes basis from 1 kg -> 1000 g (preserving SP <= MRP)
    res = client.put(
        f"/api/v1/products/{prod_id}",
        json={"price_basis_quantity": 1000.0, "price_basis_unit": "g"},
        headers=ctx["owner_headers"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["price_basis_quantity"] == 1000.0
    assert body["price_basis_unit"] == "g"
    assert body["pricing_status"] == "VERIFIED"

    trail = client.get(f"/api/v1/products/{prod_id}/audit-trail", headers=ctx["owner_headers"])
    assert trail.status_code == 200
    logs = trail.json()
    assert len(logs) == 2
    basis_logs = [entry for entry in logs if entry["action_type"] == "PRICING_BASIS_UPDATE"]
    assert len(basis_logs) == 1
    latest = basis_logs[0]
    assert latest["shop_id"] == str(ctx["shop_id"])
    assert latest["product_id"] == prod_id
    assert latest["acting_user_id"] == str(ctx["owner_id"])
    assert latest["previous_status"] == "VERIFIED"
    assert latest["new_status"] == "VERIFIED"
    assert latest["created_at"] is not None
    assert "price_basis_quantity: 1.0 -> 1000.0" in latest["reason"]
    assert "price_basis_unit: 'kg' -> 'g'" in latest["reason"]


def test_manager_can_update_unit_and_basis_together_and_audits():
    ctx = setup_shop_with_staff_and_verified_product("mgr_basis")
    prod_id = ctx["product_id"]

    # Manager re-bases kg product to g inventory + pricing + MRP basis consistently
    res = client.put(
        f"/api/v1/products/{prod_id}",
        json={
            "unit": "g",
            "price_basis_quantity": 1000.0,
            "price_basis_unit": "g",
            "mrp_basis_quantity": 1000.0,
            "mrp_basis_unit": "g",
            "current_stock": 50000.0,
        },
        headers=ctx["manager_headers"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["unit"] == "g"
    assert body["price_basis_unit"] == "g"
    assert body["mrp_basis_unit"] == "g"

    db = TestingSessionLocal()
    try:
        logs = (
            db.query(PricingAuditLog)
            .filter(
                PricingAuditLog.product_id == uuid.UUID(prod_id),
                PricingAuditLog.action_type == "PRICING_BASIS_UPDATE",
            )
            .all()
        )
        assert len(logs) == 1
        log = logs[0]
        assert log.acting_user_id == ctx["manager_id"]
        assert log.shop_id == ctx["shop_id"]
        assert "unit: 'kg' -> 'g'" in log.reason
        assert "price_basis_quantity: 1.0 -> 1000.0" in log.reason
        assert "mrp_basis_unit: 'kg' -> 'g'" in log.reason
    finally:
        db.close()


@pytest.mark.parametrize(
    "payload",
    [
        {"price_basis_quantity": 0.5},
        {"price_basis_unit": "g"},
        {"mrp_basis_quantity": 2.0},
        {"mrp_basis_unit": "g"},
        {"unit": "g"},
        {"selling_price": 135.0},
        {"mrp": 175.0},
    ],
)
def test_cashier_blocked_from_all_verified_pricing_interpretation_fields(payload):
    ctx = setup_shop_with_staff_and_verified_product("cashier_blk")
    prod_id = ctx["product_id"]

    res = client.put(f"/api/v1/products/{prod_id}", json=payload, headers=ctx["cashier_headers"])
    assert res.status_code == 403, res.text
    assert "Manager or Owner role required" in res.json()["detail"]

    db = TestingSessionLocal()
    try:
        prod = db.query(Product).filter(Product.id == uuid.UUID(prod_id)).first()
        assert prod.unit == "kg"
        assert prod.price_basis_quantity == 1.0
        assert prod.price_basis_unit == "kg"
        assert prod.mrp_basis_quantity == 1.0
        assert prod.mrp_basis_unit == "kg"
        assert prod.selling_price == 140.0
        assert prod.mrp == 180.0
        # Only initial VERIFY_PRICING audit log should exist
        assert db.query(PricingAuditLog).filter(PricingAuditLog.product_id == prod.id).count() == 1
    finally:
        db.close()


def test_cashier_can_update_non_pricing_fields_on_verified_product_without_false_block():
    ctx = setup_shop_with_staff_and_verified_product("cashier_ok")
    prod_id = ctx["product_id"]

    # Sending unchanged basis/unit values alongside stock/name update must still succeed
    res = client.put(
        f"/api/v1/products/{prod_id}",
        json={
            "name": "Toor Dal Gold",
            "current_stock": 45.0,
            "unit": "kg",
            "price_basis_quantity": 1.0,
            "price_basis_unit": "kg",
            "mrp_basis_quantity": 1.0,
            "mrp_basis_unit": "kg",
            "selling_price": 140.0,
            "mrp": 180.0,
        },
        headers=ctx["cashier_headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "Toor Dal Gold"
    assert res.json()["current_stock"] == 45.0

    db = TestingSessionLocal()
    try:
        assert db.query(PricingAuditLog).filter(PricingAuditLog.product_id == uuid.UUID(prod_id)).count() == 1
    finally:
        db.close()


def test_unverified_product_preserves_existing_update_rules_and_audits_basis():
    owner_id, owner_headers = create_user_and_token("unv_owner@test.com")
    shop_id = create_shop_for_user(owner_headers, "Unverified Shop")
    cashier_id, cashier_headers = create_user_and_token("unv_cashier@test.com")
    client.post(
        f"/api/v1/shops/{shop_id}/members",
        json={"user_id": str(cashier_id), "role": "CASHIER"},
        headers=owner_headers,
    )

    prod_res = client.post(
        "/api/v1/products",
        json={
            "name": "Loose Sugar",
            "selling_price": 45.0,
            "unit": "kg",
            "price_basis_quantity": 1.0,
            "price_basis_unit": "kg",
            "current_stock": 30.0,
        },
        headers=owner_headers,
    )
    assert prod_res.status_code == 201
    prod_id = prod_res.json()["id"]
    assert prod_res.json()["pricing_status"] == "NEEDS_REVIEW"

    # Existing rule: Cashier can edit unverified product, status stays NEEDS_REVIEW, basis change audited
    res = client.put(
        f"/api/v1/products/{prod_id}",
        json={"price_basis_quantity": 500.0, "price_basis_unit": "g", "pricing_status": "VERIFIED"},
        headers=cashier_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["pricing_status"] == "NEEDS_REVIEW"
    assert res.json()["price_basis_quantity"] == 500.0
    assert res.json()["price_basis_unit"] == "g"

    trail = client.get(f"/api/v1/products/{prod_id}/audit-trail", headers=owner_headers)
    assert trail.status_code == 200
    logs = trail.json()
    assert len(logs) == 1
    assert logs[0]["action_type"] == "PRICING_BASIS_UPDATE"
    assert logs[0]["acting_user_id"] == str(cashier_id)


@pytest.mark.parametrize(
    "payload,needle",
    [
        ({"price_basis_unit": "g"}, "incompatible"),  # packet stock vs g basis
        ({"price_basis_unit": "unknown_unit"}, "not a registered unit"),
        ({"price_basis_unit": ""}, "missing"),
        ({"price_basis_unit": None}, "missing"),
        ({"unit": "kg"}, "incompatible"),  # kg stock vs packet basis
        ({"unit": ""}, "missing"),
        ({"unit": None}, "missing"),
        ({"mrp_basis_unit": "ml"}, "incompatible"),  # packet basis vs ml MRP basis
        ({"mrp_basis_unit": "badunit"}, "not a registered unit"),
    ],
)
def test_invalid_or_incompatible_units_rejected(payload, needle):
    _, owner_headers = create_user_and_token("inv_u_owner@test.com")
    create_shop_for_user(owner_headers, "Unit Check Shop")

    prod_res = client.post(
        "/api/v1/products",
        json={
            "name": "Biscuit Pack",
            "selling_price": 20.0,
            "mrp": 25.0,
            "unit": "packet",
            "price_basis_quantity": 1.0,
            "price_basis_unit": "packet",
            "mrp_basis_quantity": 1.0,
            "mrp_basis_unit": "packet",
            "current_stock": 10,
            "pricing_status": "VERIFIED",
        },
        headers=owner_headers,
    )
    assert prod_res.status_code == 201
    prod_id = prod_res.json()["id"]

    res = client.put(f"/api/v1/products/{prod_id}", json=payload, headers=owner_headers)
    assert res.status_code == 400, res.text
    assert needle.lower() in res.json()["detail"].lower()

    db = TestingSessionLocal()
    try:
        prod = db.query(Product).filter(Product.id == uuid.UUID(prod_id)).first()
        assert prod.unit == "packet"
        assert prod.price_basis_unit == "packet"
        assert prod.mrp_basis_unit == "packet"
    finally:
        db.close()


@pytest.mark.parametrize(
    "payload",
    [
        {"price_basis_quantity": 0},
        {"price_basis_quantity": -1.5},
        {"price_basis_quantity": "abc"},
        {"price_basis_quantity": None},
        {"mrp_basis_quantity": 0},
        {"mrp_basis_quantity": -2.0},
        {"mrp_basis_quantity": None},
        {"selling_price": 0.0},
        {"selling_price": -10.0},
    ],
)
def test_invalid_quantities_or_prices_rejected(payload):
    ctx = setup_shop_with_staff_and_verified_product("qty_bad")
    prod_id = ctx["product_id"]

    res = client.put(f"/api/v1/products/{prod_id}", json=payload, headers=ctx["owner_headers"])
    assert res.status_code in (400, 422), res.text

    db = TestingSessionLocal()
    try:
        prod = db.query(Product).filter(Product.id == uuid.UUID(prod_id)).first()
        assert prod.price_basis_quantity == 1.0
        assert prod.mrp_basis_quantity == 1.0
        assert prod.selling_price == 140.0
    finally:
        db.close()


def test_service_layer_rejects_nan_infinity_and_negative_basis_quantity():
    ctx = setup_shop_with_staff_and_verified_product("svc_nan")
    prod_id = uuid.UUID(ctx["product_id"])

    db = TestingSessionLocal()
    try:
        prod = db.query(Product).filter(Product.id == prod_id).first()
        for bad_val in [float("nan"), float("inf"), 0.0, -0.5]:
            update_obj = ProductUpdate.model_construct(price_basis_quantity=bad_val)
            with pytest.raises(ValueError):
                service_update_product(db, prod, update_obj, acting_user_id=ctx["owner_id"])
    finally:
        db.close()


def test_cross_shop_tenant_isolation_blocks_pricing_basis_modification():
    ctx = setup_shop_with_staff_and_verified_product("iso_a")
    prod_a_id = ctx["product_id"]

    _, owner_b_headers = create_user_and_token("iso_b_owner@test.com")
    create_shop_for_user(owner_b_headers, "Shop B")

    res = client.put(
        f"/api/v1/products/{prod_a_id}",
        json={"price_basis_quantity": 0.25, "price_basis_unit": "g"},
        headers=owner_b_headers,
    )
    assert res.status_code == 403, res.text

    trail_res = client.get(f"/api/v1/products/{prod_a_id}/audit-trail", headers=owner_b_headers)
    assert trail_res.status_code == 403

    db = TestingSessionLocal()
    try:
        prod = db.query(Product).filter(Product.id == uuid.UUID(prod_a_id)).first()
        assert prod.price_basis_quantity == 1.0
        assert prod.price_basis_unit == "kg"
    finally:
        db.close()
