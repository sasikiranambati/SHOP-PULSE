"""Regression test for the 13-row Sri Balaji General Stores test invoice.
Verifies the end-to-end invoice extraction API pipeline against the printed invoice image.
"""

import io
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from db.session import Base
import db.models
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


def get_auth_setup(email: str = "balaji_tester@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Sri Balaji General Stores",
        "owner_name": "Balaji Trader",
        "business_type": "Grocery/Kirana",
        "location": "Hyderabad"
    }, headers=headers)
    shop_id = shop_res.json()["id"]

    return headers, shop_id


def get_invoice_path():
    root = Path(__file__).resolve().parent.parent.parent
    candidates = [
        root / "tests" / "fixtures" / "invoices" / "original_invoice_sri_balaji.png",
        Path("../tests/fixtures/invoices/original_invoice_sri_balaji.png"),
        Path("tests/fixtures/invoices/original_invoice_sri_balaji.png"),
        Path("../scratch/original_invoice_sri_balaji.png"),
        Path("scratch/original_invoice_sri_balaji.png"),
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


@pytest.fixture
def sri_balaji_bytes():
    path = get_invoice_path()
    if not path:
        pytest.skip("Test image original_invoice_sri_balaji.png not found")
    with open(path, "rb") as f:
        return f.read()


def test_sri_balaji_all_13_rows_regression(sri_balaji_bytes):
    headers, shop_id = get_auth_setup()
    
    file_obj = io.BytesIO(sri_balaji_bytes)
    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("original_invoice_sri_balaji.png", file_obj, "image/png")},
        headers=headers
    )
    assert res.status_code == 200, f"Extraction failed with code {res.status_code}: {res.text}"
    data = res.json()
    assert data["status"] in ("success", "needs_review")
    
    items = data["items"]
    # Must extract all 13 rows from the invoice
    assert len(items) == 13, f"Expected 13 items, but got {len(items)}"
    
    # Expected reference rows from the original printed invoice
    expected = [
        {"name": "CHANA 50 KG", "qty": 1.0, "unit": "BOR", "rate": 2760.00, "sell": 2950.00, "mrp": 3200.00, "total": 2760.00},
        {"name": "FORTUNE BESAN 500 GM", "qty": 10.0, "unit": "PCS", "rate": 70.00, "sell": 78.00, "mrp": 90.00, "total": 700.00},
        {"name": "FORTUNE OIL 1 KG", "qty": 3.0, "unit": "PET", "rate": 1378.62, "sell": 1520.00, "mrp": 1680.00, "total": 4015.80},
        {"name": "HELLO ORGANIC CHANA DAL 1 KG", "qty": 5.0, "unit": "PCS", "rate": 129.46, "sell": 140.00, "mrp": 160.00, "total": 725.00},
        {"name": "MASOOR DAL 50 KG", "qty": 1.0, "unit": "BOR", "rate": 4825.00, "sell": 5200.00, "mrp": 5600.00, "total": 4825.00},
        {"name": "OIL CAN 10", "qty": 10.0, "unit": "PCS", "rate": 1975.00, "sell": 2150.00, "mrp": 2400.00, "total": 19750.00},
        {"name": "SUGAR", "qty": 2.0, "unit": "PCS", "rate": 1925.00, "sell": 2050.00, "mrp": 2300.00, "total": 3850.00},
        {"name": "SOYABEAN CHUNKS 15 KG", "qty": 2.0, "unit": "BOR", "rate": 1230.00, "sell": 1350.00, "mrp": 1500.00, "total": 2460.00},
        {"name": "SONAL SABUDANA KHICHDI 500 GM", "qty": 25.0, "unit": "KG", "rate": 40.18, "sell": 45.00, "mrp": 50.00, "total": 1125.00},
        {"name": "SABUDANA 30 KG", "qty": 1.0, "unit": "KG", "rate": 1336.66, "sell": 1450.00, "mrp": 1600.00, "total": 1340.00},
        {"name": "UDAD DAL 1 KG", "qty": 20.0, "unit": "KG", "rate": 47.95, "sell": 52.00, "mrp": 60.00, "total": 960.00},
        {"name": "RAJAMM", "qty": 25.0, "unit": "KG", "rate": 44.96, "sell": 50.00, "mrp": 58.00, "total": 1125.00},
        {"name": "PARLE-G", "qty": 5.0, "unit": "PET", "rate": 648.38, "sell": 700.00, "mrp": 800.00, "total": 3250.00},
    ]
    
    for i, exp in enumerate(expected):
        item = items[i]
        
        # Verify Product Name
        assert exp["name"] in item["product_name"].upper(), f"Row {i+1}: expected name '{exp['name']}', got '{item['product_name']}'"
        
        # Verify Quantity is separated from product pack size
        assert item["quantity"] == pytest.approx(exp["qty"], rel=1e-2), (
            f"Row {i+1} ({exp['name']}): expected quantity {exp['qty']}, got {item['quantity']}"
        )
        
        # Verify Unit
        if exp["unit"]:
            assert item.get("unit") is not None
            assert item["unit"].upper() == exp["unit"], (
                f"Row {i+1} ({exp['name']}): expected unit {exp['unit']}, got {item.get('unit')}"
            )
            
        # Verify Purchase Price (Rate)
        assert item.get("purchase_price") is not None, f"Row {i+1} ({exp['name']}): purchase price is missing"
        assert item["purchase_price"] == pytest.approx(exp["rate"], rel=1e-2), (
            f"Row {i+1} ({exp['name']}): expected rate {exp['rate']}, got {item['purchase_price']}"
        )
        
        # Verify Selling Price is present and independent
        assert item.get("selling_price") is not None, f"Row {i+1} ({exp['name']}): selling price is missing"
        assert item["selling_price"] == pytest.approx(exp["sell"], rel=1e-2), (
            f"Row {i+1} ({exp['name']}): expected selling price {exp['sell']}, got {item['selling_price']}"
        )
        
        # Verify MRP is extracted from printed invoice column
        assert item.get("mrp") is not None, f"Row {i+1} ({exp['name']}): MRP is missing"
        assert item["mrp"] == pytest.approx(exp["mrp"], rel=1e-2), (
            f"Row {i+1} ({exp['name']}): expected MRP {exp['mrp']}, got {item['mrp']}"
        )
        
        # Verify Line Amount / Total Price
        assert item.get("line_total") is not None, f"Row {i+1} ({exp['name']}): line_total is missing"
        assert item["line_total"] == pytest.approx(exp["total"], rel=1e-2), (
            f"Row {i+1} ({exp['name']}): expected total {exp['total']}, got {item['line_total']}"
        )
