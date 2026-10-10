import io
import uuid
import pytest
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from db.session import Base
import db.models
from db.models.product import Product
from api.deps import get_db
from services.invoice import (
    parse_smart_price_py,
    resolve_item_arithmetic_py,
    detect_columns_from_header_words_py,
    is_conflicting_pair_py,
)

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

def get_auth_setup(email: str = "phase9_user@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Phase 9 Grocery",
        "owner_name": "Sasi",
        "business_type": "Grocery/Kirana",
        "location": "Hyderabad"
    }, headers=headers)
    assert shop_res.status_code in [200, 201], f"Shop create failed: {shop_res.text}"
    shop_id = shop_res.json()["id"]

    return headers, shop_id

# -------------------------------------------------------------
# Test 5 & 12: Headers containing "Unit" and "Rate (₹)", no merging
# -------------------------------------------------------------
def test_unit_and_rate_symbol_header_detection():
    # Verify Unit and Rate are flagged as conflicting pair and never merged
    assert is_conflicting_pair_py("unit", "rate") is True
    assert is_conflicting_pair_py("unit", "purchase_price") is True
    assert is_conflicting_pair_py("qty", "unit") is True

    # Test OCR header words
    words = [
        {"text": "Item", "bbox": {"x0": 50, "y0": 10, "x1": 90, "y1": 30}},
        {"text": "Qty", "bbox": {"x0": 120, "y0": 10, "x1": 150, "y1": 30}},
        {"text": "Unit", "bbox": {"x0": 170, "y0": 10, "x1": 210, "y1": 30}},
        {"text": "Rate", "bbox": {"x0": 230, "y0": 10, "x1": 270, "y1": 30}},
        {"text": "(₹)", "bbox": {"x0": 275, "y0": 10, "x1": 295, "y1": 30}},
        {"text": "Amount", "bbox": {"x0": 320, "y0": 10, "x1": 380, "y1": 30}},
    ]
    cols = detect_columns_from_header_words_py(words, 400.0)
    col_types = [c.type for c in cols]
    assert "product" in col_types
    assert "qty" in col_types
    assert "unit" in col_types
    assert "rate" in col_types
    assert "total" in col_types
    assert len(cols) == 5

# -------------------------------------------------------------
# Test 7: Prices containing currency symbols, thousand separators, decimal commas
# -------------------------------------------------------------
def test_parse_smart_price_formats():
    assert parse_smart_price_py("250") == 250.0
    assert parse_smart_price_py("250.00") == 250.0
    assert parse_smart_price_py("₹250.00") == 250.0
    assert parse_smart_price_py("₹ 250.00") == 250.0
    assert parse_smart_price_py("1,250.00") == 1250.0
    assert parse_smart_price_py("₹1,250.50") == 1250.5
    assert parse_smart_price_py("(250.00)") == -250.0
    assert parse_smart_price_py("250,50") == 250.5
    assert parse_smart_price_py("250.00/kg") == 250.0
    assert parse_smart_price_py("—") is None
    assert parse_smart_price_py("N/A") is None
    assert parse_smart_price_py("invalid") is None

# -------------------------------------------------------------
# Test 8, 9, 10, 11: Arithmetic reconciliation, missing values, taxes, discounts
# -------------------------------------------------------------
def test_arithmetic_reconciliation_and_missing_values():
    # 1. Direct match: Qty=10, Rate=250, Total=2500
    res1 = resolve_item_arithmetic_py(10.0, 250.0, 2500.0)
    assert res1["quantity"] == 10.0
    assert res1["purchase_price"] == 250.0
    assert res1["line_total"] == 2500.0

    # 2. Derive missing total from Qty and Rate
    res2 = resolve_item_arithmetic_py(10.0, 250.0, None)
    assert res2["line_total"] == 2500.0

    # 3. Missing rate is NOT silently derived: amount ÷ qty is only a suggestion for review
    res3 = resolve_item_arithmetic_py(10.0, None, 2500.0)
    assert res3["purchase_price"] is None
    assert res3["suggested_rate"] == 250.0
    assert res3["line_total"] == 2500.0
    assert any("Rate could not be read" in i for i in res3["issues"])

    # 4. Decimal dropout (Qty=200 read from 20.0): printed values are kept, a correction is suggested
    res4 = resolve_item_arithmetic_py(200.0, 70.0, 1400.0)
    assert res4["quantity"] == 200.0
    assert res4["purchase_price"] == 70.0
    assert res4["line_total"] == 1400.0
    assert res4["status"] == "MISMATCH"
    assert any("Quantity may be 20" in s for s in res4["suggestions"])

    # 5. Direct match with tax
    res5 = resolve_item_arithmetic_py(10.0, 250.0, 2625.0, tax=125.0)
    assert res5["line_total"] == 2625.0

