import io
import uuid
import zlib
import pytest
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from db.session import Base
import db.models
from db.models.product import Product
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

def get_auth_setup(email: str = "invoice_user@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create shop
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Kirana Mart",
        "owner_name": "Ramesh Gupta",
        "business_type": "Grocery/Kirana",
        "location": "Bengaluru"
    }, headers=headers)
    shop_id = shop_res.json()["id"]

    # Pre-populate one product for inventory matching
    prod_res = client.post("/api/v1/products", json={
        "name": "Tata Salt 1kg",
        "category": "Groceries",
        "purchase_price": 20.0,
        "selling_price": 25.0,
        "current_stock": 10,
        "unit": "pcs"
    }, headers=headers)
    prod_id = prod_res.json()["id"]

    return headers, shop_id, prod_id

def test_extract_invoice_unauthorized():
    res = client.post("/api/v1/invoices/extract", files={"file": ("test.txt", io.BytesIO(b"data"), "text/plain")})
    assert res.status_code == 401

def test_extract_invoice_with_table_format():
    headers, shop_id, prod_id = get_auth_setup()
    invoice_content = (
        "Metro Cash & Carry Wholesale\n"
        "Invoice No: MCC/2026/8942   Date: 15/09/2026\n"
        "GSTIN: 29ABCDE1234F1Z5\n"
        "Item Description    Qty    Rate    Total\n"
        "Tata Salt 1kg       24     22.00   528.00\n"
        "Fortune Sunflower Oil 1L  10  135.00  1350.00\n"
        "Basmati Rice 5kg     5     450.00  2250.00\n"
        "Subtotal: 4128.00\n"
        "Total Amount: 4128.00\n"
        "Thank You Visit Again\n"
    ).encode("utf-8")

    file_obj = io.BytesIO(invoice_content)
    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("metro_invoice.txt", file_obj, "text/plain")},
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "Metro Cash & Carry" in data["supplier_name"]
    assert len(data["items"]) >= 3

    # Check first item matched with existing product
    tata_item = next(it for it in data["items"] if "tata salt" in it["product_name"].lower())
    assert tata_item["quantity"] == 24
    assert tata_item["purchase_price"] == 22.0
    assert tata_item["line_total"] == 528.0
    assert tata_item["matched_product_id"] == prod_id
    assert len(tata_item["validation_issues"]) == 0

def test_extract_invoice_arithmetic_validation_flag():
    headers, _, _ = get_auth_setup("math_user@example.com")
    # Intentional math mismatch: 2 * 100 != 900
    invoice_content = (
        "Item Qty Rate Total\n"
        "Special Almonds 2 100.00 900.00\n"
    ).encode("utf-8")

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("bill.txt", io.BytesIO(invoice_content), "text/plain")},
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["arithmetic_status"] == "MISMATCH"
    assert item["needs_review"] is True
    assert any("does not match quantity × rate" in i for i in item["validation_issues"])
    # Printed values are never overwritten by a calculation
    assert item["purchase_price"] == 100.0
    assert item["line_total"] == 900.0
    assert item["line_total_source"] == "INVOICE"

def test_confirm_invoice_restocks_and_creates_products():
    headers, shop_id, prod_id = get_auth_setup("confirm_user@example.com")

    confirm_payload = {
        "supplier_name": "Balaji Wholesalers",
        "invoice_number": "BW-2026-99",
        "invoice_date": "20/09/2026",
        "items": [
            {
                "name": "Tata Salt 1kg",
                "category": "Groceries",
                "quantity": 30,
                "unit": "pcs",
                "purchase_price": 21.5,
                "selling_price": 28.0,
                "matched_product_id": prod_id
            },
            {
                "name": "New Premium Cashews 500g",
                "category": "Snacks",
                "quantity": 15,
                "unit": "pcs",
                "purchase_price": 380.0,
                "selling_price": 450.0,
                "matched_product_id": None
            }
        ]
    }

    confirm_res = client.post(
        "/api/v1/invoices/confirm",
        json=confirm_payload,
        headers=headers
    )
    assert confirm_res.status_code == 201, f"Failed: {confirm_res.status_code} - {confirm_res.text}"
    c_data = confirm_res.json()
    assert c_data["items_restocked"] == 1
    assert c_data["items_created"] == 1
    assert c_data["total_units"] == 45.0
    assert c_data["total_amount"] == 30 * 21.5 + 15 * 380.0

    # Verify existing product stock increased from 10 to 40
    get_prod = client.get(f"/api/v1/products/{prod_id}", headers=headers)
    assert get_prod.json()["current_stock"] == 40
    assert get_prod.json()["purchase_price"] == 21.5

    # Verify new product was created in the shop
    all_prods = client.get("/api/v1/products", headers=headers).json()["items"]
    cashew = next(p for p in all_prods if "Cashews" in p["name"])
    assert cashew["current_stock"] == 15
    assert cashew["purchase_price"] == 380.0
    assert cashew["selling_price"] == 450.0

