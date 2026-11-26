"""
Capstone Semester-III QA: Non-OCR Backend Security, Transaction Atomicity,
Validation, Cross-Tenant Isolation, and Performance Verification Suite.
"""

from decimal import Decimal
import time
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
from db.models.supplier import Supplier
from api.deps import get_db

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


def register_login_shop(email: str, shop_name: str):
    r1 = client.post("/api/v1/auth/register", json={"email": email, "password": "Password123!"})
    assert r1.status_code == 201
    r2 = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    assert r2.status_code == 200
    token = r2.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    r3 = client.post(
        "/api/v1/shops",
        headers=headers,
        json={
            "shop_name": shop_name,
            "owner_name": "Owner QA",
            "business_type": "Grocery/Kirana",
            "location": "Hyderabad",
        },
    )
    assert r3.status_code == 201
    return uuid.UUID(r1.json()["id"]), uuid.UUID(r3.json()["id"]), headers


def create_verified_product(headers: dict, name: str, unit: str = "kg", stock: float = 20.0, price: float = 50.0):
    res = client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": name,
            "category": "Groceries",
            "unit": unit,
            "current_stock": stock,
            "selling_price": price,
            "purchase_price": round(price * 0.8, 2),
            "mrp": round(price * 1.2, 2),
            "reorder_level": 5,
            "pricing_status": "VERIFIED",
            "price_basis_quantity": 1.0,
            "price_basis_unit": unit,
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


# ---------------------------------------------------------------------------
# 1. Security: SQL Injection, XSS, Tampered Tokens, Oversized Payloads
# ---------------------------------------------------------------------------

def test_sql_injection_payloads_rejected_safely():
    """SQL injection strings in auth and search endpoints never execute SQL or cause 500."""
    _, _, headers = register_login_shop("sqli@example.com", "SQLi Safe Shop")
    create_verified_product(headers, "Basmati Rice", "kg", 25.0, 90.0)

    sqli_payloads = [
        "' OR '1'='1",
        "'; DROP TABLE products; --",
        "\" UNION SELECT * FROM users --",
        "%27%20OR%201%3D1--",
    ]
    for payload in sqli_payloads:
        r_login = client.post("/api/v1/auth/login", json={"email": payload, "password": payload})
        assert r_login.status_code in (400, 401, 422)

        r_prod = client.get("/api/v1/products", params={"search": payload}, headers=headers)
        assert r_prod.status_code == 200
        assert isinstance(r_prod.json()["items"], list)

        r_search = client.get("/api/v1/search", params={"q": payload}, headers=headers)
        assert r_search.status_code == 200

    # Verify products table intact after injection probes
    check_prod = client.get("/api/v1/products", headers=headers)
    assert check_prod.status_code == 200
    assert check_prod.json()["total"] == 1


def test_xss_and_oversized_payload_handling():
    """XSS strings and oversized inputs never crash the server (no 500)."""
    _, _, headers = register_login_shop("xss@example.com", "XSS Safe Shop")

    xss_name = "<script>alert('xss')</script> Sugar"
    res = client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": xss_name,
            "unit": "kg",
            "current_stock": 10,
            "selling_price": 45,
            "purchase_price": 35,
        },
    )
    assert res.status_code in (201, 400, 422)

    # Oversized search query & negative values
    oversized = "A" * 20000
    r_big = client.get("/api/v1/products", params={"search": oversized}, headers=headers)
    assert r_big.status_code in (200, 400, 422)

    r_neg = client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": "Negative Stock Item",
            "unit": "kg",
            "current_stock": -5,
            "selling_price": 50,
        },
    )
    assert r_neg.status_code in (400, 422)


