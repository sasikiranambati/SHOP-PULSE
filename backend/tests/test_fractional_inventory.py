"""
Fractional inventory and atomic stock updates (Phase 4). Approved rules: kg, g, L and ml may be fractional
(up to 3 decimals); pcs, dozen, packages, quintal and tonne are whole numbers; compatible units convert,
incompatible or unknown units are refused (never treated as pcs); a missing invoice unit needs review;
stock changes are atomic and never go negative. No schema change.
"""

import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(bind=_engine)


@pytest.fixture()
def api():
    import db.models  # noqa: F401
    from api.deps import get_db
    from db.session import Base
    from main import app

    Base.metadata.create_all(bind=_engine)

    def _db():
        s = _Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    email = f"frac{uuid.uuid4().hex[:8]}@example.com"
    c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    h = {"Authorization": "Bearer " + c.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]}
    c.post("/api/v1/shops", json={"shop_name": "K", "owner_name": "R", "business_type": "Grocery/Kirana", "location": "B"}, headers=h)
    yield c, h
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)


def _product(c, h, name, unit, stock, price=50.0, expect=201):
    payload = {
        "name": name, "selling_price": price, "purchase_price": price,
        "current_stock": stock, "unit": unit
    }
    if expect == 201:
        payload["pricing_status"] = "VERIFIED"
        payload["mrp"] = max(float(price) * 2, 100.0)
        payload["price_basis_quantity"] = 1.0
        payload["price_basis_unit"] = unit
    r = c.post("/api/v1/products", json=payload, headers=h)
    assert r.status_code == expect, r.text
    return r.json() if expect == 201 else r.json()["detail"]


def _stock(c, h, pid):
    return c.get(f"/api/v1/products/{pid}", headers=h).json()["current_stock"]


# ------------------------------------------------------------------------------------- products


@pytest.mark.parametrize("unit,stock", [("kg", 2.5), ("ml", 750), ("L", 0.75), ("g", 0.5), ("kgs", 0.125)])
def test_measure_units_hold_fractional_stock(api, unit, stock):
    c, h = api
    p = _product(c, h, f"Loose {unit}", unit, stock)
    assert p["current_stock"] == stock and _stock(c, h, p["id"]) == stock


@pytest.mark.parametrize("unit", ["pcs", "dozen", "packet", "box", "bottle", "qtl", "ton", "bar"])
def test_whole_number_units_refuse_fractions(api, unit):
    c, h = api
    msg = _product(c, h, f"Item {unit}", unit, 2.5, expect=400)
    assert "whole number" in msg


def test_unknown_unit_is_refused_never_pcs(api):
    c, h = api
    assert "not a registered unit" in _product(c, h, "Mystery", "zzz", 5, expect=400)
    assert "more than 3 decimal" in _product(c, h, "Too fine", "kg", 1.2345, expect=400)


def test_whole_stock_keeps_integer_json_and_update_validates_the_unit(api):
    c, h = api
    p = _product(c, h, "Salt", "pcs", 5)
    assert isinstance(p["current_stock"], int) and p["current_stock"] == 5
    r = c.put(f"/api/v1/products/{p['id']}", json={"current_stock": 2.5}, headers=h)
    assert r.status_code == 400 and "whole number" in r.json()["detail"]
    r = c.put(f"/api/v1/products/{p['id']}", json={"unit": "kg", "price_basis_unit": "kg", "mrp_basis_unit": "kg", "current_stock": 2.5}, headers=h)
    assert r.status_code == 200 and r.json()["current_stock"] == 2.5
    r = c.put(f"/api/v1/products/{p['id']}", json={"unit": "pcs"}, headers=h)  # 2.5 would no longer suit pcs
    assert r.status_code == 400


# ------------------------------------------------------------------------------------- sales and purchases