def test_extract_demo_invoice_canonical_schema():
    headers, shop_id, _ = get_auth_setup("demo_inv_user@example.com")
    demo_content = (
        "Sri Balaji Wholesale Traders\n"
        "GSTIN: 36ABCDE1234F1Z5    Date: 28/09/2026    Invoice No: SBW-8821\n"
        "Product    Qty    Unit    Rate    Discount    Tax    Amount\n"
        "Aashirvaad Atta 5 kg    10    BAG    250    0    5    2500\n"
        "Tata Salt 1 kg    20    PKT    25    0    0    500\n"
        "Fortune Sunflower Oil 1 L    10    BTL    150    0    5    1500\n"
        "Parle-G Biscuit 800 g    30    PKT    60    0    0    1800\n"
        "Britannia Marie Gold 800 g    20    PKT    70    0    0    1400\n"
        "Maggi 2-Minute Noodles 70 g    50    PKT    14    0    5    700\n"
        "Everest Turmeric Powder 500 g    20    PKT    120    0    5    2400\n"
        "Daawat Rozana Basmati Rice 5 kg    10    BAG    350    0    5    3500\n"
        "Toor Dal Premium 1 kg    20    PKT    110    0    0    2200\n"
        "Surf Excel Easy Wash 1 kg    40    PKT    12.5    0    18    500\n"
        "Subtotal: 17000.00\n"
        "Total Amount: 17000.00\n"
    ).encode("utf-8")

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("demo_invoice.txt", io.BytesIO(demo_content), "text/plain")},
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) == 10

    # 1. Aashirvaad Atta 5 kg
    atta = next(it for it in data["items"] if "aashirvaad" in it["product_name"].lower())
    assert atta["quantity"] == 10.0
    assert atta["rate"] == 250.0
    assert atta["purchase_price"] == 250.0
    assert atta["selling_price"] is None
    assert atta["line_total"] == 2500.0

    # 2. Tata Salt 1 kg
    salt = next(it for it in data["items"] if "tata salt" in it["product_name"].lower())
    assert salt["quantity"] == 20.0
    assert salt["rate"] == 25.0
    assert salt["purchase_price"] == 25.0
    assert salt["selling_price"] is None
    assert salt["line_total"] == 500.0

    # 3. Fortune Sunflower Oil 1 L
    oil = next(it for it in data["items"] if "fortune sunflower" in it["product_name"].lower())
    assert oil["quantity"] == 10.0
    assert oil["rate"] == 150.0
    assert oil["purchase_price"] == 150.0
    assert oil["selling_price"] is None
    assert oil["line_total"] == 1500.0

    # Validate totals
    total_qty = sum(it["quantity"] for it in data["items"] if it["quantity"])
    assert total_qty == 230.0

    total_amount = sum(it["line_total"] for it in data["items"] if it["line_total"])
    assert total_amount == 17000.0

