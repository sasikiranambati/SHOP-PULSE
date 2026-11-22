"""
Stage 4C.1 independent verification: purchase data integrity, RBAC on verified pricing, MRP handling,
supplier identity and the invoice-identity migration (isolated temporary databases only).
Generic test values. Concurrency is covered by test_invoice_concurrency_real.py.
"""

import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def api(tmp_path):
    import db.models  # noqa: F401
    from api.deps import get_db
    from db.session import Base
    from main import app

    engine = create_engine(f"sqlite:///{tmp_path / 'verify.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _db
    yield TestClient(app), engine
    if previous is None:
        app.dependency_overrides.pop(get_db, None)
    else:
        app.dependency_overrides[get_db] = previous
    engine.dispose()


def _user(c, label):
    email = f"v-{label}-{uuid.uuid4().hex[:8]}@example.com"
    uid = c.post("/api/v1/auth/register", json={"email": email, "password": "password123"}).json()["id"]
    tok = c.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    return uid, {"Authorization": f"Bearer {tok}"}


@pytest.fixture()
def shop(api):
    c, engine = api
    _, owner = _user(c, "owner")
    shop_id = c.post("/api/v1/shops", json={"shop_name": "K", "owner_name": "R", "business_type": "Grocery/Kirana",
                                            "location": "B"}, headers=owner).json()["id"]
    roles = {"owner": owner}
    for role in ("MANAGER", "CASHIER"):
        uid, h = _user(c, role.lower())
        r = c.post(f"/api/v1/shops/{shop_id}/members", json={"user_id": uid, "role": role}, headers=owner)
        assert r.status_code in (200, 201), r.text
        roles[role.lower()] = h
    return c, engine, roles


def _product(c, h, **over):
    body = {"name": f"P {uuid.uuid4().hex[:6]}", "unit": "kg", "current_stock": 10, "selling_price": 60.0,
            "purchase_price": 50.0, "price_basis_quantity": 1.0, "price_basis_unit": "kg", **over}
    r = c.post("/api/v1/products", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------------------- purchase data integrity


def test_direct_purchase_keeps_each_lines_basis_and_fractions(shop):
    c, _, roles = shop
    h = roles["owner"]
    rice = _product(c, h, name="Rice", unit="kg")
    oil = _product(c, h, name="Oil", unit="L", price_basis_unit="L", selling_price=150.0)
    dal = _product(c, h, name="Dal", unit="kg", selling_price=130.0)
    r = c.post("/api/v1/purchases", json={"items": [
        {"product_id": rice["id"], "quantity": 2.5, "purchase_price": 48.0, "price_basis_quantity": 1, "price_basis_unit": "kg"},
        {"product_id": oil["id"], "quantity": 0.75, "purchase_price": 140.0, "price_basis_quantity": 1, "price_basis_unit": "L"},
        {"product_id": dal["id"], "quantity": 0.125, "purchase_price": 1100.0, "price_basis_quantity": 10, "price_basis_unit": "kg"},
    ]}, headers=h)
    assert r.status_code == 201, r.text
    got = c.get(f"/api/v1/purchases/{r.json()['id']}", headers=h).json()
    lines = {i["product_id"]: i for i in got["items"]}
    assert [(lines[p["id"]]["quantity"], lines[p["id"]]["price_basis_quantity"], lines[p["id"]]["price_basis_unit"],
             lines[p["id"]]["normalized_purchase_price"], lines[p["id"]]["line_amount"]) for p in (rice, oil, dal)] == [
        (2.5, 1.0, "kg", 48.0, 120.0),
        (0.75, 1.0, "L", 140.0, 105.0),
        (0.125, 10.0, "kg", 110.0, 13.75),  # 0.125 kg x ₹1100 per 10 kg
    ]
    assert got["total_amount"] == 238.75
    stock = {p["id"]: c.get(f"/api/v1/products/{p['id']}", headers=h).json()["current_stock"] for p in (rice, oil, dal)}
    assert stock == {rice["id"]: 12.5, oil["id"]: 10.75, dal["id"]: 10.125}


@pytest.mark.parametrize("basis", [0, -1])
def test_invalid_pricing_basis_is_refused_without_changes(shop, basis):
    c, _, roles = shop
    h = roles["owner"]
    p = _product(c, h)
    r = c.post("/api/v1/purchases", json={"items": [
        {"product_id": p["id"], "quantity": 1, "purchase_price": 50.0, "price_basis_quantity": basis}]}, headers=h)
    assert r.status_code == 422
    assert c.get(f"/api/v1/products/{p['id']}", headers=h).json()["current_stock"] == 10
    assert c.get("/api/v1/purchases", headers=h).json()["total"] == 0


def test_invoice_lines_are_stored_as_printed(shop):
    c, _, roles = shop
    h = roles["owner"]
    p = _product(c, h, name="Sugar")
    r = c.post("/api/v1/invoices/confirm", json={"invoice_number": "INV-7", "supplier_name": "Generic Traders", "items": [
        {"name": "Sugar", "matched_product_id": p["id"], "quantity": 2.5, "unit": "kg", "purchase_price": 44.25,
         "line_amount": 110.63, "selling_price": 60.0}]}, headers=h)
    assert r.status_code == 201, r.text
    line = c.get(f"/api/v1/purchases/{r.json()['purchase_id']}", headers=h).json()["items"][0]
    assert (line["quantity"], line["purchase_price"], line["line_amount"]) == (2.5, 44.25, 110.63)


def test_supplier_names_are_unique_per_shop_ignoring_case(shop):
    c, _, roles = shop
    h = roles["owner"]
    assert c.post("/api/v1/suppliers", json={"supplier_name": "Generic Traders"}, headers=h).status_code == 201
    dup = c.post("/api/v1/suppliers", json={"supplier_name": " generic traders "}, headers=h)
    assert dup.status_code == 409 and "already exists" in dup.json()["detail"]
    other = c.post("/api/v1/suppliers", json={"supplier_name": "Other Traders"}, headers=h).json()
    assert c.put(f"/api/v1/suppliers/{other['id']}", json={"supplier_name": "GENERIC TRADERS"}, headers=h).status_code == 409


# ------------------------------------------------------------------------------- RBAC on verified pricing


def test_cashier_cannot_change_verified_pricing_through_product_update(shop):
    c, engine, roles = shop
    p = _product(c, roles["owner"], pricing_status="VERIFIED")
    assert p["pricing_status"] == "VERIFIED"
    for change in ({"selling_price": 55.0}, {"mrp": 80.0}, {"price_basis_quantity": 2.0}, {"unit": "g"}):
        r = c.put(f"/api/v1/products/{p['id']}", json=change, headers=roles["cashier"])
        assert r.status_code == 403, (change, r.text)
    after = c.get(f"/api/v1/products/{p['id']}", headers=roles["owner"]).json()
    assert (after["selling_price"], after["mrp"], after["price_basis_quantity"], after["unit"]) == (60.0, None, 1.0, "kg")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM pricing_audit_logs WHERE action_type = 'SELLING_PRICE_OVERRIDE'")).scalar() == 0
    # Non-pricing fields stay editable by a cashier
    assert c.put(f"/api/v1/products/{p['id']}", json={"reorder_level": 4}, headers=roles["cashier"]).status_code == 200


def test_manager_can_change_verified_pricing_and_it_is_audited(shop):
    c, engine, roles = shop
    p = _product(c, roles["owner"], pricing_status="VERIFIED")
    r = c.put(f"/api/v1/products/{p['id']}", json={"selling_price": 58.0}, headers=roles["manager"])
    assert r.status_code == 200 and r.json()["selling_price"] == 58.0
    trail = c.get(f"/api/v1/products/{p['id']}/audit-trail", headers=roles["manager"]).json()
    assert any(e["previous_selling_price"] == 60.0 and e["new_selling_price"] == 58.0 for e in trail)
    assert c.get(f"/api/v1/products/{p['id']}/audit-trail", headers=roles["cashier"]).status_code == 403


def test_cashier_may_still_price_unverified_products(shop):
    c, _, roles = shop
    p = _product(c, roles["owner"])  # NEEDS_REVIEW
    r = c.put(f"/api/v1/products/{p['id']}", json={"selling_price": 61.0, "pricing_status": "VERIFIED"}, headers=roles["cashier"])
    assert r.status_code == 200 and r.json()["pricing_status"] == "NEEDS_REVIEW"
    assert c.post(f"/api/v1/products/{p['id']}/verify", headers=roles["cashier"]).status_code == 403


def test_audit_logs_have_no_write_api(shop):
    c, _, roles = shop
    p = _product(c, roles["owner"], pricing_status="VERIFIED")
    c.put(f"/api/v1/products/{p['id']}", json={"selling_price": 59.0}, headers=roles["owner"])
    entry = c.get(f"/api/v1/products/{p['id']}/audit-trail", headers=roles["owner"]).json()[0]
    for method in ("put", "patch", "delete"):
        r = getattr(c, method)(f"/api/v1/products/{p['id']}/audit-trail/{entry['id']}", headers=roles["owner"])
        assert r.status_code in (404, 405)
    assert c.get(f"/api/v1/products/{p['id']}/audit-trail", headers=roles["owner"]).json()[0] == entry


# ------------------------------------------------------------------------------- MRP


def test_package_mrp_against_unit_selling_price(shop):
    c, _, roles = shop
    h = roles["owner"]
    # MRP ₹100 per pack of 10 pcs = ₹10 per pc
    ok = _product(c, h, unit="pcs", price_basis_unit="pcs", selling_price=9.5, mrp=100.0, mrp_basis_quantity=10, mrp_basis_unit="pcs")
    assert ok["mrp"] == 100.0
    over = c.post("/api/v1/products", json={"name": "Over", "unit": "pcs", "current_stock": 10, "selling_price": 12.0,
                                            "price_basis_unit": "pcs", "mrp": 100.0, "mrp_basis_quantity": 10,
                                            "mrp_basis_unit": "pcs"}, headers=h)
    assert over.status_code == 400 and "MRP" in over.json()["detail"]
    # Incompatible MRP basis (per L for a kg product) is refused, never compared blindly
    bad = c.post("/api/v1/products", json={"name": "Bad", "unit": "kg", "current_stock": 1, "selling_price": 50.0,
                                           "price_basis_unit": "kg", "mrp": 60.0, "mrp_basis_unit": "L"}, headers=h)
    assert bad.status_code == 400


def test_loose_product_without_mrp_is_allowed(shop):
    c, _, roles = shop
    p = _product(c, roles["owner"], name="Loose Dal", mrp=None)
    assert p["mrp"] is None


def test_sales_cannot_bypass_server_pricing(shop):
    c, engine, roles = shop
    h = roles["owner"]
    p = _product(c, h, pricing_status="VERIFIED", mrp=70.0)
    # A client price that differs from the catalogue (POS or Voice-to-Bill) is refused, nothing changes
    r = c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": 2, "unit_price": 40.0}]}, headers=roles["cashier"])
    assert r.status_code == 400
    # A stored selling price above MRP (e.g. legacy data) cannot be sold
    with engine.begin() as conn:
        conn.execute(text("UPDATE products SET selling_price = 75 WHERE id = :id"), {"id": uuid.UUID(p["id"]).hex})
    r = c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": 1}]}, headers=roles["cashier"])
    assert r.status_code == 400 and "MRP" in r.json()["detail"]
    assert c.get(f"/api/v1/products/{p['id']}", headers=h).json()["current_stock"] == 10
    # Unverified pricing cannot be sold at all
    q = _product(c, h)
    assert c.post("/api/v1/sales", json={"items": [{"product_id": q["id"], "quantity": 1}]}, headers=h).status_code == 400


# ------------------------------------------------------------------------------- migration (isolated)


def _alembic(db_path):
    backend = Path(__file__).resolve().parent.parent
    cfg = Config(str(backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return cfg


def _pre_migration_db(path):
    """Schema at revision 6f708192a3b4 (current models without the two new indexes)."""
    import db.models  # noqa: F401
    from db.session import Base
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP INDEX uq_purchases_invoice_identity"))
        conn.execute(text("DROP INDEX uq_suppliers_shop_name_ci"))
    cfg = _alembic(path)
    command.stamp(cfg, "6f708192a3b4")
    return engine, cfg


def _indexes(engine):
    # sqlite_master, not the inspector: SQLAlchemy does not reflect expression indexes on SQLite
    with engine.connect() as conn:
        return {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type = 'index'"))}


def test_migration_stops_on_existing_duplicates_without_changing_data(tmp_path):
    engine, cfg = _pre_migration_db(tmp_path / "m.db")
    shop = uuid.uuid4().hex
    with engine.begin() as conn:
        for num in ("INV-1", "inv-1"):  # allowed by the old constraint, a duplicate under the new identity
            conn.execute(text("INSERT INTO purchases (id, shop_id, total_amount, invoice_number) VALUES (:i, :s, 0, :n)"),
                         {"i": uuid.uuid4().hex, "s": shop, "n": num})
    before = engine.connect().execute(text("SELECT id, invoice_number FROM purchases ORDER BY id")).fetchall()
    with pytest.raises(Exception, match="stopped before changing anything"):
        command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT id, invoice_number FROM purchases ORDER BY id")).fetchall() == before
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "6f708192a3b4"
    assert not {"uq_purchases_invoice_identity", "uq_suppliers_shop_name_ci"} & _indexes(engine)


def test_migration_upgrade_downgrade_cycle(tmp_path):
    engine, cfg = _pre_migration_db(tmp_path / "m.db")
    shop = uuid.uuid4().hex
    with engine.begin() as conn:
        for num in ("INV-1", "INV-2", None, None):
            conn.execute(text("INSERT INTO purchases (id, shop_id, total_amount, invoice_number) VALUES (:i, :s, 0, :n)"),
                         {"i": uuid.uuid4().hex, "s": shop, "n": num})
    command.upgrade(cfg, "head")
    assert {"uq_purchases_invoice_identity", "uq_suppliers_shop_name_ci"} <= _indexes(engine)
    with pytest.raises(Exception):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO purchases (id, shop_id, total_amount, invoice_number) VALUES (:i, :s, 0, ' inv-1 ')"),
                         {"i": uuid.uuid4().hex, "s": shop})
    command.downgrade(cfg, "6f708192a3b4")
    assert not {"uq_purchases_invoice_identity", "uq_suppliers_shop_name_ci"} & _indexes(engine)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM purchases")).scalar() == 4
    command.upgrade(cfg, "head")  # re-runnable
    assert {"uq_purchases_invoice_identity", "uq_suppliers_shop_name_ci"} <= _indexes(engine)


# ------------------------------------------------------------------------------- Decision 4: transactions


def test_failed_confirmation_leaves_no_supplier_or_membership(shop):
    """Legacy shop (owner without a membership row): the authorization lookup used to commit a membership
    row mid-confirmation, together with the new supplier already flushed. Now nothing survives a failure."""
    c, engine, roles = shop
    h = roles["owner"]
    rice = _product(c, h, name="Rice", pricing_status="VERIFIED")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM shop_members WHERE role = 'OWNER'"))
    body = {"invoice_number": "INV-TX-1", "supplier_name": "Fresh Supplier", "items": [
        {"name": "Rice", "matched_product_id": rice["id"], "quantity": 1, "unit": "kg", "purchase_price": 50.0,
         "selling_price": 58.0, "update_selling_price": True},          # needs the owner's authority
        {"name": "Brand New Oil", "quantity": 1, "unit": "L", "purchase_price": 40.0,
         "selling_price": 60.0, "mrp": 50.0},                            # fails later: price above MRP
    ]}
    r = c.post("/api/v1/invoices/confirm", json=body, headers=h)
    assert r.status_code == 400 and "MRP" in r.json()["detail"]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM suppliers")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM shop_members WHERE role = 'OWNER'")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM purchases")).scalar() == 0
        # (the VERIFY_PRICING entry from creating the verified product is expected; no override was saved)
        assert conn.execute(text("SELECT count(*) FROM pricing_audit_logs WHERE action_type = 'SELLING_PRICE_OVERRIDE'")).scalar() == 0
    assert c.get(f"/api/v1/products/{rice['id']}", headers=h).json()["current_stock"] == 10
    # The owner's authority still comes from Shop.owner_id: the same invoice without the bad line succeeds
    body["items"] = body["items"][:1]
    ok = c.post("/api/v1/invoices/confirm", json=body, headers=h)
    assert ok.status_code == 201, ok.text
    assert c.get(f"/api/v1/products/{rice['id']}", headers=h).json()["selling_price"] == 58.0


def test_failed_notification_never_fails_a_committed_invoice_or_sale(shop, monkeypatch):
    import services.notification as notification
    c, engine, roles = shop
    h = roles["owner"]

    def broken(*args, **kwargs):
        raise RuntimeError("notification store unavailable")

    monkeypatch.setattr(notification, "create_notification", broken)
    p = _product(c, h, name="Salt", pricing_status="VERIFIED", reorder_level=50)
    inv = c.post("/api/v1/invoices/confirm", json={"invoice_number": "INV-N-1", "items": [
        {"name": "Salt", "matched_product_id": p["id"], "quantity": 2, "unit": "kg", "purchase_price": 20.0}]}, headers=h)
    assert inv.status_code == 201, inv.text
    sale = c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": 1}]}, headers=h)
    assert sale.status_code == 201, sale.text  # low stock alert attempted (reorder level 50) and failed
    assert c.get(f"/api/v1/products/{p['id']}", headers=h).json()["current_stock"] == 11


# ------------------------------------------------------------------------------- deactivation


def test_only_managers_and_owners_deactivate_products(shop):
    c, _, roles = shop
    p = _product(c, roles["owner"], name="Soap")
    assert c.delete(f"/api/v1/products/{p['id']}", headers=roles["cashier"]).status_code == 403
    assert c.get(f"/api/v1/products/{p['id']}", headers=roles["owner"]).json()["is_active"] is True
    assert c.delete(f"/api/v1/products/{p['id']}", headers=roles["manager"]).status_code == 204
    q = _product(c, roles["owner"], name="Rice")
    assert c.delete(f"/api/v1/products/{q['id']}", headers=roles["owner"]).status_code == 204
    # Legitimate cashier workflows remain: creating products and editing stock / details
    r = _product(c, roles["cashier"], name="Cashier Added")
    assert c.put(f"/api/v1/products/{r['id']}", json={"current_stock": 12, "category": "Staples"},
                 headers=roles["cashier"]).status_code == 200


def _insert_purchase(engine, shop, number, supplier=None):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO purchases (id, shop_id, supplier_id, total_amount, invoice_number) "
                          "VALUES (:i, :s, :sup, 0, :n)"), {"i": uuid.uuid4().hex, "s": shop, "sup": supplier, "n": number})


def _insert_supplier(engine, shop, name):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO suppliers (id, shop_id, supplier_name) VALUES (:i, :s, :n)"),
                     {"i": uuid.uuid4().hex, "s": shop, "n": name})


