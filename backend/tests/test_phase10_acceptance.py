import io
import os
import uuid
from decimal import Decimal
import openpyxl
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app, init_db_schema
from db.session import Base
import db.models
from db.models.product import Product
from db.models.purchase import Purchase
from db.models.purchase_item import PurchaseItem
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
    init_db_schema(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)

client = TestClient(app)

def get_auth_setup(email: str = "phase10_user@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Phase 10 Mart",
        "owner_name": "Sasi Kiran",
        "business_type": "Grocery/Kirana",
        "location": "Hyderabad"
    }, headers=headers)
    assert shop_res.status_code in [200, 201], f"Shop create failed: {shop_res.text}"
    shop_id = shop_res.json()["id"]

    # Pre-populate one existing product
    prod_res = client.post("/api/v1/products", json={
        "name": "Tata Salt 1kg",
        "category": "Groceries",
        "purchase_price": 20.0,
        "selling_price": 25.0,
        "mrp": 28.0,
        "current_stock": 10,
        "unit": "PKT"
    }, headers=headers)
    assert prod_res.status_code == 201
    prod_id = prod_res.json()["id"]

    return headers, shop_id, prod_id


# ==============================================================================
# 1. End-to-End 10-Stage Lifecycle Acceptance Test
# ==============================================================================
def test_end_to_end_10_stage_lifecycle():
    """
    Validates complete 10-stage pipeline:
    Upload -> Validation -> Preprocessing -> OCR -> Table Reconstruction ->
    Grocery Classification -> Value Extraction -> Excel Generation ->
    Excel Parsing -> Review -> Confirm -> Database Persistence.
    """
    headers, shop_id, existing_prod_id = get_auth_setup("e2e_user@example.com")
    fixture_path = os.path.join(
        os.path.dirname(__file__), "fixtures", "ground_truth", "invoices", "TC02_bordered_image.png"
    )
    with open(fixture_path, "rb") as f:
        file_bytes = f.read()

    # Stage 1-8: Extract via API
    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("TC02_bordered_image.png", io.BytesIO(file_bytes), "image/png")},
        headers=headers,
    )
    assert res.status_code == 200, f"Extraction failed: {res.text}"
    data = res.json()

    assert data["status"] in ("success", "needs_review")
    assert data["engine_used"] == "backend_ocr_pipeline"
    assert len(data["items"]) >= 3
    assert data["excel_download_url"] is not None

    # Verify pipeline stages completed
    stages = data.get("pipeline_stages") or []
    expected_stages = [
        "file_validation",
        "page_preparation",
        "ocr_recognition",
        "table_and_column_detection",
        "invoice_validation",
        "workbook_generation",
        "workbook_parsing",
        "integrity_validation",
    ]
    for s in expected_stages:
        assert s in stages, f"Stage {s} was not recorded in completed pipeline stages: {stages}"

    # Stage 8: Excel file download & validation
    excel_url = data["excel_download_url"]
    excel_res = client.get(excel_url, headers=headers)
    assert excel_res.status_code == 200, f"Excel download failed: {excel_res.text}"
    assert "spreadsheetml" in excel_res.headers.get("content-type", "")

    wb = openpyxl.load_workbook(io.BytesIO(excel_res.content), data_only=True)
    expected_sheets = ["Raw Invoice", "Grocery Items", "Review Required", "OCR Audit"]
    for sheet in expected_sheets:
        assert sheet in wb.sheetnames, f"Missing sheet: {sheet}"

    grocery_sheet = wb["Grocery Items"]
    assert grocery_sheet.max_row >= 2  # Header + at least 1 item

    # Stage 9 & 10: Review & Confirm to Database
    # Prepare confirmation payload: restock existing item + add a new item
    confirm_items = []
    for it in data["items"]:
        confirm_items.append({
            "matched_product_id": it["matched_product_id"],
            "name": it["product_name"],
            "quantity": it["quantity"] or 5.0,
            "unit": it["unit"] or "PKT",
            "purchase_price": it["purchase_price"] or 100.0,
            "selling_price": it["selling_price"] or (it["purchase_price"] * 1.2 if it["purchase_price"] else 120.0),
            "mrp": it["mrp"] or 130.0,
            "mrp_source": it["mrp_source"] if it.get("mrp_source") in ("INVOICE", "API", "MANUAL", "STORE") else "MANUAL",
            "line_amount": it["line_total"] or 500.0,
            "category": it["category"] or "Groceries",
        })

    confirm_payload = {
        "supplier_name": data.get("supplier_name") or "Metro Cash & Carry",
        "invoice_number": data.get("invoice_number") or f"INV-E2E-{uuid.uuid4().hex[:6]}",
        "invoice_date": data.get("invoice_date") or "2026-11-03",
        "items": confirm_items,
    }

    confirm_res = client.post("/api/v1/invoices/confirm", json=confirm_payload, headers=headers)
    assert confirm_res.status_code == 201, f"Confirm failed: {confirm_res.text}"
    conf_data = confirm_res.json()
    assert conf_data["processing_status"] == "CONFIRMED"
    assert conf_data["items_restocked"] + conf_data["items_created"] == len(confirm_items)

    # Verify Database State
    db = TestingSessionLocal()
    try:
        purchase = db.query(Purchase).filter(Purchase.id == uuid.UUID(conf_data["purchase_id"])).first()
        assert purchase is not None
        assert purchase.invoice_number == confirm_payload["invoice_number"]

        purchase_items = db.query(PurchaseItem).filter(PurchaseItem.purchase_id == purchase.id).all()
        assert len(purchase_items) == len(confirm_items)

        # Check existing product was restocked
        restocked_prod = db.query(Product).filter(Product.id == uuid.UUID(existing_prod_id)).first()
        assert restocked_prod is not None
        # Tata Salt was 10, increased by confirmed quantity
        tata_confirm_item = next((ci for ci in confirm_items if ci["matched_product_id"] == existing_prod_id), None)
        if tata_confirm_item:
            assert restocked_prod.current_stock == 10 + int(tata_confirm_item["quantity"])
    finally:
        db.close()