def test_extract_demo_invoice_with_9_columns_and_formatted_prices():
    headers, shop_id, _ = get_auth_setup("demo_9col_user@example.com")
    invoice_content = (
        "S.No. | Item Description | HSN/SAC | Qty | Unit | Rate | Discount | Tax | Amount\n"
        "1 | Aashirvaad Atta 5 kg | 1001 | 10 | BAG | ₹250 | 0 | 5% | ₹2,500\n"
        "2 | Tata Salt 1 kg | 2501 | 20 | PKT | ₹25 | 0 | 0% | ₹500\n"
        "3 | Fortune Sunflower Oil 1 L | 1512 | 10 | BTL | ₹150 | 0 | 5% | ₹1,500\n"
        "4 | Parle-G Biscuit 800 g | 1905 | 30 | PKT | ₹60 | 0 | 0% | ₹1,800\n"
        "5 | Britannia Marie Gold 800 g | 1905 | 20 | PKT | ₹70 | 0 | 0% | ₹1,400\n"
        "6 | Surf Excel 1 kg | 3402 | 5 | PKT | ₹200 | 0 | 18% | ₹1,000\n"
        "7 | Colgate Toothpaste 200 g | 3306 | 24 | PKT | ₹85 | 0 | 12% | ₹2,040\n"
        "8 | Dettol Soap 125 g | 3401 | 36 | PKT | ₹35 | 0 | 18% | ₹1,260\n"
        "9 | Sugar 1 kg | 1701 | 50 | PKT | ₹40 | 0 | 5% | ₹2,000\n"
        "10 | Masoor Dal 1 kg | 0713 | 25 | PKT | ₹120 | 0 | 0% | ₹3,000\n"
        "Subtotal: 17,000.00\n"
        "Grand Total: 17,000.00\n"
    ).encode("utf-8")

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("actual_demo.txt", io.BytesIO(invoice_content), "text/plain")},
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) == 10

    # 1. Aashirvaad Atta 5 kg
    atta = next(it for it in data["items"] if "aashirvaad" in it["product_name"].lower())
    assert atta["quantity"] == 10.0
    assert atta["rate"] == 250.0
    assert atta["purchase_price"] == 250.0
    assert atta["selling_price"] is None
    assert atta["mrp"] is None
    assert atta["line_total"] == 2500.0

    # 2. Tata Salt 1 kg
    salt = next(it for it in data["items"] if "tata salt" in it["product_name"].lower())
    assert salt["quantity"] == 20.0
    assert salt["rate"] == 25.0
    assert salt["purchase_price"] == 25.0
    assert salt["line_total"] == 500.0

    # 3. Fortune Sunflower Oil 1 L
    oil = next(it for it in data["items"] if "fortune sunflower" in it["product_name"].lower())
    assert oil["quantity"] == 10.0
    assert oil["rate"] == 150.0
    assert oil["line_total"] == 1500.0

    # 4. Parle-G Biscuit 800 g
    parle = next(it for it in data["items"] if "parle-g" in it["product_name"].lower())
    assert parle["quantity"] == 30.0
    assert parle["rate"] == 60.0
    assert parle["line_total"] == 1800.0

    # 5. Britannia Marie Gold 800 g
    marie = next(it for it in data["items"] if "marie gold" in it["product_name"].lower())
    assert marie["quantity"] == 20.0
    assert marie["rate"] == 70.0
    assert marie["line_total"] == 1400.0

    # 6. Surf Excel 1 kg
    surf = next(it for it in data["items"] if "surf excel" in it["product_name"].lower())
    assert surf["quantity"] == 5.0
    assert surf["rate"] == 200.0
    assert surf["line_total"] == 1000.0

    # 7. Colgate Toothpaste 200 g
    colgate = next(it for it in data["items"] if "colgate" in it["product_name"].lower())
    assert colgate["quantity"] == 24.0
    assert colgate["rate"] == 85.0
    assert colgate["line_total"] == 2040.0

    # 8. Dettol Soap 125 g
    dettol = next(it for it in data["items"] if "dettol" in it["product_name"].lower())
    assert dettol["quantity"] == 36.0
    assert dettol["rate"] == 35.0
    assert dettol["line_total"] == 1260.0

    # 9. Sugar 1 kg
    sugar = next(it for it in data["items"] if "sugar" in it["product_name"].lower())
    assert sugar["quantity"] == 50.0
    assert sugar["rate"] == 40.0
    assert sugar["line_total"] == 2000.0

    # 10. Masoor Dal 1 kg
    masoor = next(it for it in data["items"] if "masoor" in it["product_name"].lower())
    assert masoor["quantity"] == 25.0
    assert masoor["rate"] == 120.0
    assert masoor["line_total"] == 3000.0

    # Validate totals
    total_qty = sum(it["quantity"] for it in data["items"] if it["quantity"])
    assert total_qty == 230.0

    total_amount = sum(it["line_total"] for it in data["items"] if it["line_total"])
    assert total_amount == 17000.0

