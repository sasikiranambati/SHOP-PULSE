import unittest.mock as mock
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import httpx

from main import app
from db.session import Base
import db.models
from api.deps import get_db
from services.openmrp_client import OpenMRPClient, redact_secrets

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

def get_authenticated_headers(email: str = "lookup_owner@example.com") -> dict:
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/v1/shops", json={
        "shop_name": "Lookup Kirana",
        "owner_name": "Kirana Owner",
        "business_type": "Grocery/Kirana",
        "location": "Market Yard"
    }, headers=headers)
    return headers


# =========================================================================
# 1. Product Lookup Tests (Local Shop Inventory & Ambiguity Handling)
# =========================================================================

def test_successful_product_lookup_by_barcode():
    """Exact barcode match from shop inventory returns purchase price, selling price, and verified MRP."""
    headers = get_authenticated_headers("barcode_test@example.com")
    # Seed product with barcode and verified MRP
    create_res = client.post("/api/v1/products", json={
        "name": "Tata Tea Gold 500g",
        "category": "Beverages",
        "selling_price": 310.0,
        "purchase_price": 270.0,
        "mrp": 320.0,
        "current_stock": 15,
        "unit": "g",
        "sku": "8901052002345"
    }, headers=headers)
    assert create_res.status_code == 201
    prod_id = create_res.json()["id"]

    # Lookup by barcode
    lookup_res = client.get("/api/v1/products/lookup?barcode=8901052002345", headers=headers)
    assert lookup_res.status_code == 200
    data = lookup_res.json()
    assert data["found"] is True
    assert data["name"] == "Tata Tea Gold 500g"
    assert data["purchase_price"] == 270.0
    assert data["selling_price"] == 310.0
    assert data["mrp"] == 320.0
    assert data["source"] == "SHOP_INVENTORY"
    assert data["matched_product_id"] == prod_id
    assert data["confidence"] == 1.0


def test_missing_mrp_preserves_none():
    """When a product does not have an MRP recorded, MRP must remain null and not be fabricated."""
    headers = get_authenticated_headers("no_mrp_test@example.com")
    create_res = client.post("/api/v1/products", json={
        "name": "Local Loose Jaggery 1kg",
        "category": "Groceries",
        "selling_price": 60.0,
        "purchase_price": 48.0,
        "current_stock": 50,
        "unit": "kg",
        "sku": "JAGGERY-1KG"
    }, headers=headers)
    assert create_res.status_code == 201

    lookup_res = client.get("/api/v1/products/lookup?barcode=JAGGERY-1KG", headers=headers)
    assert lookup_res.status_code == 200
    data = lookup_res.json()
    assert data["found"] is True
    assert data["purchase_price"] == 48.0
    assert data["selling_price"] == 60.0
    # Must be None, never substituted by purchase_price or selling_price
    assert data["mrp"] is None


def test_product_not_found():
    """Unregistered product returns found=False with clean diagnostic notes."""
    headers = get_authenticated_headers("not_found_test@example.com")
    lookup_res = client.get("/api/v1/products/lookup?barcode=9999999999999", headers=headers)
    assert lookup_res.status_code == 200
    data = lookup_res.json()
    assert data["found"] is False
    assert data["source"] in ("NONE", "OPENMRP_CATALOG")
    assert data["mrp"] is None
    assert data["purchase_price"] is None


def test_ambiguous_product_matches_rejected():
    """Ambiguous or conflicting product matches are rejected rather than picking arbitrarily."""
    headers = get_authenticated_headers("ambiguity_test@example.com")
    # Add two similar variants
    client.post("/api/v1/products", json={
        "name": "Britannia Good Day Butter 100g",
        "selling_price": 30.0,
        "purchase_price": 25.0,
        "current_stock": 10,
    }, headers=headers)
    client.post("/api/v1/products", json={
        "name": "Britannia Good Day Cashew 100g",
        "selling_price": 35.0,
        "purchase_price": 28.0,
        "current_stock": 10,
    }, headers=headers)

    # Search term 'Britannia Good Day' is ambiguous
    lookup_res = client.get("/api/v1/products/lookup?name=Britannia Good Day", headers=headers)
    assert lookup_res.status_code == 200
    data = lookup_res.json()
    # Ambiguous search without clear lead is rejected
    assert data["found"] is False


# =========================================================================
# 2. OpenMRP Client & Network Failure Tests (Mocked External API)
# =========================================================================