def test_migration_preflight_reports_every_conflict_kind(tmp_path):
    engine, cfg = _pre_migration_db(tmp_path / "m.db")
    shop = uuid.uuid4().hex
    _insert_purchase(engine, shop, "INV-7")          # NULL supplier ...
    _insert_purchase(engine, shop, "  inv-7 ")       # ... same identity after trim + lower
    _insert_supplier(engine, shop, "Generic Traders")
    _insert_supplier(engine, shop, "GENERIC traders ")
    with engine.connect() as conn:
        before = [conn.execute(text(f"SELECT * FROM {t} ORDER BY id")).fetchall() for t in ("purchases", "suppliers")]
    with pytest.raises(Exception) as err:
        command.upgrade(cfg, "head")
    message = str(err.value)
    assert "1 purchase invoice identities occur more than once" in message and "inv-7" in message
    assert "1 supplier names occur more than once" in message and "generic traders" in message
    with engine.connect() as conn:
        after = [conn.execute(text(f"SELECT * FROM {t} ORDER BY id")).fetchall() for t in ("purchases", "suppliers")]
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "6f708192a3b4"
    assert after == before  # nothing rewritten, nothing created
    assert not {"uq_purchases_invoice_identity", "uq_suppliers_shop_name_ci"} & _indexes(engine)


