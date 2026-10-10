"""
End-to-end invoice flow through the HTTP API:
upload -> OCR / PDF words -> table -> purchase price -> MRP lookup (mocked provider)
-> review payload -> confirm -> stock, MRP provenance and purchase record.
Images and PDFs are rendered on the fly and read by the real OCR engine.
"""

import io
import sqlite3
import uuid

import httpx
import pytest
from PIL import Image, ImageDraw, ImageFont
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app, init_db_schema
from db.session import Base
import db.models  # noqa: F401
from db.models.purchase import Purchase
from db.models.purchase_item import PurchaseItem
from api.deps import get_db
from core.config import settings
from services import mrp_lookup

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
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    mrp_lookup.clear_cache()
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    mrp_lookup.clear_cache()


client = TestClient(app)


def auth(email):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    token = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/v1/shops", json={"shop_name": "Flow Kirana", "owner_name": "Owner",
                                       "business_type": "Grocery/Kirana", "location": "Pune"}, headers=headers)
    return headers


def create_product(headers, **fields):
    body = {"name": "Tata Salt 1kg", "category": "Groceries", "purchase_price": 20.0, "selling_price": 26.0,
            "current_stock": 10, "unit": "pcs"}
    body.update(fields)
    res = client.post("/api/v1/products", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def get_product(headers, pid):
    return client.get(f"/api/v1/products/{pid}", headers=headers).json()


# ---------------------------------------------------------------- fixtures: documents

COLS = [40, 560, 660, 780, 900, 1020]
HEADER = ["Item Description", "Qty", "Unit", "Rate", "MRP", "Amount"]
ROWS = [
    ["Tata Salt 1kg", "24", "pcs", "₹22.00", "28.00", "528.00"],
    ["Fortune Sunflower Oil 1L", "10", "pcs", "135.00", "160.00", "1,350.00"],
]


def invoice_image(size=(1240, 700), font_size=26):
    font = ImageFont.load_default(size=font_size)
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    d.text((40, 30), "Sri Balaji Wholesale Traders", fill="black", font=font)
    d.text((40, 75), "Invoice No: SBW-1021   Date: 05/10/2026", fill="black", font=font)
    for x, h in zip(COLS, HEADER):
        d.text((x, 160), h, fill="black", font=font)
    for i, row in enumerate(ROWS):
        for x, v in zip(COLS, row):
            d.text((x, 220 + i * 60), v, fill="black", font=font)
    d.text((40, 380), "Grand Total: 1,878.00", fill="black", font=font)
    return img


def png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def build_pdf(objects):
    """Assembles a valid PDF (correct xref offsets) from object bodies (bytes)."""
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def stream(data: bytes, extra: bytes = b"") -> bytes:
    return b"<< /Length " + str(len(data)).encode() + extra + b" >>\nstream\n" + data + b"\nendstream"


def digital_pdf():
    xs = [40, 270, 320, 370, 430, 500]
    lines = [(40, 800, "Sri Balaji Wholesale Traders"), (40, 785, "Invoice No: SBW-2001  Date: 06/10/2026")]
    lines += [(x, 750, h) for x, h in zip(xs, ["Item Description", "Qty", "Unit", "Rate", "MRP", "Amount"])]
    data_rows = [["Tata Salt 1kg", "24", "pcs", "22.00", "28.00", "528.00"],
                 ["Aashirvaad Atta 5kg", "6", "bag", "216.00", "", "1,296.00"]]
    for r, row in enumerate(data_rows):
        lines += [(x, 732 - r * 18, v) for x, v in zip(xs, row) if v]
    lines.append((40, 680, "Grand Total: 1,824.00"))
    content = b"BT /F1 10 Tf\n" + b"".join(
        f"1 0 0 1 {x} {y} Tm ({t}) Tj\n".encode("latin-1") for x, y, t in lines) + b"ET"
    return build_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        stream(content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ])