def test_extract_various_price_formats():
    headers, _, _ = get_auth_setup("formats_user@example.com")

    # Format A: Product | Qty | Rate | Amount
    content_a = "Product | Qty | Rate | Amount\nTea 500g | 4 | 180 | 720\n".encode("utf-8")
    res_a = client.post("/api/v1/invoices/extract", files={"file": ("a.txt", io.BytesIO(content_a), "text/plain")}, headers=headers)
    assert res_a.json()["items"][0]["rate"] == 180.0
    assert res_a.json()["items"][0]["line_total"] == 720.0

    # Format B: Product | Qty | Unit Price | Total
    content_b = "Product | Qty | Unit Price | Total\nCoffee 200g | 2 | 250 | 500\n".encode("utf-8")
    res_b = client.post("/api/v1/invoices/extract", files={"file": ("b.txt", io.BytesIO(content_b), "text/plain")}, headers=headers)
    assert res_b.json()["items"][0]["purchase_price"] == 250.0
    assert res_b.json()["items"][0]["line_total"] == 500.0

    # Format C: Product | Qty | Purchase Rate | Selling Price | MRP | Amount
    content_c = "Product | Qty | Purchase Rate | Selling Price | MRP | Amount\nGhee 1L | 5 | 520 | 580 | 620 | 2600\n".encode("utf-8")
    res_c = client.post("/api/v1/invoices/extract", files={"file": ("c.txt", io.BytesIO(content_c), "text/plain")}, headers=headers)
    item_c = res_c.json()["items"][0]
    assert item_c["purchase_price"] == 520.0
    assert item_c["selling_price"] == 580.0
    assert item_c["mrp"] == 620.0
    assert item_c["line_total"] == 2600.0

    # Format D: Product | Qty | MRP | Sale Price | Amount
    content_d = "Product | Qty | MRP | Sale Price | Amount\nSoap Box | 10 | 120 | 110 | 1100\n".encode("utf-8")
    res_d = client.post("/api/v1/invoices/extract", files={"file": ("d.txt", io.BytesIO(content_d), "text/plain")}, headers=headers)
    item_d = res_d.json()["items"][0]
    assert item_d["mrp"] == 120.0
    assert item_d["selling_price"] == 110.0
    assert item_d["line_total"] == 1100.0

def _render_invoice_png(rows, font_size=24, size=(1100, 360)):
    from PIL import ImageFont
    font = ImageFont.load_default(size=font_size)
    img = Image.new("RGB", size, color="white")
    draw = ImageDraw.Draw(img)
    for y, cells in rows:
        for x, text in cells:
            draw.text((x, y), text, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

def test_extract_invoice_from_image_ocr():
    """Real OCR (tesseract.js with bundled language data) on a rendered invoice image."""
    headers, shop_id, prod_id = get_auth_setup("image_ocr_user@example.com")
    cols = [30, 520, 640, 800]
    png = _render_invoice_png([
        (30, [(30, "Sri Balaji Wholesale Traders")]),
        (100, list(zip(cols, ["Item Description", "Qty", "Rate", "Total"]))),
        (160, list(zip(cols, ["Aashirvaad Atta 5kg", "10", "250.00", "2500.00"]))),
        (230, [(30, "Subtotal: 2500.00")]),
    ])

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("invoice_scan.png", png, "image/png")},
        headers=headers
    )
    assert res.status_code == 200, f"Error: {res.text}"
    data = res.json()
    assert data["status"] == "success"
    assert data["engine_used"] == "backend_ocr_pipeline"
    assert data["diagnostics"]["document_type"] == "image"
    assert len(data["items"]) == 1

    atta_item = data["items"][0]
    assert "aashirvaad" in atta_item["product_name"].lower()
    assert atta_item["quantity"] == 10.0
    assert atta_item["rate"] == 250.0
    assert atta_item["purchase_price"] == 250.0
    assert atta_item["line_total"] == 2500.0
    assert atta_item["arithmetic_status"] == "VERIFIED"

