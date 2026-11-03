"""
Tests for Grocery Specialization, Pack Size Extraction, and Excel-First Workflow.
"""

import io
from pathlib import Path
import openpyxl
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from db.session import Base
import db.models  # noqa: F401
from api.deps import get_db
from services.grocery_classifier import (
    classify_product,
    extract_pack_size,
    extract_brand,
)
from services.excel_invoice import (
    generate_invoice_workbook,
    parse_invoice_workbook,
    get_invoice_workbook_path,
)
from services.invoice_table import (
    ExtractedLine,
    Word,
    Column,
    extract_table,
    group_words_into_rows,
)

# In-memory test DB
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
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


client = TestClient(app)


def auth(email="grocery.test@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    token = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/api/v1/shops",
        json={"shop_name": "Grocery Mart", "owner_name": "Kirana Owner", "business_type": "Grocery/Kirana", "location": "Hyderabad"},
        headers=headers,
    )
    return headers


# --------------------------------------------------------------------------
# 1. Grocery Taxonomy and Normalization Tests
# --------------------------------------------------------------------------

def test_grocery_alias_normalization():
    # Pulses & Lentils
    c1 = classify_product("CHANNA DAL 1 KG", price=120.0, quantity=5.0)
    assert c1.is_grocery is True
    assert c1.category == "Pulses & Lentils"
    assert "Chana Dal" in c1.normalized_name

    # Gram Flour
    c2 = classify_product("BEST QUALITY BESAN 500 GM", price=45.0, quantity=10.0)
    assert c2.is_grocery is True
    assert c2.category == "Pulses & Lentils"
    assert "Besan" in c2.normalized_name

    # Spices
    c3 = classify_product("EVEREST HALDI POWDER 200 G", price=55.0, quantity=12.0)
    assert c3.is_grocery is True
    assert c3.brand == "Everest"
    assert c3.category == "Spices & Seasonings"
    assert "Turmeric" in c3.normalized_name

    # Oils
    c4 = classify_product("FORTUNE SUN FLOWER OIL 1 LTR", price=135.0, quantity=15.0)
    assert c4.is_grocery is True
    assert c4.brand == "Fortune"
    assert c4.category == "Cooking Oils & Fats"
    assert "Sunflower Oil" in c4.normalized_name

    # Grains
    c5 = classify_product("DAAWAT BASMATI RICE 5 KG", price=450.0, quantity=4.0)
    assert c5.is_grocery is True
    assert c5.brand == "Daawat"
    assert c5.category == "Grains & Staples"
    assert "Basmati Rice" in c5.normalized_name


def test_pack_size_separated_from_quantity():
    """Verify that pack size (50 kg) is never confused with purchased quantity (1 BOR)."""
    title, pack_size, pack_unit = extract_pack_size("CHANA 50 KG")
    assert pack_size == 50.0
    assert pack_unit == "kg"

    # Row with pack size in name and separate quantity
    cls = classify_product("CHANA 50 KG", price=2760.0, quantity=1.0, unit="BOR")
    assert cls.pack_size == 50.0
    assert cls.pack_size_unit == "kg"
    assert cls.status == "GROCERY_CONFIDENT"


def test_non_grocery_items_classification():
    """Non-grocery items (freight, packaging, stationery) receive NON_GROCERY status."""
    c1 = classify_product("FREIGHT AND DELIVERY CHARGES", price=250.0, quantity=1.0)
    assert c1.is_grocery is False
    assert c1.status == "NON_GROCERY"

    c2 = classify_product("OFFICE STATIONERY PAPER RIM", price=150.0, quantity=2.0)
    assert c2.is_grocery is False
    assert c2.status == "NON_GROCERY"

    c3 = classify_product("MOTOR OIL 20W40 1L", price=350.0, quantity=1.0)
    assert c3.is_grocery is False
    assert c3.status == "NON_GROCERY"


def test_unknown_items_preserved_never_discarded():
    """Unrecognized products get UNKNOWN_REVIEW status and are retained for user review."""
    c = classify_product("XYZ HERBAL ROOTS", price=80.0, quantity=1.0)
    assert c.status == "UNKNOWN_REVIEW"
    assert len(c.review_reasons) > 0


# --------------------------------------------------------------------------
# 2. Excel-First Workbook Generation and Cell Parsing Tests
# --------------------------------------------------------------------------