def test_migrated_indexes_enforce_the_identity_rules(tmp_path):
    engine, cfg = _pre_migration_db(tmp_path / "m.db")
    shop, other_shop, sup = uuid.uuid4().hex, uuid.uuid4().hex, uuid.uuid4().hex
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        ddl = conn.execute(text("SELECT sql FROM sqlite_master WHERE name = 'uq_purchases_invoice_identity'")).scalar()
    assert all(part in ddl.lower() for part in ("coalesce(cast(supplier_id as varchar), '')", "lower(trim(invoice_number))",
                                                "where invoice_number is not null"))

    def blocked(fn, *args):
        try:
            fn(engine, *args)
            return False
        except Exception:
            return True

    _insert_purchase(engine, shop, "INV-1")
    assert blocked(_insert_purchase, shop, "INV-1")            # NULL supplier twice
    assert blocked(_insert_purchase, shop, " inv-1  ")         # whitespace + case
    assert not blocked(_insert_purchase, shop, "INV-1", sup)   # a supplier is another identity
    assert blocked(_insert_purchase, shop, "inv-1", sup)
    assert not blocked(_insert_purchase, other_shop, "INV-1")  # another shop
    assert not blocked(_insert_purchase, shop, None) and not blocked(_insert_purchase, shop, None)
    assert not blocked(_insert_purchase, shop, "  ") and not blocked(_insert_purchase, shop, "  ")  # blank = no number
    _insert_supplier(engine, shop, "Generic Traders")
    assert blocked(_insert_supplier, shop, " generic TRADERS")
    assert not blocked(_insert_supplier, other_shop, "Generic Traders")