def test_openmrp_client_successful_lookup():
    """OpenMRP client searches account catalog and parses manufacturing rates (mrp is None)."""
    mock_payload = {
        "data": [
            {
                "id": "prod_12345",
                "type": "sale",
                "item": {
                    "sku": "WIDGET-01",
                    "description": "Industrial Fastener M8",
                    "unit_cost": {"rate": 45.0, "currency": "INR"},
                    "unit_value": {"rate": 60.0, "currency": "INR"}
                }
            }
        ]
    }
    test_client = OpenMRPClient(api_key="mrp_sk_test_dummy_key_for_testing")
    with mock.patch("httpx.Client.get") as mock_get:
        mock_resp = mock.MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_payload
        mock_get.return_value = mock_resp

        res = test_client.search_products("WIDGET-01")
        assert res["success"] is True
        assert len(res["items"]) == 1
        item = res["items"][0]
        assert item["name"] == "Industrial Fastener M8"
        assert item["unit_cost"] == 45.0
        assert item["unit_value"] == 60.0
        # Critical verification: OpenMRP is manufacturing ERP, MRP is None
        assert item["mrp"] is None


def test_openmrp_client_authentication_failure():
    """HTTP 401 returns graceful error without exposing secret credentials."""
    test_client = OpenMRPClient(api_key="mrp_sk_test_invalid_secret")
    with mock.patch("httpx.Client.get") as mock_get:
        mock_resp = mock.MagicMock()
        mock_resp.status_code = 401
        mock_get.return_value = mock_resp

        res = test_client.search_products("AnyItem")
        assert res["success"] is False
        assert res["error"] == "AUTHENTICATION_FAILED"
        assert "mrp_sk_test_" not in res["message"]


def test_openmrp_client_timeout():
    """Network timeouts return structured TIMEOUT status."""
    test_client = OpenMRPClient(api_key="mrp_sk_test_dummy")
    with mock.patch("httpx.Client.get", side_effect=httpx.TimeoutException("Connection timed out")):
        res = test_client.search_products("SlowProduct")
        assert res["success"] is False
        assert res["error"] == "TIMEOUT"


def test_openmrp_client_rate_limiting():
    """HTTP 429 returns structured RATE_LIMITED status."""
    test_client = OpenMRPClient(api_key="mrp_sk_test_dummy")
    with mock.patch("httpx.Client.get") as mock_get:
        mock_resp = mock.MagicMock()
        mock_resp.status_code = 429
        mock_get.return_value = mock_resp

        res = test_client.search_products("RateLimitedProduct")
        assert res["success"] is False
        assert res["error"] == "RATE_LIMITED"


def test_openmrp_client_network_unavailable():
    """Connection errors return gracefully with CONNECTION_ERROR."""
    test_client = OpenMRPClient(api_key="mrp_sk_test_dummy")
    with mock.patch("httpx.Client.get", side_effect=httpx.ConnectError("DNS lookup failed")):
        res = test_client.search_products("OfflineProduct")
        assert res["success"] is False
        assert res["error"] == "CONNECTION_ERROR"


# =========================================================================
# 3. Secret Protection & Price Preservation Tests
# =========================================================================

def test_secret_redaction_utility():
    """Redaction utility strips Bearer tokens and mrp_sk_* keys from messages."""
    raw_error = "Error with header Authorization: Bearer mrp_sk_test_secret123456789 from api.openmrp.ai"
    cleaned = redact_secrets(raw_error)
    assert "secret123456789" not in cleaned
    assert "mrp_sk_test_" not in cleaned
    assert "[REDACTED]" in cleaned or "[REDACTED_OPENMRP_KEY]" in cleaned


def test_invoice_processing_unaffected_when_openmrp_unavailable():
    """Invoice extraction and stock confirmation function reliably even when external API is offline."""
    headers = get_authenticated_headers("invoice_iso@example.com")
    confirm_payload = {
        "supplier_name": "Direct Kirana Wholesale",
        "invoice_number": "INV-OFFLINE-01",
        "invoice_date": "10/10/2026",
        "items": [
            {
                "name": "Fortune Sunlite Oil 1L",
                "quantity": 10.0,
                "unit": "L",
                "purchase_price": 140.0,
                "selling_price": 160.0,
                "mrp": 165.0
            }
        ]
    }
    res = client.post("/api/v1/invoices/confirm", json=confirm_payload, headers=headers)
    assert res.status_code in (200, 201)
    data = res.json()
    assert data["items_created"] == 1
    assert data["total_amount"] == 1400.0