def scanned_pdf():
    img = invoice_image(size=(1240, 1754), font_size=28).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    jpeg = buf.getvalue()
    content = b"q 595 0 0 842 0 0 cm /Im1 Do Q"
    return build_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
        stream(content),
        stream(jpeg, b" /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB "
                     b"/BitsPerComponent 8 /Filter /DCTDecode"),
    ])


def mock_provider(monkeypatch, handler):
    for k, v in {
        "MRP_PROVIDER": "custom_http", "MRP_API_BASE_URL": "https://mrp.example.test", "MRP_API_KEY": "k_test_123",
        "MRP_API_SEARCH_PATH": "/search", "MRP_API_BARCODE_PATH": None, "MRP_API_RESULTS_FIELD": "items",
        "MRP_API_MRP_FIELD": "mrp", "MRP_API_NAME_FIELD": "title", "MRP_API_BARCODE_FIELD": "ean",
        "MRP_LOOKUP_ENABLED": True,
    }.items():
        monkeypatch.setattr(settings, k, v)
    transport_client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(mrp_lookup, "get_provider", lambda: mrp_lookup.CustomHttpMrpProvider(client=transport_client))


def catalogue(request: httpx.Request):
    q = request.url.params.get("q", "").lower()
    if "salt" in q:
        return httpx.Response(200, json={"items": [{"title": "Tata Salt 1 kg", "mrp": 28.0}]})
    if "sunflower" in q:
        return httpx.Response(200, json={"items": [{"title": "Fortune Sunflower Oil 1L", "mrp": 165.0}]})
    return httpx.Response(200, json={"items": []})


def by_name(items, needle):
    return next(it for it in items if needle in it["product_name"].lower())


# ---------------------------------------------------------------- extraction