def _small_font_invoice():
    img = Image.new("RGB", (900, 320), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((30, 30), "Sri Balaji Wholesale Traders", fill="black")
    draw.text((30, 80), "Item Description    Qty    Rate    Total", fill="black")
    draw.text((30, 130), "Aashirvaad Atta 5kg  10    250.00  2500.00", fill="black")
    return img

def test_small_bitmap_font_invoice_is_read():
    """PIL's tiny default font (the original fixture) is upscaled and read by real OCR."""
    headers, _, _ = get_auth_setup("small_font_user@example.com")
    buf = io.BytesIO()
    _small_font_invoice().save(buf, format="PNG")
    res = client.post("/api/v1/invoices/extract", files={"file": ("small.png", buf.getvalue(), "image/png")}, headers=headers)
    assert res.status_code == 200, res.text
    item = res.json()["items"][0]
    assert (item["quantity"], item["purchase_price"], item["line_total"]) == (10.0, 250.0, 2500.0)
    assert item["arithmetic_status"] == "VERIFIED"

def test_unreadable_image_is_flagged_not_fabricated():
    """A blurred photo OCRs as noise: nothing may be reported as a clean extraction."""
    from PIL import ImageFilter
    headers, _, _ = get_auth_setup("blurred_user@example.com")
    buf = io.BytesIO()
    _small_font_invoice().filter(ImageFilter.GaussianBlur(1.6)).save(buf, format="PNG")

    res = client.post("/api/v1/invoices/extract", files={"file": ("blurred.png", buf.getvalue(), "image/png")}, headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "needs_review"
    assert data["reason"]
    for it in data["items"]:
        assert it["needs_review"] is True

def test_extract_invoice_unsupported_file_extension():
    headers, _, _ = get_auth_setup("unsupported_user@example.com")
    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("malicious_payload.exe", b"\x4d\x5a\x90\x00", "application/x-msdownload")},
        headers=headers
    )
    assert res.status_code == 400
    assert "Unsupported file format" in res.json()["detail"]

def test_extract_invoice_empty_file():
    headers, _, _ = get_auth_setup("empty_file_user@example.com")
    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("empty_invoice.png", b"", "image/png")},
        headers=headers
    )
    assert res.status_code == 400
    assert "Uploaded file is empty" in res.json()["detail"]

def test_extract_invoice_corrupted_image():
    headers, _, _ = get_auth_setup("corrupt_img_user@example.com")
    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("damaged.jpg", b"NOT_A_VALID_JPEG_STREAM_DATA", "image/jpeg")},
        headers=headers
    )
    assert res.status_code == 400
    assert "Invalid or unreadable image file" in res.json()["detail"]

def test_extract_invoice_corrupted_pdf():
    headers, _, _ = get_auth_setup("corrupt_pdf_user@example.com")
    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("damaged.pdf", b"NOT_A_VALID_PDF_STREAM_DATA", "application/pdf")},
        headers=headers
    )
    assert res.status_code == 400
    assert "Invalid or corrupted PDF file" in res.json()["detail"]

def test_product_model_mrp_column_regression():
    headers, shop_id, _ = get_auth_setup("mrp_regression_user@example.com")
    
    # 1. Create a product with explicit MRP
    create_res = client.post(
        "/api/v1/products",
        json={
            "name": "Everest Garam Masala 100g",
            "category": "Spices",
            "purchase_price": 68.0,
            "selling_price": 85.0,
            "mrp": 90.0,
            "current_stock": 25,
            "unit": "pcs"
        },
        headers=headers
    )
    assert create_res.status_code == 201, f"Failed: {create_res.text}"
    prod_id = create_res.json()["id"]
    assert create_res.json()["mrp"] == 90.0

    # 2. Query product from DB model directly to ensure no SQLite column mismatch
    db = TestingSessionLocal()
    try:
        db_prod = db.query(Product).filter(Product.id == uuid.UUID(prod_id)).first()
        assert db_prod is not None
        assert db_prod.mrp == 90.0
        assert db_prod.selling_price == 85.0
        assert db_prod.purchase_price == 68.0

        # Query all products for shop to ensure no (sqlite3.OperationalError: no such column: products.mrp)
        shop_prods = db.query(Product).filter(Product.shop_id == uuid.UUID(shop_id)).all()
        assert len(shop_prods) >= 1
        assert any(p.mrp == 90.0 for p in shop_prods)
    finally:
        db.close()

    # 3. Update MRP via API
    update_res = client.put(
        f"/api/v1/products/{prod_id}",
        json={"mrp": 95.0},
        headers=headers
    )
    assert update_res.status_code == 200
    assert update_res.json()["mrp"] == 95.0