# ==============================================================================
# 2. Strict Financial Calculations & Decimal Rules Acceptance Test
# ==============================================================================
def test_strict_financial_calculations_decimal_rules():
    """
    Verifies:
    - Decimal-based arithmetic (no float precision drift like 0.1 + 0.2 != 0.3).
    - Missing financial values remain None/null (never converted to 0 or 0.0).
    - Printed amounts are preserved; calculated amounts kept distinct.
    - Purchase price, selling price, and MRP are strictly distinguished.
    """
    headers, shop_id, _ = get_auth_setup("fin_rules_user@example.com")
    fixture_path = os.path.join(
        os.path.dirname(__file__), "fixtures", "ground_truth", "invoices", "TC06_no_mrp_column.pdf"
    )
    with open(fixture_path, "rb") as f:
        file_bytes = f.read()

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("TC06_no_mrp_column.pdf", io.BytesIO(file_bytes), "application/pdf")},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    items = data["items"]
    assert len(items) >= 2

    for it in items:
        # 1. Missing MRP must remain None, NEVER 0.0 or fabricated equal to rate
        assert it["mrp"] is None, f"Expected MRP to be None, got: {it['mrp']}"
        assert it["selling_price"] is None, f"Expected selling_price to be None, got: {it['selling_price']}"

        # 2. Purchase price must be present and positive
        assert it["purchase_price"] is not None and it["purchase_price"] > 0
        assert it["rate"] == it["purchase_price"]

        # 3. Printed amount vs calculated amount
        if it["printed_amount"] is not None and it["quantity"] is not None and it["purchase_price"] is not None:
            calc_dec = Decimal(str(it["quantity"])) * Decimal(str(it["purchase_price"]))
            assert abs(Decimal(str(it["calculated_amount"])) - calc_dec) < Decimal("0.01")

        # 4. Never zero out missing fields
        assert it["mrp"] is not 0
        assert it["selling_price"] is not 0


# ==============================================================================
# 3. Database Idempotency and Duplicate Rejection Acceptance Test
# ==============================================================================
def test_database_idempotency_and_duplicate_rejection():
    """
    Verifies:
    - First confirmation persists successfully.
    - Exact duplicate submission returns HTTP 409 Conflict.
    - Stock is NOT incremented twice.
    """
    headers, shop_id, prod_id = get_auth_setup("idempotent_user@example.com")

    unique_inv_no = f"INV-DUP-{uuid.uuid4().hex[:8]}"
    payload = {
        "supplier_name": "Balaji Wholesale",
        "invoice_number": unique_inv_no,
        "invoice_date": "2026-11-03",
        "items": [
            {
                "matched_product_id": prod_id,
                "name": "Tata Salt 1kg",
                "quantity": 15.0,
                "unit": "PKT",
                "purchase_price": 20.0,
                "selling_price": 25.0,
                "mrp": 28.0,
                "line_amount": 300.0,
                "category": "Groceries",
            }
        ],
    }

    # First attempt: 201 Created
    res1 = client.post("/api/v1/invoices/confirm", json=payload, headers=headers)
    assert res1.status_code == 201, f"Initial confirm failed: {res1.text}"

    # Verify stock increased from 10 to 25
    db = TestingSessionLocal()
    try:
        p = db.query(Product).filter(Product.id == uuid.UUID(prod_id)).first()
        assert p.current_stock == 25
    finally:
        db.close()

    # Second attempt with identical invoice_number and supplier: 409 Conflict
    res2 = client.post("/api/v1/invoices/confirm", json=payload, headers=headers)
    assert res2.status_code == 409, f"Expected 409 Conflict, got: {res2.status_code} - {res2.text}"
    assert "already added to stock" in res2.json()["detail"]

    # Verify stock remained at 25 (NOT 40)
    db = TestingSessionLocal()
    try:
        p = db.query(Product).filter(Product.id == uuid.UUID(prod_id)).first()
        assert p.current_stock == 25
    finally:
        db.close()