def test_tampered_and_malformed_jwt_rejected():
    """Malformed, expired, or forged bearer tokens must return 401 Unauthorized."""
    for bad_token in ["not-a-jwt", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlIn0.bad", ""]:
        res = client.get(
            "/api/v1/products",
            headers={"Authorization": f"Bearer {bad_token}"} if bad_token else {},
        )
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# 2. Cross-Tenant Isolation Across All Non-OCR Modules
# ---------------------------------------------------------------------------

def test_complete_cross_tenant_isolation_non_ocr():
    """Shop A cannot read, update, delete, or sell Shop B's products, suppliers, or sales."""
    _, shop_a_id, headers_a = register_login_shop("tenant_a@example.com", "Shop Alpha")
    _, shop_b_id, headers_b = register_login_shop("tenant_b@example.com", "Shop Beta")

    prod_b = create_verified_product(headers_b, "Beta Secret Rice", "kg", 30.0, 100.0)
    sup_b = client.post(
        "/api/v1/suppliers",
        headers=headers_b,
        json={"supplier_name": "Beta Wholesale", "phone": "9998887776"},
    ).json()

    # Shop A cannot view, edit, or delete Shop B's product
    assert client.get(f"/api/v1/products/{prod_b['id']}", headers=headers_a).status_code in (403, 404)
    assert client.put(f"/api/v1/products/{prod_b['id']}", headers=headers_a, json={"selling_price": 1.0}).status_code in (403, 404)
    assert client.delete(f"/api/v1/products/{prod_b['id']}", headers=headers_a).status_code in (403, 404)

    # Shop A cannot sell Shop B's product
    sale_attempt = client.post(
        "/api/v1/sales",
        headers=headers_a,
        json={"items": [{"product_id": prod_b["id"], "quantity": 1, "unit": "kg"}], "payment_method": "cash"},
    )
    assert sale_attempt.status_code in (400, 403, 404)

    # Shop A cannot access Shop B's supplier or demand forecast for Shop B's product
    assert client.put(f"/api/v1/suppliers/{sup_b['id']}", headers=headers_a, json={"supplier_name": "Hacked"}).status_code in (403, 404)
    assert client.get(f"/api/v1/insights/demand-forecast?product_id={prod_b['id']}", headers=headers_a).status_code == 404


# ---------------------------------------------------------------------------
# 3. Transactional Atomicity & Rollback on Multi-Item Sale
# ---------------------------------------------------------------------------

def test_transactional_sale_rollback_prevents_partial_stock_deduction():
    """
    If line 1 succeeds (sufficient stock) and line 2 fails (insufficient stock),
    line 1's stock MUST be rolled back completely and zero sale rows committed.
    """
    _, _, headers = register_login_shop("atomic_qa@example.com", "Atomic Kirana")
    p1 = create_verified_product(headers, "Item One", "kg", 10.0, 50.0)
    p2 = create_verified_product(headers, "Item Two", "kg", 2.0, 80.0)

    bad_sale = client.post(
        "/api/v1/sales",
        headers=headers,
        json={
            "items": [
                {"product_id": p1["id"], "quantity": 3.0, "unit": "kg"},
                {"product_id": p2["id"], "quantity": 5.0, "unit": "kg"},  # exceeds stock 2.0
            ],
            "payment_method": "cash",
        },
    )
    assert bad_sale.status_code == 400

    # Confirm Item One stock remained untouched at 10.0
    p1_after = client.get(f"/api/v1/products/{p1['id']}", headers=headers).json()
    p2_after = client.get(f"/api/v1/products/{p2['id']}", headers=headers).json()
    assert p1_after["current_stock"] == 10.0
    assert p2_after["current_stock"] == 2.0

    # Confirm 0 sales recorded
    sales_after = client.get("/api/v1/sales", headers=headers).json()
    assert sales_after["total"] == 0


# ---------------------------------------------------------------------------
# 4. Performance Latency Baseline Measurement (Non-OCR Endpoints)
# ---------------------------------------------------------------------------

def test_non_ocr_api_response_latency_baseline():
    """Measures actual latency across core non-OCR endpoints to detect slow paths."""
    _, _, headers = register_login_shop("perf_qa@example.com", "Perf Kirana")
    for idx in range(15):
        create_verified_product(headers, f"Product {idx}", "kg", 25.0, 50.0 + idx)

    timings = {}
    endpoints = [
        ("health", "/api/v1/health", None),
        ("products", "/api/v1/products", headers),
        ("dashboard", "/api/v1/dashboard", headers),
        ("insights_sales", "/api/v1/insights/sales?period=7d", headers),
        ("insights_inventory", "/api/v1/insights/inventory", headers),
        ("demand_forecast", "/api/v1/insights/demand-forecast", headers),
        ("notifications", "/api/v1/notifications", headers),
    ]
    for name, url, hdrs in endpoints:
        t0 = time.perf_counter()
        res = client.get(url, headers=hdrs or {})
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        assert res.status_code == 200, f"{name} returned {res.status_code}"
        timings[name] = elapsed_ms
        # Every local API endpoint should respond comfortably under 1000ms
        assert elapsed_ms < 1000, f"{name} exceeded 1000ms ({elapsed_ms}ms)"

    print("PERF_TIMINGS_MS:", timings)