def test_fractional_sale_and_compatible_unit_conversion(api):
    c, h = api
    p = _product(c, h, "Sugar Loose", "kg", 2.5, price=44.5)
    r = c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": 0.5}]}, headers=h)
    assert r.status_code == 201 and r.json()["total_amount"] == 22.25 and r.json()["items"][0]["quantity"] == 0.5
    assert _stock(c, h, p["id"]) == 2.0
    r = c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": 750, "unit": "g"}]}, headers=h)
    assert r.status_code == 201 and r.json()["total_amount"] == 33.38  # 0.75 kg x 44.50 = 33.375 -> 33.38
    assert _stock(c, h, p["id"]) == 1.25


def test_purchase_250_g(api):
    c, h = api
    kg = _product(c, h, "Tea Loose", "kg", 1)
    g = _product(c, h, "Saffron", "g", 0)
    r = c.post("/api/v1/purchases", json={"items": [{"product_id": kg["id"], "quantity": 250, "unit": "g", "purchase_price": 400},
                                                    {"product_id": g["id"], "quantity": 250, "purchase_price": 2}]}, headers=h)
    assert r.status_code == 201, r.text
    assert _stock(c, h, kg["id"]) == 1.25 and _stock(c, h, g["id"]) == 250
    assert r.json()["total_amount"] == 600.0  # 0.25 kg x 400 + 250 g x 2 (prices per stock unit)


@pytest.mark.parametrize("payload,needle", [
    ({"quantity": 2.5}, "whole"),                     # pcs product
    ({"quantity": 1, "unit": "kg"}, "cannot be converted"),
    ({"quantity": 1, "unit": "zzz"}, "unit registry"),
])
def test_invalid_sale_quantities_change_nothing(api, payload, needle):
    c, h = api
    p = _product(c, h, "Soap", "pcs", 10)
    r = c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], **payload}]}, headers=h)
    assert r.status_code in (400, 422) and needle in r.text
    assert _stock(c, h, p["id"]) == 10


def test_package_units_convert_only_with_product_configuration(api):
    c, h = api
    p = _product(c, h, "Rice Bag", "kg", 50)
    r = c.post("/api/v1/purchases", json={"items": [{"product_id": p["id"], "quantity": 2, "unit": "bag", "purchase_price": 1000}]}, headers=h)
    assert r.status_code == 400 and "product-specific conversion" in r.json()["detail"]
    assert _stock(c, h, p["id"]) == 50


def test_insufficient_stock_and_rollback(api):
    c, h = api
    a = _product(c, h, "Oil", "L", 1.5)
    b = _product(c, h, "Dal", "kg", 5)
    r = c.post("/api/v1/sales", json={"items": [{"product_id": b["id"], "quantity": 1}, {"product_id": a["id"], "quantity": 2}]}, headers=h)
    assert r.status_code == 400 and "Insufficient stock" in r.json()["detail"]
    assert _stock(c, h, a["id"]) == 1.5 and _stock(c, h, b["id"]) == 5  # nothing deducted
    # the same product twice: the combined quantity is checked by the atomic update
    r = c.post("/api/v1/sales", json={"items": [{"product_id": a["id"], "quantity": 1}, {"product_id": a["id"], "quantity": 1}]}, headers=h)
    assert r.status_code == 400 and _stock(c, h, a["id"]) == 1.5
    assert c.get("/api/v1/sales", headers=h).json()["total"] == 0


def test_purchase_rollback(api):
    c, h = api
    a = _product(c, h, "Flour", "kg", 1)
    r = c.post("/api/v1/purchases", json={"items": [{"product_id": a["id"], "quantity": 2, "purchase_price": 40},
                                                    {"product_id": str(uuid.uuid4()), "quantity": 1, "purchase_price": 1}]}, headers=h)
    assert r.status_code == 400 and _stock(c, h, a["id"]) == 1
    assert c.get("/api/v1/purchases", headers=h).json()["total"] == 0


# ------------------------------------------------------------------------------------- concurrency