def test_excel_workbook_generation_and_reopen():
    inv_id = "test_inv_excel_1"
    raw_rows = [
        {"row_index": 1, "is_item": True, "text": "Chana Dal 1 kg  10  pcs  120.00  1200.00", "cells": {"product": "Chana Dal 1 kg", "qty": "10", "rate": "120.00", "total": "1200.00"}},
        {"row_index": 2, "is_item": True, "text": "Sugar 50 kg  2  BOR  1950.00  3900.00", "cells": {"product": "Sugar 50 kg", "qty": "2", "rate": "1950.00", "total": "3900.00"}},
    ]
    cols = [
        Column("product", "Item Description", 10.0, 200.0),
        Column("qty", "Qty", 210.0, 250.0),
        Column("rate", "Rate", 260.0, 320.0),
        Column("total", "Amount", 330.0, 420.0),
    ]
    extracted_items = [
        ExtractedLine(
            product_name="Chana Dal 1 kg", quantity=10.0, unit="pcs", rate=120.0, purchase_price=120.0,
            selling_price=135.0, invoice_mrp=140.0, discount=None, discount_pct=None, tax_amount=None,
            gst_rate=None, taxable_amount=None, hsn_code="0713", barcode=None, line_total=1200.0,
            line_total_source="INVOICE", arithmetic_status="VERIFIED", confidence=95.0, issues=[],
            suggestions=[], suggested_rate=None, raw_cells={}, source_text="Chana Dal", row_index=1,
            extraction_method="TABLE_STRUCTURED", pack_size=1.0, pack_size_unit="kg",
            classification_status="GROCERY_CONFIDENT", is_grocery=True, brand=None,
            normalized_name="Chana Dal 1 kg", category="Pulses & Lentils",
        ),
        ExtractedLine(
            product_name="Sugar 50 kg", quantity=2.0, unit="BOR", rate=1950.0, purchase_price=1950.0,
            selling_price=2100.0, invoice_mrp=2200.0, discount=None, discount_pct=None, tax_amount=None,
            gst_rate=None, taxable_amount=None, hsn_code="1701", barcode=None, line_total=3900.0,
            line_total_source="INVOICE", arithmetic_status="VERIFIED", confidence=95.0, issues=[],
            suggestions=[], suggested_rate=None, raw_cells={}, source_text="Sugar 50 kg", row_index=2,
            extraction_method="TABLE_STRUCTURED", pack_size=50.0, pack_size_unit="kg",
            classification_status="GROCERY_CONFIDENT", is_grocery=True, brand=None,
            normalized_name="Sugar 50 kg", category="Packaged Groceries",
        ),
    ]
    classifications = [
        classify_product("Chana Dal 1 kg", price=120.0, quantity=10.0),
        classify_product("Sugar 50 kg", price=1950.0, quantity=2.0),
    ]

    # 1. Generate real Excel file
    wb_path = generate_invoice_workbook(
        invoice_id=inv_id,
        raw_rows=raw_rows,
        columns=cols,
        extracted_items=extracted_items,
        classifications=classifications,
        raw_ocr_words=[],
        metadata={"supplier_name": "Sri Balaji Traders", "invoice_number": "SB-1001", "invoice_date": "24/10/2026"},
        warnings=[],
    )

    assert wb_path.exists()
    assert wb_path.name == f"{inv_id}.xlsx"

    # 2. Inspect sheets in generated workbook
    wb = openpyxl.load_workbook(str(wb_path))
    assert set(wb.sheetnames) == {"Raw Invoice", "Grocery Items", "Review Required", "OCR Audit"}
    wb.close()

    # 3. Parse cells from the workbook
    parsed_cells = parse_invoice_workbook(wb_path)
    assert len(parsed_cells) == 2
    item1 = parsed_cells[0]
    assert "Chana Dal" in item1["product_name"]
    assert item1["quantity"] == 10.0
    assert item1["purchase_price"] == 120.0
    assert item1["line_total"] == 1200.0
    assert item1["status"] == "GROCERY_CONFIDENT"

    item2 = parsed_cells[1]
    assert "Sugar" in item2["product_name"]
    assert item2["quantity"] == 2.0
    assert item2["unit"] == "BOR"
    assert item2["purchase_price"] == 1950.0


# --------------------------------------------------------------------------
# 3. End-to-End Extraction API with Excel Download Test
# --------------------------------------------------------------------------

def test_extract_invoice_returns_excel_download_url():
    headers = auth("excel.downloader@example.com")
    text_content = (
        "Sri Balaji Wholesale Traders\n"
        "Invoice No: SBW-9901    Date: 24/10/2026\n"
        "Item Description           Qty    Unit    Rate       MRP      Amount\n"
        "Tata Salt 1kg              24     pcs     ₹22.00     28.00    528.00\n"
        "Fortune Sunflower Oil 1L   10     pcs     135.00     160.00   1,350.00\n"
        "Chana 50 kg                1      BOR     2760.00    3200.00  2,760.00\n"
        "Freight Charges            1      pcs     150.00     150.00   150.00\n"
        "Grand Total: 4,788.00\n"
    )

    res = client.post(
        "/api/v1/invoices/extract",
        files={"file": ("invoice.txt", text_content.encode("utf-8"), "text/plain")},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["id"].startswith("inv_")
    assert data["excel_download_url"] is not None
    assert f"/api/v1/invoices/{data['id']}/excel" == data["excel_download_url"]
    assert data["total_grocery_items"] >= 2
    assert len(data["items"]) >= 3

    # Check Chana 50 kg item
    chana = next(i for i in data["items"] if "chana" in i["product_name"].lower())
    assert chana["pack_size"] == 50.0
    assert chana["pack_size_unit"] == "kg"
    assert chana["quantity"] == 1.0
    assert chana["unit"].upper() == "BOR"

    # Test downloading the Excel file
    dl_res = client.get(data["excel_download_url"], headers=headers)
    assert dl_res.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in dl_res.headers["content-type"]
    assert len(dl_res.content) > 1000

    # Verify that downloaded bytes can be opened by openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(dl_res.content))
    assert "Grocery Items" in wb.sheetnames
    assert "Raw Invoice" in wb.sheetnames
    wb.close()