# ------------------------------------------------------------------------------- staff catalogue access


def test_staff_can_sell_from_their_shops_catalogue(shop):
    c, _, roles = shop
    p = _product(c, roles["owner"], name="Tea", unit="packet", price_basis_unit="packet", selling_price=40.0,
                 pricing_status="VERIFIED")
    for role in ("cashier", "manager"):
        listed = c.get("/api/v1/products?limit=100", headers=roles[role]).json()
        assert [i["id"] for i in listed["items"]] == [p["id"]], role
    v = c.post("/api/v1/voice/process", json={"simulation_text": "2 tea", "language_code": "en-IN"}, headers=roles["cashier"]).json()
    assert [m["product_id"] for m in v["matched_items"]] == [p["id"]]
    sale = c.post("/api/v1/sales", json={"items": [{"product_id": p["id"], "quantity": 2}]}, headers=roles["cashier"])
    assert sale.status_code == 201
    assert c.get("/api/v1/sales", headers=roles["cashier"]).json()["total"] == 1


def test_voice_never_matches_another_shops_products(shop):
    c, _, roles = shop
    _product(c, roles["owner"], name="Secret Saffron", pricing_status="VERIFIED")
    _, outsider = _user(c, "outsider")  # signed in, no shop
    v = c.post("/api/v1/voice/process", json={"simulation_text": "1 secret saffron", "language_code": "en-IN"}, headers=outsider).json()
    assert v["matched_items"] == [] and v["ambiguous_items"] == []
    assert c.get("/api/v1/products", headers=outsider).json()["items"] == []
