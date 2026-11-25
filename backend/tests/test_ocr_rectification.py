"""
OCR scanner rectification: one test per root cause found, plus the complete pack-size flow.

Root causes (each reproduced before the fix):
  R-A  line reconstruction split a header whose words had taller boxes (TC30: Qty/Unit lost)
  R-B  the automatic page layout dropped a ruled table / a column band / single-digit quantities
       (TC03, TC30, OR01): both layouts are now read and the better one chosen by rule
  R-C  CLAHE ran on clean pages and photos because overall deviation was used as "contrast" (TC03)
  R-D  decimal-comma money ('2.350,00') read as 2.35 without a warning
  R-E  a "Pack" column was taken as the billing unit; "UOM" misreads were not recognised (OR01, OR02)
  R-F  invoice names with a pack size did not match the shop's product ('Basmati Rice 25kg')
  R-G  pack size never reached stock/cost: "2 bag x 25 kg" could not be added to a kg product
  R-H  (frontend) selling prices were invented on confirm; covered in src/tests/invoicePack.test.ts
In-memory database; generic test values. backend/shoppulse.db is never touched.
"""
import json
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import db.models  # noqa: F401
from api.deps import get_db
from db.session import Base
from main import app
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRPageResult, OCRWord
from services.invoice_pack_pricing import cost_invoice_line
from services.pricing_engine import calculate_purchase_cost
from services.product_matching import inventory_name_similarity, name_similarity

HERE = Path(__file__).resolve().parent
_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(bind=_engine)


# ------------------------------------------------------------------------------ R-A line reconstruction

def _w(text, x0, y0, y1):
    return OCRWord(text=text, bbox=BoundingBox(x0=x0, y0=y0, x1=x0 + 60, y1=y1), confidence=95.0, page_number=1)


def test_ra_header_with_tall_word_boxes_stays_one_line():
    from services.grocery_ocr.processors.text_line_reconstructor import TextLineReconstructor

    words = [_w("Product", 52, 155, 172), _w("Name", 150, 155, 172), _w("Qty", 481, 151, 182), _w("Unit", 582, 151, 182),
             _w("Rate", 682, 151, 182), _w("MRP", 792, 155, 172), _w("Amount", 920, 155, 172),
             _w("Coffee", 51, 199, 214), _w("15", 482, 199, 214), _w("jar", 579, 199, 218)]
    lines = TextLineReconstructor().reconstruct_lines(words, page_width=1200, page_height=600)
    assert [ln.text for ln in lines] == ["Product Name Qty Unit Rate MRP Amount", "Coffee 15 jar"]


# ------------------------------------------------------------------------------ R-B layout selection

def _page(tokens, conf=90.0):
    words = [OCRWord(text=t, bbox=BoundingBox(x0=i * 50.0, y0=10.0, x1=i * 50.0 + 40, y1=30.0), confidence=conf, page_number=1)
             for i, t in enumerate(tokens)]
    return OCRPageResult(width=2000, height=1000, raw_text=" ".join(tokens), words=words, confidence=conf)


def test_rb_second_reading_chosen_for_lost_single_digit_quantities():
    from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline
    from services.grocery_ocr.schemas.invoice import InvoiceProcessingMetadata

    default = ["Rice", "2350.00", "4700.00", "Sugar", "2200.00", "2200.00", "Dal", "10", "135.00", "1350.00"]
    alt = ["Rice", "2", "2350.00", "4700.00", "Sugar", "1", "2200.00", "2200.00", "Dal", "10", "135.00", "1350.00"]
    meta = InvoiceProcessingMetadata(filename="t.png")
    chosen = InvoicePipeline(ocr_engine=None)._compare_fallback_segmentation(b"", 1, _page(default), meta, alt_page=_page(alt))
    assert meta.custom_properties["ocr_psm_selection"][0]["reason"] == "read more numbers (e.g. quantities)"
    assert [w.text for w in chosen.words][1] == "2"