def test_image_upload_to_review_payload_with_mrp_lookup(monkeypatch):
    headers = auth("flow_image@example.com")
    salt = create_product(headers, mrp=27.0)
    mock_provider(monkeypatch, catalogue)

    res = client.post("/api/v1/invoices/extract", files={"file": ("bill.png", png_bytes(invoice_image()), "image/png")},
                      headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["engine_used"] == "backend_ocr_pipeline"
    assert data["supplier_name"] == "Sri Balaji Wholesale Traders"
    assert data["invoice_number"] == "SBW-1021"
    assert data["invoice_date"] == "05/10/2026"
    assert data["invoice_total"] == 1878.0
    assert len(data["items"]) == 2

    s = by_name(data["items"], "tata salt")
    assert (s["quantity"], s["unit"], s["purchase_price"], s["line_total"]) == (24.0, "pcs", 22.0, 528.0)
    assert s["arithmetic_status"] == "VERIFIED"
    assert s["invoice_mrp"] == 28.0
    assert (s["mrp"], s["mrp_source"]) == (28.0, "INVOICE")
    assert s["mrp_lookup"]["status"] == "FOUND" and s["mrp_lookup"]["mrp"] == 28.0
    assert s["store_mrp"] == 27.0
    assert s["matched_product_id"] == salt["id"]

    oil = by_name(data["items"], "sunflower")
    assert (oil["quantity"], oil["purchase_price"], oil["line_total"]) == (10.0, 135.0, 1350.0)
    assert oil["mrp"] == 160.0 and oil["mrp_source"] == "INVOICE"
    assert oil["mrp_lookup"]["mrp"] == 165.0
    assert oil["needs_review"] is True
    assert any("MRP mismatch" in i for i in oil["validation_issues"])
    # MRP is never confused with the purchase price
    assert oil["purchase_price"] != oil["mrp"]

    # Extraction alone never changes stock
    assert get_product(headers, salt["id"])["current_stock"] == 10


def test_digital_pdf_upload_uses_word_positions():
    headers = auth("flow_pdf@example.com")
    res = client.post("/api/v1/invoices/extract", files={"file": ("bill.pdf", digital_pdf(), "application/pdf")},
                      headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["engine_used"] == "backend_pdf_direct"
    salt = by_name(data["items"], "tata salt")
    atta = by_name(data["items"], "aashirvaad")
    assert (salt["quantity"], salt["purchase_price"], salt["invoice_mrp"], salt["line_total"]) == (24.0, 22.0, 28.0, 528.0)
    assert (atta["quantity"], atta["unit"], atta["purchase_price"], atta["line_total"]) == (6.0, "bag", 216.0, 1296.0)
    assert atta["invoice_mrp"] is None and atta["mrp"] is None  # nothing printed, nothing invented
    # Default provider (OpenMRP without a key) reports a configuration error, per line
    assert atta["mrp_lookup"]["status"] == "API_CONFIGURATION_ERROR"


def test_scanned_pdf_page_is_rendered_and_ocrd():
    headers = auth("flow_scan@example.com")
    res = client.post("/api/v1/invoices/extract", files={"file": ("scan.pdf", scanned_pdf(), "application/pdf")},
                      headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["engine_used"] == "backend_pdf_ocr_scanned"
    salt = by_name(data["items"], "tata salt")
    assert (salt["quantity"], salt["purchase_price"], salt["line_total"]) == (24.0, 22.0, 528.0)


def test_mrp_provider_failure_does_not_break_extraction(monkeypatch):
    headers = auth("flow_provider_down@example.com")
    mock_provider(monkeypatch, lambda r: httpx.Response(500, text="upstream error"))
    res = client.post("/api/v1/invoices/extract", files={"file": ("bill.png", png_bytes(invoice_image()), "image/png")},
                      headers=headers)
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert len(items) == 2
    assert {it["mrp_lookup"]["status"] for it in items} == {"API_ERROR"}
    # Invoice MRPs are still reported
    assert by_name(items, "tata salt")["mrp"] == 28.0


# ---------------------------------------------------------------- confirmation

def confirm(headers, items, invoice_number="SBW-1021", supplier="Sri Balaji Wholesale Traders"):
    return client.post("/api/v1/invoices/confirm", json={"supplier_name": supplier, "invoice_number": invoice_number,
                                                          "invoice_date": "05/10/2026", "items": items}, headers=headers)


def test_confirm_saves_mrp_source_and_blocks_duplicate_invoice():
    headers = auth("flow_confirm@example.com")
    salt = create_product(headers)
    items = [
        {"name": "Tata Salt 1kg", "quantity": 24, "unit": "pcs", "purchase_price": 22.0, "mrp": 28.0,
         "mrp_source": "API", "line_amount": 528.0, "matched_product_id": salt["id"]},
        {"name": "Fortune Sunflower Oil 1L", "quantity": 10, "unit": "pcs", "purchase_price": 135.0,
         "selling_price": 155.0, "mrp": 160.0, "mrp_source": "INVOICE", "line_amount": 1417.5},
    ]
    res = confirm(headers, items)
    assert res.status_code == 201, res.text
    body = res.json()
    assert (body["items_restocked"], body["items_created"]) == (1, 1)
    assert body["total_amount"] == 528.0 + 1417.5  # invoice line amounts, not recomputed

    p = get_product(headers, salt["id"])
    assert p["current_stock"] == 34
    assert p["purchase_price"] == 22.0
    assert p["selling_price"] == 26.0  # not touched: no selling price on the invoice
    assert (p["mrp"], p["mrp_source"]) == (28.0, "API")
    assert p["mrp_updated_at"]

    # Same supplier invoice again: rejected, stock unchanged
    again = confirm(headers, items)
    assert again.status_code == 409
    assert get_product(headers, salt["id"])["current_stock"] == 34

    db = TestingSessionLocal()
    try:
        purchases = db.query(Purchase).all()
        assert len(purchases) == 1 and purchases[0].invoice_number == "SBW-1021"
        lines = db.query(PurchaseItem).all()
        assert sorted(l.line_amount for l in lines) == [528.0, 1417.5]
    finally:
        db.close()


def test_restock_without_mrp_keeps_existing_mrp():
    headers = auth("flow_keep_mrp@example.com")
    salt = create_product(headers, mrp=28.0)
    res = confirm(headers, [{"name": "Tata Salt 1kg", "quantity": 5, "purchase_price": 21.0,
                             "matched_product_id": salt["id"]}], invoice_number="X-1")
    assert res.status_code == 201, res.text
    p = get_product(headers, salt["id"])
    assert p["mrp"] == 28.0
    assert p["current_stock"] == 15


def test_new_product_without_selling_price_is_rejected_atomically():
    headers = auth("flow_no_sp@example.com")
    salt = create_product(headers)
    res = confirm(headers, [
        {"name": "Tata Salt 1kg", "quantity": 5, "purchase_price": 21.0, "matched_product_id": salt["id"]},
        {"name": "Brand New Snack", "quantity": 5, "purchase_price": 10.0},
    ], invoice_number="X-2")
    assert res.status_code == 400
    assert "Selling price is required" in res.json()["detail"]
    assert get_product(headers, salt["id"])["current_stock"] == 10  # nothing applied
    names = [p["name"] for p in client.get("/api/v1/products", headers=headers).json()["items"]]
    assert "Brand New Snack" not in names


def test_confirm_requires_purchase_price_and_whole_quantities():
    headers = auth("flow_validation@example.com")
    missing_price = confirm(headers, [{"name": "Rice", "quantity": 2, "selling_price": 60.0}], invoice_number="X-3")
    assert missing_price.status_code == 422
    fractional = confirm(headers, [{"name": "Rice", "quantity": 2.5, "purchase_price": 50.0, "selling_price": 60.0}],
                         invoice_number="X-4")
    assert fractional.status_code == 422


def test_duplicate_lines_are_merged_into_one_stock_movement():
    headers = auth("flow_merge@example.com")
    salt = create_product(headers)
    res = confirm(headers, [
        {"name": "Tata Salt 1kg", "quantity": 10, "purchase_price": 22.0, "line_amount": 220.0},
        {"name": "tata salt 1 KG", "quantity": 5, "purchase_price": 22.0, "line_amount": 110.0},
    ], invoice_number="X-5")
    assert res.status_code == 201, res.text
    assert res.json()["items_restocked"] == 1
    assert res.json()["total_amount"] == 330.0
    assert get_product(headers, salt["id"])["current_stock"] == 25


# ---------------------------------------------------------------- schema migration

def test_incremental_migration_preserves_existing_records(tmp_path):
    path = tmp_path / "legacy.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE products (id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, selling_price FLOAT NOT NULL,
                               purchase_price FLOAT, current_stock INTEGER, shop_id VARCHAR NOT NULL);
        CREATE TABLE purchases (id VARCHAR PRIMARY KEY, shop_id VARCHAR NOT NULL, total_amount FLOAT NOT NULL);
        CREATE TABLE purchase_items (id VARCHAR PRIMARY KEY, purchase_id VARCHAR, product_id VARCHAR,
                                     quantity INTEGER NOT NULL, purchase_price FLOAT NOT NULL);
        INSERT INTO products VALUES ('p1', 'Atta 5kg', 250.0, 220.0, 15, 's1');
        INSERT INTO purchases VALUES ('u1', 's1', 2200.0);
        INSERT INTO purchase_items VALUES ('i1', 'u1', 'p1', 10, 220.0);
    """)
    conn.commit()
    conn.close()

    legacy_engine = create_engine(f"sqlite:///{path}")
    init_db_schema(legacy_engine)
    init_db_schema(legacy_engine)  # idempotent

    insp = inspect(legacy_engine)
    assert {"mrp", "mrp_source", "mrp_updated_at"} <= {c["name"] for c in insp.get_columns("products")}
    assert {"invoice_number", "invoice_date"} <= {c["name"] for c in insp.get_columns("purchases")}
    assert {"line_amount", "mrp", "mrp_source"} <= {c["name"] for c in insp.get_columns("purchase_items")}

    conn = sqlite3.connect(path)
    assert conn.execute("SELECT name, selling_price, purchase_price, current_stock, mrp FROM products").fetchall() == [
        ("Atta 5kg", 250.0, 220.0, 15, None)]
    assert conn.execute("SELECT quantity, purchase_price, line_amount FROM purchase_items").fetchall() == [(10, 220.0, None)]
    conn.close()
    legacy_engine.dispose()