def test_safe_migration_preserves_existing_data():
    import sqlite3
    # Create an in-memory SQLite database mimicking legacy unmigrated schema
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE products (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            selling_price FLOAT NOT NULL,
            purchase_price FLOAT,
            current_stock INTEGER DEFAULT 0
        )
    """)
    cur.execute("INSERT INTO products (id, name, selling_price, purchase_price, current_stock) VALUES ('p1', 'Atta 5kg', 250.0, 220.0, 15)")
    cur.execute("INSERT INTO products (id, name, selling_price, purchase_price, current_stock) VALUES ('p2', 'Salt 1kg', 25.0, 20.0, 50)")
    conn.commit()

    # Verify column 'mrp' is initially missing
    cur.execute("PRAGMA table_info(products)")
    col_names = [col[1] for col in cur.fetchall()]
    assert "mrp" not in col_names

    # Run safe non-destructive migration
    cur.execute("ALTER TABLE products ADD COLUMN mrp FLOAT")
    conn.commit()

    # Verify column exists and existing data is intact
    cur.execute("PRAGMA table_info(products)")
    updated_cols = [col[1] for col in cur.fetchall()]
    assert "mrp" in updated_cols

    cur.execute("SELECT id, name, selling_price, purchase_price, current_stock, mrp FROM products ORDER BY id")
    rows = cur.fetchall()
    assert len(rows) == 2
    assert rows[0] == ("p1", "Atta 5kg", 250.0, 220.0, 15, None)
    assert rows[1] == ("p2", "Salt 1kg", 25.0, 20.0, 50, None)
    conn.close()

def test_extract_invoice_uncompressed_pdf():
    headers, shop_id, prod_id = get_auth_setup("pdf_uncomp_user@example.com")
    pdf_content = (
        b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n"
        b"4 0 obj\n<< /Length 300 >>\nstream\n"
        b"BT\n"
        b"50 700 Td (Sri Balaji Wholesale Traders) Tj\n"
        b"0 -20 Td (Invoice No: SBW-1002 Date: 12/09/2026) Tj\n"
        b"0 -20 Td (Item Description) Tj (Qty) Tj (Rate) Tj (Total) Tj\n"
        b"0 -20 Td (Tata Salt 1kg) Tj (20) Tj (25.00) Tj (500.00) Tj\n"
        b"0 -20 Td (Aashirvaad Atta 5kg) Tj (10) Tj (250.00) Tj (2500.00) Tj\n"
        b"ET\n"
        b"endstream\nendobj\n"
        b"xref\n0 5\n0000000000 65535 f \n"
        b"trailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF"
    )

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("invoice_raw.pdf", pdf_content, "application/pdf")},
        headers=headers
    )
    assert res.status_code == 200, f"Error: {res.text}"
    data = res.json()
    assert data["status"] == "success"
    assert data["engine_used"] == "backend_pdf_direct"
    assert data["diagnostics"]["document_type"] == "pdf"
    assert len(data["items"]) == 2

    salt_item = next(it for it in data["items"] if "tata salt" in it["product_name"].lower())
    assert salt_item["quantity"] == 20.0
    assert salt_item["rate"] == 25.0
    assert salt_item["line_total"] == 500.0
    assert salt_item["matched_product_id"] == prod_id

def test_extract_invoice_compressed_flatedecode_pdf():
    headers, shop_id, prod_id = get_auth_setup("pdf_flate_user@example.com")
    text_stream = (
        b"BT\n"
        b"50 700 Td (Sri Balaji Wholesale Traders) Tj\n"
        b"0 -20 Td (Invoice No: FLATE-992 Date: 18/09/2026) Tj\n"
        b"0 -20 Td (Item Description) Tj (Qty) Tj (Rate) Tj (Total) Tj\n"
        b"0 -20 Td (Tata Salt 1kg) Tj (15) Tj (25.00) Tj (375.00) Tj\n"
        b"0 -20 Td (Basmati Rice 5kg) Tj (4) Tj (450.00) Tj (1800.00) Tj\n"
        b"ET\n"
    )
    comp_stream = zlib.compress(text_stream)

    pdf_content = (
        b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n"
        b"4 0 obj\n<< /Length " + str(len(comp_stream)).encode() + b" /Filter /FlateDecode >>\nstream\n"
        + comp_stream +
        b"\nendstream\nendobj\n"
        b"xref\n0 5\n0000000000 65535 f \n"
        b"trailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF"
    )

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("invoice_compressed.pdf", pdf_content, "application/pdf")},
        headers=headers
    )
    assert res.status_code == 200, f"Error: {res.text}"
    data = res.json()
    assert data["status"] == "success"
    assert data["engine_used"] == "backend_pdf_direct"
    assert len(data["items"]) == 2

    salt_item = next(it for it in data["items"] if "tata salt" in it["product_name"].lower())
    assert salt_item["quantity"] == 15.0
    assert salt_item["rate"] == 25.0
    assert salt_item["line_total"] == 375.0
    assert salt_item["matched_product_id"] == prod_id