def test_rb_second_reading_not_chosen_when_it_loses_amounts_or_confidence():
    from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline
    from services.grocery_ocr.schemas.invoice import InvoiceProcessingMetadata

    default = ["Rice", "2", "2350.00", "4700.00", "Sugar", "1", "2200.00", "2200.00"]
    meta = InvoiceProcessingMetadata(filename="t.png")
    pipe = InvoicePipeline(ocr_engine=None)
    # fewer amounts
    assert pipe._compare_fallback_segmentation(b"", 1, _page(default), meta, alt_page=_page(["Rice", "2", "3", "4", "5", "2350."])).words[2].text == "2350.00"
    # more numbers but far lower confidence
    worse = _page(default + ["7", "8", "9"], conf=70.0)
    assert pipe._compare_fallback_segmentation(b"", 1, _page(default), meta, alt_page=worse).confidence == 90.0


# ------------------------------------------------------------------------------ R-C contrast test

def test_rc_clahe_only_for_faded_pages_not_clean_or_photographed_ones():
    import cv2
    import numpy as np
    from services.grocery_ocr.processors.image_processor import BaseImageProcessor

    clean = np.full((600, 900, 3), 255, np.uint8)  # mostly white, crisp black text: low deviation, high contrast
    cv2.putText(clean, "Basmati Rice 25 kg 2 bag 2350.00", (30, 300), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    res = BaseImageProcessor().preprocess(cv2.imencode(".png", clean)[1].tobytes())
    assert "clahe_contrast_enhancement" not in res.preprocessing_steps_applied
    assert res.metadata["ink_spread"] >= 200

    photo = HERE / "fixtures" / "ground_truth" / "invoices" / "TC03_phone_photo.jpg"
    assert "clahe_contrast_enhancement" not in BaseImageProcessor().preprocess(photo.read_bytes()).preprocessing_steps_applied

    faded = HERE / "fixtures" / "ground_truth" / "invoices" / "TC20_faded_thermal_receipt.png"
    assert "clahe_contrast_enhancement" in BaseImageProcessor().preprocess(faded.read_bytes()).preprocessing_steps_applied


# ------------------------------------------------------------------------------ R-D numbers

@pytest.mark.parametrize("text,value,flagged", [
    ("2,350.00", "2350.00", False), ("₹2,350", "2350.00", False), ("₹ 2350.50", "2350.50", False),
    ("1,23,456.75", "123456.75", False), ("2.350,00", "2350.00", True), ("12,50", "12.50", True),
    ("(50.00)", "-50.00", False), ("2,35O.00", "2350.00", True),
])
def test_rd_money_formats(text, value, flagged):
    from services.grocery_ocr.extraction.numeric_parser import NumericParser

    r = NumericParser().parse_currency(text)
    assert r.value == Decimal(value)
    assert bool(r.issues) == flagged and (r.confidence < 100) == flagged


def test_rd_ambiguous_dot_value_is_left_as_printed():
    from services.grocery_ocr.extraction.numeric_parser import NumericParser

    assert NumericParser().parse_currency("2.350").value == Decimal("2.350")


# ------------------------------------------------------------------------------ R-E header roles

@pytest.mark.parametrize("header,role", [
    ("Pack", "pack_size"), ("Pack Size", "pack_size"), ("Net Wt", "pack_size"), ("UOM", "unit"), ("UuoM", "unit"),
    ("Unit", "unit"), ("Nos", "qty"), ("Particulars", "product"), ("Unit Price", "rate"), ("Value", "total"),
])
def test_re_header_synonyms(header, role):
    from services.grocery_ocr.extraction.header_intelligence import HEADER_SEMANTIC_ALIASES

    assert header.lower() in HEADER_SEMANTIC_ALIASES[role]


# ------------------------------------------------------------------------------ R-F matching

def test_rf_inventory_matching_tolerates_a_printed_pack_size_only():
    assert inventory_name_similarity("Basmati Rice 25kg", "Basmati Rice") == 1.0
    assert inventory_name_similarity("SUGAR 1KG", "Sugar") == 1.0
    assert inventory_name_similarity("Sugar 2kg", "Sugar 1kg") == 0.0  # different packs never match
    assert inventory_name_similarity("Sugar Free", "Sugar") < 0.88
    assert inventory_name_similarity("Black Salt 100g", "Salt") < 0.88
    # External MRP lookups keep the strict rule: a pack-less name must not borrow a packed price
    assert name_similarity("Tata Salt 1kg", "Tata Salt") < 1.0


# ------------------------------------------------------------------------------ R-G pack -> physical -> pricing engine

def test_rg_spec_example_through_the_existing_engine():
    c = cost_invoice_line(2, "bag", 2350, 25, "kg", 4700)
    assert (c.physical_quantity, c.standard_unit, c.cost_per_standard_unit, c.line_cost) == (Decimal("50"), "kg", Decimal("94.000"), Decimal("4700.00"))
    assert c.conversion_status == "PACK_CONVERTED" and not c.needs_review
    # The engine then prices part quantities from that basis
    assert calculate_purchase_cost(500, "g", c.cost_per_standard_unit, 1, "kg").line_cost == Decimal("47.00")
    assert calculate_purchase_cost(250, "g", c.cost_per_standard_unit, 1, "kg").line_cost == Decimal("23.50")


@pytest.mark.parametrize("args,physical,std,per_std,status", [
    ((20, "pkt", 145, 250, "g", 2900), "5", "kg", "580.000", "PACK_CONVERTED"),
    ((10, "box", 165, 475, "g", 1650), "4.75", "kg", "347.368", "PACK_CONVERTED"),
    ((4, "can", 640, 5, "L", 2560), "20", "L", "128.000", "PACK_CONVERTED"),
    ((12, "pcs", 140, 1, "L", 1680), "12", "L", "140.000", "COUNT_ONLY"),
    ((5, "kg", 60, None, None, 300), "5", "kg", "60.000", "NONE"),
    ((3, "bag", 100, 3, "kg", 300), "9", "kg", "33.333", "PACK_CONVERTED"),
])
def test_rg_pack_cases(args, physical, std, per_std, status):
    c = cost_invoice_line(*args)
    assert (c.physical_quantity, c.standard_unit, c.cost_per_standard_unit, c.conversion_status) == (
        Decimal(physical), std, Decimal(per_std), status)


def test_rg_rate_per_kg_detected_and_flagged_never_miscosted():
    c = cost_invoice_line(2, "bag", 44, 50, "kg", 4400)
    assert (c.rate_basis_unit, c.cost_per_standard_unit, c.line_cost, c.needs_review) == ("kg", Decimal("44.000"), Decimal("4400.00"), True)


def test_rg_nothing_guessed_without_values():
    assert cost_invoice_line(2, None, 2350, 25, "kg", 4700).physical_quantity is None
    assert cost_invoice_line(2, "bag", None, 25, "kg", 4700).cost_per_standard_unit is None
    assert cost_invoice_line(2, "bag", 2350, None, None, 4700).physical_quantity == Decimal("2")  # bags, not kg


# ------------------------------------------------------------------------------ API: extract -> review -> confirm -> stock

@pytest.fixture()
def api():
    Base.metadata.create_all(bind=_engine)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    email = f"ocr{uuid.uuid4().hex[:8]}@example.com"
    c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    h = {"Authorization": "Bearer " + c.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]}
    c.post("/api/v1/shops", json={"shop_name": "K", "owner_name": "R", "business_type": "Grocery/Kirana", "location": "B"}, headers=h)
    yield c, h
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)


