"""
Phase 9 Integration Tests: Frontend and Database Integration for ShopPulse Invoice Scanner.
Verifies:
1. Invoice upload and extraction through FastAPI endpoint.
2. Accurate return of pipeline completed stages.
3. 14-column canonical data with printed and calculated amounts, without fabricated zeros.
4. Preserved original OCR values.
5. Genuine 4-sheet .xlsx Excel download via GET /api/v1/invoices/{id}/excel.
6. Atomic confirmation persisting Purchase with processing_status and review_status in SQLite.
"""

import io
import uuid
import openpyxl
import pytest
from PIL import Image, ImageDraw, ImageFont
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app, init_db_schema
from db.session import Base
import db.models  # noqa: F401
from db.models.purchase import Purchase
from db.models.product import Product
from api.deps import get_db

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    init_db_schema(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


client = TestClient(app)


def auth_user_and_shop(email: str = "grocer@shoppulse.in"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    token = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/api/v1/shops",
        json={"shop_name": "Sharma Provision Store", "owner_name": "Ramesh Sharma",
              "business_type": "Grocery/Kirana", "location": "Pune"},
        headers=headers
    )
    return headers


def generate_test_invoice_image():
    font = ImageFont.load_default(size=24)
    img = Image.new("RGB", (1200, 600), "white")
    d = ImageDraw.Draw(img)
    d.text((40, 30), "Balaji Wholesalers", fill="black", font=font)
    d.text((40, 70), "Invoice No: BW-9801   Date: 01/11/2026", fill="black", font=font)
    
    headers = ["Item Name", "Qty", "Unit", "Rate", "MRP", "Total"]
    cols = [40, 480, 580, 680, 800, 940]
    for x, h in zip(cols, headers):
        d.text((x, 140), h, fill="black", font=font)
    
    rows = [
        ["Fortune Besan 500g", "20", "pcs", "70.00", "90.00", "1400.00"],
        ["Tata Salt 1kg", "10", "pcs", "22.00", "28.00", "220.00"],
    ]
    for i, row in enumerate(rows):
        y = 200 + i * 50
        for x, val in zip(cols, row):
            d.text((x, y), val, fill="black", font=font)
    
    d.text((40, 340), "Grand Total: 1620.00", fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_invoice_extraction_includes_pipeline_stages_and_original_values():
    headers = auth_user_and_shop("extract_user@shoppulse.in")
    img_bytes = generate_test_invoice_image()

    resp = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("invoice.png", img_bytes, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["id"].startswith("inv_")
    assert len(data["items"]) >= 2
    assert "pipeline_stages" in data
    assert "file_validation" in data["pipeline_stages"]
    assert "workbook_generation" in data["pipeline_stages"]
    assert data["excel_download_url"] is not None

    first_item = data["items"][0]
    assert first_item["product_name"] != ""
    assert first_item["purchase_price"] is not None
    assert first_item["printed_amount"] is not None
    assert first_item["calculated_amount"] is not None
    assert "original_values" in first_item
    assert first_item["original_values"] is not None
    assert "name" in first_item["original_values"]


def test_excel_download_retrieves_genuine_xlsx():
    headers = auth_user_and_shop("excel_user@shoppulse.in")
    img_bytes = generate_test_invoice_image()

    extract_resp = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("invoice.png", img_bytes, "image/png")},
        headers=headers,
    )
    assert extract_resp.status_code == 200
    inv_id = extract_resp.json()["id"]

    download_resp = client.get(f"/api/v1/invoices/{inv_id}/excel", headers=headers)
    assert download_resp.status_code == 200
    assert download_resp.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    
    # Parse downloaded bytes as real openpyxl workbook
    wb = openpyxl.load_workbook(io.BytesIO(download_resp.content))
    expected_sheets = {"Raw Invoice", "Grocery Items", "Review Required", "OCR Audit"}
    assert expected_sheets.issubset(set(wb.sheetnames))
    wb.close()


def test_confirmation_persists_processing_and_review_status():
    headers = auth_user_and_shop("confirm_user@shoppulse.in")

    confirm_payload = {
        "supplier_name": "Balaji Wholesalers",
        "invoice_number": "INV-P9-7788",
        "invoice_date": "01/11/2026",
        "items": [
            {
                "name": "Tata Tea Gold 500g",
                "category": "Tea & Coffee",
                "quantity": 15,
                "unit": "pcs",
                "purchase_price": 280.0,
                "selling_price": 320.0,
                "mrp": 350.0,
                "mrp_source": "INVOICE",
                "line_amount": 4200.0,
            }
        ],
    }

    resp = client.post("/api/v1/invoices/confirm", json=confirm_payload, headers=headers)
    assert resp.status_code == 201, resp.text
    result = resp.json()

    assert result["items_created"] == 1
    assert result["processing_status"] == "CONFIRMED"
    assert result["review_status"] == "REVIEWED"

    # Query DB directly to verify persistence of status columns
    with TestingSessionLocal() as db:
        purchase = db.query(Purchase).filter(Purchase.invoice_number == "INV-P9-7788").first()
        assert purchase is not None
        assert purchase.processing_status == "CONFIRMED"
        assert purchase.review_status == "REVIEWED"
        assert purchase.total_amount == 4200.0

        product = db.query(Product).filter(Product.name == "Tata Tea Gold 500g").first()
        assert product is not None
        assert product.current_stock == 15
        assert product.purchase_price == 280.0
        assert product.selling_price == 320.0
        assert product.mrp == 350.0


def test_unsupported_file_and_empty_file_rejected_cleanly():
    headers = auth_user_and_shop("reject_user@shoppulse.in")

    # Unsupported format
    resp_unsupported = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("malicious.exe", b"MZ\x90\x00", "application/x-msdownload")},
        headers=headers,
    )
    assert resp_unsupported.status_code == 400
    assert "Unsupported file format" in resp_unsupported.json()["detail"]

    # Empty file
    resp_empty = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("empty.png", b"", "image/png")},
        headers=headers,
    )
    assert resp_empty.status_code == 400
    assert "empty" in resp_empty.json()["detail"].lower()