# -------------------------------------------------------------
# Test 6: Different column positions and missing MRP/Selling Price
# -------------------------------------------------------------
def test_extract_invoice_different_column_positions():
    headers, _ = get_auth_setup("diff_cols_user@example.com")
    # Table layout with Rate before Qty, and explicit Unit
    invoice_content = (
        "Sri Lakshmi Wholesalers\n"
        "Particulars    Rate    Qty    Unit    Amount\n"
        "Rice Bag       250.00  10     BAG     2500.00\n"
        "Toor Dal       120.00  5      KG      600.00\n"
        "Total Amount: 3100.00\n"
    ).encode("utf-8")

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("invoice.txt", io.BytesIO(invoice_content), "text/plain")},
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert len(data["items"]) == 2

    item0 = data["items"][0]
    assert "rice bag" in item0["product_name"].lower()
    assert item0["quantity"] == 10.0
    assert item0["unit"] == "bag"
    assert item0["purchase_price"] == 250.0
    assert item0["line_total"] == 2500.0
    # MRP and Selling Price MUST be None, not fabricated or equal to purchase price
    assert item0["selling_price"] is None
    assert item0["mrp"] is None

# -------------------------------------------------------------
# Test 3: Text-based PDF extraction
# -------------------------------------------------------------
def test_extract_invoice_text_pdf():
    headers, _ = get_auth_setup("pdf_user@example.com")
    pdf_stream = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Length 120 >>\nstream\n"
        b"BT\n"
        b"/F1 12 Tf\n"
        b"(Super Mart Wholesale) Tj T*\n"
        b"(Item Description    Qty    Rate    Total) Tj T*\n"
        b"(Sunflower Oil 1L    10     150.00  1500.00) Tj T*\n"
        b"ET\n"
        b"endstream\nendobj\n"
        b"xref\n0 2\n0000000000 65535 f \n0000000010 00000 n \n"
        b"trailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n250\n%%EOF"
    )

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("invoice.pdf", io.BytesIO(pdf_stream), "application/pdf")},
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert len(data["items"]) >= 1
    assert data["items"][0]["purchase_price"] == 150.0
    assert data["items"][0]["line_total"] == 1500.0

# -------------------------------------------------------------
# Test 4: Scanned PDF with embedded JPEG fallback
# -------------------------------------------------------------
def test_extract_invoice_scanned_pdf_fallback():
    headers, _ = get_auth_setup("scanned_pdf_user@example.com")

    # Generate a small synthetic JPEG image for the scanned invoice page
    img = Image.new("RGB", (600, 200), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 20), "Scanned Wholesaler", fill="black")
    draw.text((20, 60), "Item Description    Qty    Rate    Total", fill="black")
    draw.text((20, 100), "Basmati Rice 5kg    4      400.00  1600.00", fill="black")

    img_buf = io.BytesIO()
    img.save(img_buf, format="JPEG")
    jpeg_bytes = img_buf.getvalue()

    # Wrap inside PDF container with /DCTDecode
    pdf_bytes = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length "
        + str(len(jpeg_bytes)).encode("ascii")
        + b" >>\nstream\n"
        + jpeg_bytes
        + b"\nendstream\nendobj\n"
        b"xref\n0 2\n0000000000 65535 f \n0000000010 00000 n \n"
        b"trailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n500\n%%EOF"
    )

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("scanned_invoice.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["engine_used"] == "backend_pdf_ocr_scanned"

# -------------------------------------------------------------
# Test 13: Database schema consistency: products.mrp exists
# -------------------------------------------------------------
def test_database_schema_mrp_column():
    inspector = inspect(engine)
    columns = [c["name"] for c in inspector.get_columns("products")]
    assert "mrp" in columns
    assert "purchase_price" in columns
    assert "selling_price" in columns

# -------------------------------------------------------------
# Test 15: Unsupported file types and empty files return clear errors
# -------------------------------------------------------------
def test_extract_invoice_validation_failures():
    headers, _ = get_auth_setup("error_user@example.com")

    # Empty file
    res_empty = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("empty.txt", io.BytesIO(b""), "text/plain")},
        headers=headers
    )
    assert res_empty.status_code == 400

    # Unsupported format
    res_unsupported = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("document.docx", io.BytesIO(b"Word document content"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        headers=headers
    )
    assert res_unsupported.status_code == 400