def _product(c, h, name, unit, stock, sp=120.0, cost=90.0, mrp=None):
    body = {"name": name, "unit": unit, "current_stock": stock, "selling_price": sp, "purchase_price": cost, "pricing_status": "VERIFIED"}
    if mrp:
        body["mrp"] = mrp
    r = c.post("/api/v1/products", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _extract(c, h, lines, inv="SBW-9001"):
    text = f"SRI BALAJI WHOLESALE TRADERS\nInvoice No: {inv}    Date: 08/10/2026\n\nSl  Item Description           Qty   Unit   Rate      Amount\n"
    text += "\n".join(f"{i + 1}   {l}" for i, l in enumerate(lines)) + "\n\nGrand Total    0\n"
    r = c.post("/api/v1/invoices/extract", files={"file": ("inv.txt", text.encode(), "text/plain")}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _confirm(c, h, items, inv="SBW-9001"):
    return c.post("/api/v1/invoices/confirm", json={"supplier_name": "Sri Balaji", "invoice_number": inv, "items": items}, headers=h)


def _item(it, **over):
    base = {"name": it["product_name"], "quantity": it["quantity"], "unit": it["unit"], "purchase_price": it["purchase_price"],
            "line_amount": it["line_total"], "matched_product_id": it["matched_product_id"], "pack_size": it["pack_size"],
            "pack_size_unit": it["pack_size_unit"], "rate_basis_unit": it["rate_basis_unit"]}
    base.update(over)
    return base


def test_api_bags_into_a_kg_product(api):
    c, h = api
    rice = _product(c, h, "Basmati Rice", "kg", 10)
    it = _extract(c, h, ["Basmati Rice 25kg           2    bag    2350.00   4700.00"])["items"][0]
    assert it["matched_product_id"] == rice["id"]
    assert (it["physical_quantity"], it["standard_unit"], it["cost_per_standard_unit"]) == (50.0, "kg", 94.0)
    r = _confirm(c, h, [_item(it)])
    assert r.status_code == 201, r.text
    p = c.get(f"/api/v1/products/{rice['id']}", headers=h).json()
    assert (p["current_stock"], p["purchase_price"], p["selling_price"]) == (60, 94.0, 120.0)  # selling price untouched
    pur = c.get("/api/v1/purchases", headers=h).json()
    line = (pur[0] if isinstance(pur, list) else pur["items"][0])["items"][0]
    assert (line["quantity"], line["purchase_price"], line["line_amount"], line["price_basis_unit"]) == (2, 2350.0, 4700.0, "bag")
    # Duplicate invoice: refused, stock unchanged
    assert _confirm(c, h, [_item(it)]).status_code == 409
    assert c.get(f"/api/v1/products/{rice['id']}", headers=h).json()["current_stock"] == 60


def test_api_bags_into_a_product_sold_per_bag(api):
    c, h = api
    atta = _product(c, h, "Aashirvaad Atta", "bag", 3, sp=280, cost=240)
    it = _extract(c, h, ["Aashirvaad Atta 5kg          4    bag     245.00    980.00"])["items"][0]
    assert _confirm(c, h, [_item(it)]).status_code == 201
    p = c.get(f"/api/v1/products/{atta['id']}", headers=h).json()
    assert (p["current_stock"], p["purchase_price"]) == (7, 245.0)


@pytest.mark.parametrize("stock_unit,stock,unit,cost", [(None, 2, "bag", 2350.0), ("kg", 50, "kg", 94.0)])
def test_api_new_product_stock_unit_choice(api, stock_unit, stock, unit, cost):
    c, h = api
    it = _extract(c, h, ["Sona Masoori Rice 25kg        2    bag    2350.00   4700.00"])["items"][0]
    item = _item(it, name="Sona Masoori Rice", selling_price=110.0, price_basis_quantity=1, price_basis_unit=stock_unit or "bag")
    if stock_unit:
        item["stock_unit"] = stock_unit
    r = _confirm(c, h, [item])
    assert r.status_code == 201, r.text
    p = r.json()["saved_products"][0]
    assert (p["current_stock"], p["unit"], p["purchase_price"]) == (stock, unit, cost)


def test_api_invalid_stock_unit_refused(api):
    c, h = api
    it = _extract(c, h, ["Sona Masoori Rice 25kg        2    bag    2350.00   4700.00"])["items"][0]
    r = _confirm(c, h, [_item(it, name="Sona Masoori Rice", selling_price=110.0, stock_unit="L")])
    assert r.status_code == 400 and "can be stocked in" in r.json()["detail"]


def test_api_missing_pack_size_flags_review_and_saves_nothing(api):
    c, h = api
    rice = _product(c, h, "Basmati Rice", "kg", 10)
    salt = _product(c, h, "Tata Salt", "pkt", 5, sp=25, cost=20)
    data = _extract(c, h, ["Basmati Rice                 2    bag    2350.00   4700.00",
                           "Tata Salt 1kg               20    pkt      22.00    440.00"])
    rice_line = next(i for i in data["items"] if i["product_name"].startswith("Basmati"))
    assert rice_line["needs_review"] and any("no pack size" in v for v in rice_line["validation_issues"])
    salt_line = next(i for i in data["items"] if i["product_name"].startswith("Tata"))
    r = _confirm(c, h, [_item(rice_line), _item(salt_line)])
    assert r.status_code == 400
    # Atomic: neither line changed stock
    assert c.get(f"/api/v1/products/{rice['id']}", headers=h).json()["current_stock"] == 10
    assert c.get(f"/api/v1/products/{salt['id']}", headers=h).json()["current_stock"] == 5
    pur = c.get("/api/v1/purchases", headers=h).json()
    assert (len(pur) if isinstance(pur, list) else len(pur.get("items", []))) == 0  # no purchase record either


def test_api_selling_price_never_changed_unless_sent(api):
    c, h = api
    salt = _product(c, h, "Tata Salt", "pkt", 5, sp=25, cost=20, mrp=28)
    it = _extract(c, h, ["Tata Salt 1kg               20    pkt      22.00    440.00"])["items"][0]
    assert _confirm(c, h, [_item(it, mrp=28.0)]).status_code == 201
    p = c.get(f"/api/v1/products/{salt['id']}", headers=h).json()
    assert (p["selling_price"], p["purchase_price"], p["mrp"], p["current_stock"]) == (25.0, 22.0, 28.0, 25)


def test_api_new_product_requires_selling_price(api):
    c, h = api
    it = _extract(c, h, ["Moong Dal 1kg               10    pkt     118.00   1180.00"])["items"][0]
    r = _confirm(c, h, [_item(it)])
    assert r.status_code == 400 and "Selling price is required" in r.json()["detail"]


def test_api_rate_per_kg_into_kg_stock(api):
    c, h = api
    sugar = _product(c, h, "Sugar", "kg", 0, sp=48, cost=40)
    it = _extract(c, h, ["Sugar 50kg                   2    bag      44.00   4400.00"])["items"][0]
    assert it["rate_basis_unit"] == "kg" and it["needs_review"]
    assert it["physical_quantity"] == 100.0 and it["cost_per_standard_unit"] == 44.0
    assert _confirm(c, h, [_item(it)]).status_code == 201
    p = c.get(f"/api/v1/products/{sugar['id']}", headers=h).json()
    assert (p["current_stock"], p["purchase_price"]) == (100, 44.0)


# ------------------------------------------------------------------------------ fixture accuracy (no regression)

def test_fixture_dataset_accuracy_floor():
    """All 36 fixtures through the API extraction, scored against the verified printed values.
    Measured after the fixes: 173/173 lines fully correct, 0 spurious (before: 150/160 on the 32 original
    fixtures, 1 spurious). OCR is deterministic for a given engine build, so any loss is a regression."""
    import sys
    sys.path.insert(0, str(HERE))
    from ocr_fixture_benchmark import score_invoice
    from services.invoice import extract_invoice_from_bytes

    Base.metadata.create_all(bind=_engine)
    db = Session()
    truth = json.loads((HERE / "fixtures" / "ground_truth" / "printed_values.json").read_text(encoding="utf-8"))["cases"]
    cases = [(v["filename"], v["items"], HERE / "fixtures" / "ground_truth" / "invoices" / v["filename"]) for v in truth.values()]
    for fname, items in json.loads((HERE / "fixtures" / "ocr_rectification" / "expected.json").read_text()).items():
        cases.append((fname, items, HERE / "fixtures" / "ocr_rectification" / fname))
    ok = total = spurious = 0
    for fname, items, path in cases:
        try:
            got = [i.model_dump() for i in extract_invoice_from_bytes(path.read_bytes(), fname, db, uuid.uuid4()).items]
        except ValueError:
            got = []  # the empty-file fixture is refused by design
        _, line_ok, extra, _ = score_invoice(got, items)
        ok, total, spurious = ok + line_ok, total + len(items), spurious + len(extra)
    db.close()
    Base.metadata.drop_all(bind=_engine)
    assert total == 173
    assert ok == total and spurious == 0, (ok, spurious)