def _race(tmp_path, stock, sale_qty):
    """Two sales at the same moment through the real service, on a file database in WAL mode (as the app).
    Both requests read the stock before either writes."""
    import db.models  # noqa: F401
    import services.sale as sale_svc
    from db.models.product import Product
    from db.models.shop import Shop
    from db.models.user import User
    from db.session import Base
    from schemas.sale import SaleCreate

    eng = create_engine(f"sqlite:///{tmp_path / 'race.db'}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(eng, "connect")
    def _wal(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    Base.metadata.create_all(eng)
    S = sessionmaker(bind=eng)
    with S() as s:
        u = User(email=f"r{uuid.uuid4().hex[:6]}@example.com", hashed_password="x")
        s.add(u)
        s.flush()
        shop = Shop(shop_name="K", owner_name="R", business_type="Grocery/Kirana", location="B", owner_id=u.id)
        s.add(shop)
        s.flush()
        p = Product(
            name="Salt",
            selling_price=22.0,
            purchase_price=20.0,
            mrp=30.0,
            pricing_status="VERIFIED",
            current_stock=stock,
            unit="kg",
            price_basis_quantity=1.0,
            price_basis_unit="kg",
            shop_id=shop.id,
        )
        s.add(p)
        s.commit()
        pid, sid = p.id, shop.id
    barrier = threading.Barrier(2)
    results = []

    def run():
        s = S()
        real_add = s.add

        def add(obj, *a, **k):
            if obj.__class__.__name__ == "Sale":
                barrier.wait(timeout=10)  # both requests have read the stock
            return real_add(obj, *a, **k)

        s.add = add
        try:
            sale_svc.create_sale(s, SaleCreate(items=[{"product_id": pid, "quantity": sale_qty}], payment_method="cash"), sid)
            results.append("ok")
        except ValueError as exc:
            results.append(str(exc))
        finally:
            s.close()

    threads = [threading.Thread(target=run) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    with S() as s:
        final = s.get(Product, pid).current_stock
        sales = s.execute(__import__("sqlalchemy").text("select count(*) from sales")).scalar()
    eng.dispose()
    return results, final, sales


def test_concurrent_sales_never_lose_an_update(tmp_path):
    results, final, sales = _race(tmp_path, 10, 1.5)
    assert results == ["ok", "ok"] and sales == 2 and final == 7  # before: 8.5 (one deduction lost)


def test_concurrent_sales_never_drive_stock_negative(tmp_path):
    results, final, sales = _race(tmp_path, 1, 0.75)
    assert sorted(r == "ok" for r in results) == [False, True] and sales == 1 and final == 0.25
    assert any("Insufficient stock" in r for r in results)


# ------------------------------------------------------------------------------------- invoice confirmation


def _confirm(c, h, items, **extra):
    return c.post("/api/v1/invoices/confirm", json={"invoice_number": f"F-{uuid.uuid4().hex[:6]}", "items": items, **extra}, headers=h)


def test_invoice_missing_or_unknown_unit_needs_review_and_writes_nothing(api):
    c, h = api
    line = {"name": "Chilli Powder", "quantity": 2, "purchase_price": 80.0, "selling_price": 100.0}
    for unit, needle in ((None, "is missing"), ("", "is missing"), ("zzz", "not a registered unit")):
        r = _confirm(c, h, [dict(line, unit=unit)])
        assert r.status_code == 400 and needle in r.json()["detail"]
    assert c.get("/api/v1/products", headers=h).json()["total"] == 0
    assert c.get("/api/v1/purchases", headers=h).json()["total"] == 0


def test_invoice_converts_into_the_matched_product_unit(api):
    c, h = api
    p = _product(c, h, "Cumin", "kg", 1)
    r = _confirm(c, h, [{"name": "Cumin", "quantity": 250, "unit": "g", "purchase_price": 0.4, "selling_price": 0.5,
                         "matched_product_id": p["id"]}])
    assert r.status_code == 201, r.text
    assert _stock(c, h, p["id"]) == 1.25
    r = _confirm(c, h, [{"name": "Cumin", "quantity": 2, "unit": "box", "purchase_price": 100, "selling_price": 120,
                         "matched_product_id": p["id"]}])
    assert r.status_code == 400 and _stock(c, h, p["id"]) == 1.25


def test_invoice_fractional_paid_and_free_quantities(api):
    c, h = api
    r = _confirm(c, h, [{"name": "Rice Loose", "quantity": 5.5, "paid_quantity": 5, "free_quantity": 0.5, "unit": "kg",
                         "purchase_price": 60.0, "selling_price": 70.0}], confirm_free_units=True)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["total_amount"] == 300.0  # only the paid 5 kg is charged
    assert body["promotional_lines"][0]["received_quantity"] == 5.5
    products = c.get("/api/v1/products", headers=h).json()["items"]
    assert products[0]["current_stock"] == 5.5


# ------------------------------------------------------------------------------------- voice and OCR


def test_voice_half_kg_sale_completes(api):
    c, h = api
    p = _product(c, h, "Sugar", "kg", 3, price=44.0)
    r = c.post("/api/v1/voice/process", json={"simulation_text": "half kg sugar"}, headers=h)
    m = r.json()["matched_items"][0]
    assert m["quantity"] == 0.5 and m["current_stock"] == 3 and m["total_price"] == 22.0
    s = c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": m["quantity"]}]}, headers=h)
    assert s.status_code == 201 and _stock(c, h, p["id"]) == 2.5


def test_ocr_lines_keep_fractions_and_missing_units_need_review(monkeypatch):
    from decimal import Decimal

    from services import invoice as inv
    from services import mrp_lookup
    from services.grocery_ocr.schemas.invoice import ExtractedInvoice, InvoiceProcessingMetadata
    from services.grocery_ocr.schemas.invoice_item import ExtractedInvoiceItem

    def it(name, qty, unit):
        return ExtractedInvoiceItem(item_id=f"i_{uuid.uuid4().hex[:6]}", raw_product_name=name, normalized_product_name=name,
                                    quantity=Decimal(qty), purchase_price=Decimal("40"), printed_amount=Decimal(qty) * 40,
                                    validation_status="VERIFIED", ocr_confidence=95.0, unit=unit)

    class _NoProducts:
        def query(self, *a, **k): return self
        def filter(self, *a, **k): return self
        def all(self): return []

    result = ExtractedInvoice(invoice_id="x", original_filename="x.png", status="SUCCESS",
                              items=[it("Dal Loose", "2.5", "kg"), it("Salt", "4", None), it("Oil", "1", "xyz")],
                              total_items_count=3, metadata=InvoiceProcessingMetadata(filename="x.png"))
    monkeypatch.setattr(inv.InvoicePipeline, "process", lambda self, *a, **k: result)
    monkeypatch.setattr(mrp_lookup, "get_provider", lambda: mrp_lookup.NoProvider())
    out = inv._extract_invoice_with_new_pipeline(b"x", "x.png", _NoProducts(), uuid.uuid4())
    dal, salt, oil = out.items
    assert dal.quantity == 2.5 and dal.unit == "kg" and not any("Unit" in v for v in dal.validation_issues)
    assert salt.needs_review and any("Unit not printed" in v for v in salt.validation_issues)
    assert oil.needs_review and any("not a registered unit" in v for v in oil.validation_issues)


def test_reports_keep_fractional_quantities(api):
    c, h = api
    p = _product(c, h, "Ghee", "L", 2, price=500.0)
    c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": 0.25}]}, headers=h)
    c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": 0.5}]}, headers=h)
    dash = c.get("/api/v1/dashboard", headers=h).json()
    assert dash["items_sold_today"] == 0.75
    perf = c.get("/api/v1/insights/sales?period=7d", headers=h).json()["performance"]["best_selling"]
    assert perf[0]["quantity_sold"] == 0.75 and perf[0]["revenue"] == 375.0