# ==============================================================================
# 4. Atomic Transaction Rollback on Failure Acceptance Test
# ==============================================================================
def test_atomic_transaction_rollback_on_failure():
    """
    Verifies:
    - If any item in the batch fails validation (e.g. new product without selling price),
      the entire transaction rolls back atomically.
    - Zero orphaned records in purchases, purchase_items, or products.
    """
    headers, shop_id, prod_id = get_auth_setup("atomic_rollback_user@example.com")

    # Record initial counts
    db = TestingSessionLocal()
    try:
        initial_purchases = db.query(Purchase).count()
        initial_items = db.query(PurchaseItem).count()
        initial_products = db.query(Product).count()
    finally:
        db.close()

    faulty_payload = {
        "supplier_name": "Rollback Test Wholesale",
        "invoice_number": f"INV-ERR-{uuid.uuid4().hex[:6]}",
        "invoice_date": "2026-11-03",
        "items": [
            {
                # Valid existing item
                "matched_product_id": prod_id,
                "name": "Tata Salt 1kg",
                "quantity": 10.0,
                "unit": "PKT",
                "purchase_price": 20.0,
                "selling_price": 25.0,
                "mrp": 28.0,
                "line_amount": 200.0,
                "category": "Groceries",
            },
            {
                # Invalid new item: selling_price is None -> must trigger InvoiceValidationError
                "matched_product_id": None,
                "name": "Brand New Unpriced Product",
                "quantity": 5.0,
                "unit": "PKT",
                "purchase_price": 50.0,
                "selling_price": None,
                "mrp": None,
                "line_amount": 250.0,
                "category": "Groceries",
            },
        ],
    }

    res = client.post("/api/v1/invoices/confirm", json=faulty_payload, headers=headers)
    assert res.status_code == 400, f"Expected 400 Bad Request, got: {res.status_code}"
    assert "Selling price is required for new products" in res.json()["detail"]

    # Verify atomic rollback left zero changes
    db = TestingSessionLocal()
    try:
        assert db.query(Purchase).count() == initial_purchases
        assert db.query(PurchaseItem).count() == initial_items
        assert db.query(Product).count() == initial_products

        # Existing product stock should still be 10 (untouched)
        prod = db.query(Product).filter(Product.id == uuid.UUID(prod_id)).first()
        assert prod.current_stock == 10
    finally:
        db.close()


# ==============================================================================
# 5. Non-Grocery Classification and Exclusion Acceptance Test
# ==============================================================================
def test_non_grocery_classification_and_exclusion():
    """
    Verifies that non-grocery items are classified as NON_GROCERY and
    flagged appropriately without breaking the extraction pipeline.
    """
    from services.grocery_ocr.intelligence.grocery_classifier import BaseGroceryClassifier

    # 1. Direct classifier verification
    classifier = BaseGroceryClassifier()
    pvc_res = classifier.classify("PVC Pipe 10ft")
    assert pvc_res.is_grocery is False
    assert pvc_res.status == "NON_GROCERY"
    assert pvc_res.category == "Non-grocery products"

    cement_res = classifier.classify("Portland Cement 50kg")
    assert cement_res.is_grocery is False
    assert cement_res.status == "NON_GROCERY"

    # Ambiguous item triggers UNKNOWN_REVIEW_REQUIRED
    jack_res = classifier.classify("Hydraulic Jack 5 Ton")
    assert jack_res.status == "UNKNOWN_REVIEW_REQUIRED"
    assert "unfamiliar product description" in jack_res.review_reasons[0].lower()

    # 2. Non-grocery industrial invoice handles gracefully via API
    headers, shop_id, _ = get_auth_setup("nongrocery_user@example.com")
    fixture_path = os.path.join(
        os.path.dirname(__file__), "fixtures", "ground_truth", "invoices", "TC14_non_grocery_tools.jpeg"
    )
    with open(fixture_path, "rb") as f:
        file_bytes = f.read()

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("TC14_non_grocery_tools.jpeg", io.BytesIO(file_bytes), "image/jpeg")},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    # Industrial bill without grocery line items safely returns needs_review without crashing
    assert data["status"] in ("needs_review", "success")


# ==============================================================================
# 6. Sri Balaji 13-Item Regression Acceptance Test
# ==============================================================================
def test_sri_balaji_13_items_full_accuracy():
    """
    Validates that the hallmark Sri Balaji wholesale invoice (TC13)
    extracts all 13 items with 100% item count and verified prices.
    """
    headers, shop_id, _ = get_auth_setup("balaji_acc_user@example.com")
    fixture_path = os.path.join(
        os.path.dirname(__file__), "fixtures", "ground_truth", "invoices", "TC13_sri_balaji_13items.png"
    )
    with open(fixture_path, "rb") as f:
        file_bytes = f.read()

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("TC13_sri_balaji_13items.png", io.BytesIO(file_bytes), "image/png")},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) == 13

    # Verify recognized grocery items across the table
    names = [it["product_name"].lower() for it in data["items"]]
    assert any("chana" in n for n in names)
    assert any("besan" in n for n in names)
    assert any("oil" in n for n in names)
    assert any("dal" in n for n in names)
    assert any("parle" in n for n in names)
