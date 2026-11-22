"""
Stage 4C.1 verification: genuinely concurrent duplicate invoice confirmations.

Unlike a sequential test, every request here runs in its own thread with its own database connection to
an isolated temporary SQLite *file* (no shared in-memory connection). A barrier placed right after the
duplicate check holds both requests until each has passed it, so both race to write: the worst-case
interleaving that the database-level protection must handle.

Expected for every duplicate identity (same shop, same supplier or both without one, invoice number
equal ignoring case and surrounding spaces): exactly one purchase, one set of purchase items and one
stock increment; the other request receives HTTP 409 and leaves no partial writes.
Different invoices, different suppliers, different shops and purchases without an invoice number are
never blocked.
"""

import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import services.invoice as invoice_service


@pytest.fixture()
def env(tmp_path):
    import db.models  # noqa: F401
    from api.deps import get_db
    from db.session import Base
    from main import app

    engine = create_engine(f"sqlite:///{tmp_path / 'race.db'}", connect_args={"check_same_thread": False, "timeout": 30})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _db
    yield app, engine
    if previous is None:
        app.dependency_overrides.pop(get_db, None)
    else:
        app.dependency_overrides[get_db] = previous
    engine.dispose()


def _owner(app, label="a"):
    c = TestClient(app)
    email = f"race-{label}-{uuid.uuid4().hex[:8]}@example.com"
    c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    tok = c.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert c.post("/api/v1/shops", json={"shop_name": "K", "owner_name": "R", "business_type": "Grocery/Kirana",
                                         "location": "B"}, headers=h).status_code == 201
    product = c.post("/api/v1/products", json={"name": "Race Rice", "unit": "kg", "current_stock": 10,
                                               "selling_price": 60, "purchase_price": 50}, headers=h)
    assert product.status_code == 201, product.text
    supplier = c.post("/api/v1/suppliers", json={"supplier_name": "Race Traders"}, headers=h)
    assert supplier.status_code == 201, supplier.text
    return h, product.json()["id"], supplier.json()["id"]


def _payload(product_id, invoice_number, supplier_id=None, supplier_name=None, qty=2.5):
    body = {"invoice_number": invoice_number, "items": [{
        "name": "Race Rice", "matched_product_id": product_id, "quantity": qty, "unit": "kg",
        "purchase_price": 50.0, "selling_price": 60.0}]}
    if supplier_id:
        body["supplier_id"] = supplier_id
    if supplier_name:
        body["supplier_name"] = supplier_name
    return body


def _race(app, monkeypatch, requests):
    """Send the requests at the same time; each is held after the duplicate check until all have passed it."""
    barrier = threading.Barrier(len(requests), timeout=20)
    held = threading.local()
    real = invoice_service.validate_unit_text

    def hold_then_validate(*args, **kwargs):
        if not getattr(held, "done", False):
            held.done = True
            try:
                barrier.wait()
            except threading.BrokenBarrierError:
                pass
        return real(*args, **kwargs)

    monkeypatch.setattr(invoice_service, "validate_unit_text", hold_then_validate)
    results = [None] * len(requests)

    def run(i, headers, body):
        r = TestClient(app).post("/api/v1/invoices/confirm", json=body, headers=headers)
        results[i] = (r.status_code, r.json())

    threads = [threading.Thread(target=run, args=(i, h, b)) for i, (h, b) in enumerate(requests)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    monkeypatch.setattr(invoice_service, "validate_unit_text", real)
    return results


def _counts(engine, product_id):
    pid = uuid.UUID(product_id).hex  # UUIDs are stored as 32-char hex on SQLite
    with engine.connect() as conn:
        purchases = conn.execute(text("SELECT count(*) FROM purchases")).scalar()
        items = conn.execute(text("SELECT count(*) FROM purchase_items")).scalar()
        stock = conn.execute(text("SELECT current_stock FROM products WHERE id = :id"), {"id": pid}).scalar()
    return purchases, items, stock


@pytest.mark.parametrize("variant", ["same_supplier", "no_supplier", "case_and_spaces", "new_supplier_by_name"])
def test_concurrent_duplicate_confirmations_commit_exactly_once(env, monkeypatch, variant):
    app, engine = env
    h, pid, sid = _owner(app)
    bodies = {
        "same_supplier": (_payload(pid, "INV-101", sid), _payload(pid, "INV-101", sid)),
        "no_supplier": (_payload(pid, "INV-101"), _payload(pid, "INV-101")),
        "case_and_spaces": (_payload(pid, "INV-101", sid), _payload(pid, " inv-101 ", sid)),
        "new_supplier_by_name": (_payload(pid, "INV-101", supplier_name="Brand New Traders"),
                                 _payload(pid, "INV-101", supplier_name="brand new traders")),
    }[variant]
    results = _race(app, monkeypatch, [(h, bodies[0]), (h, bodies[1])])
    statuses = sorted(s for s, _ in results)
    assert statuses == [201, 409], results
    loser = next(b for s, b in results if s == 409)
    assert "already added to stock" in loser["detail"]
    assert _counts(engine, pid) == (1, 1, 12.5), "exactly one purchase, one item set and one +2.5 kg increment"


def test_concurrent_distinct_invoices_both_commit(env, monkeypatch):
    app, engine = env
    h, pid, sid = _owner(app)
    results = _race(app, monkeypatch, [(h, _payload(pid, "INV-101", sid)), (h, _payload(pid, "INV-102", sid))])
    assert sorted(s for s, _ in results) == [201, 201], results
    assert _counts(engine, pid) == (2, 2, 15.0)


def test_concurrent_purchases_without_invoice_number_both_commit(env, monkeypatch):
    app, engine = env
    h, pid, sid = _owner(app)
    results = _race(app, monkeypatch, [(h, _payload(pid, None, sid)), (h, _payload(pid, None, sid))])
    assert sorted(s for s, _ in results) == [201, 201], results
    assert _counts(engine, pid) == (2, 2, 15.0)


# ------------------------------------------------------------------ sequential identity rules (scenarios 1-6)


def _confirm(app, h, body):
    return TestClient(app).post("/api/v1/invoices/confirm", json=body, headers=h).status_code


def test_invoice_identity_rules(env):
    app, engine = env
    h, pid, sid = _owner(app, "a")
    h2, pid2, sid2 = _owner(app, "b")
    other = TestClient(app).post("/api/v1/suppliers", json={"supplier_name": "Other Traders"}, headers=h).json()["id"]

    assert _confirm(app, h, _payload(pid, "INV-101", sid)) == 201
    assert _confirm(app, h, _payload(pid, "INV-101", sid)) == 409          # 1. same shop, supplier, number
    assert _confirm(app, h, _payload(pid, "inv-101", sid)) == 409          # 3. case only
    assert _confirm(app, h, _payload(pid, "INV-101")) == 201               # no supplier is its own identity
    assert _confirm(app, h, _payload(pid, "INV-101")) == 409               # 2. missing supplier, same number
    assert _confirm(app, h2, _payload(pid2, "INV-101", sid2)) == 201       # 4. another shop
    assert _confirm(app, h, _payload(pid, "INV-102", sid)) == 201          # 5. same supplier, other number
    assert _confirm(app, h, _payload(pid, "INV-101", other)) == 201        # different supplier
    assert _confirm(app, h, _payload(pid, None, sid)) == 201               # 6. no invoice number, twice
    assert _confirm(app, h, _payload(pid, None, sid)) == 201


def test_database_enforces_identity_without_the_application(env):
    """Raw inserts (bypassing the service) still cannot create a duplicate identity."""
    app, engine = env
    h, pid, sid = _owner(app)
    sup = uuid.UUID(sid).hex
    with engine.connect() as conn:
        shop = conn.execute(text("SELECT id FROM shops LIMIT 1")).scalar()

    def insert(supplier, number):
        try:
            with engine.begin() as conn:
                conn.execute(text("INSERT INTO purchases (id, shop_id, supplier_id, total_amount, invoice_number) "
                                  "VALUES (:id, :shop, :sup, 0, :num)"),
                             {"id": uuid.uuid4().hex, "shop": shop, "sup": supplier, "num": number})
            return True
        except Exception:
            return False

    assert insert(sup, "INV-9") and not insert(sup, "INV-9")       # same supplier
    assert not insert(sup, "inv-9")                                  # case-insensitive
    assert insert(None, "INV-9") and not insert(None, "INV-9")      # NULL supplier
    assert insert(None, None) and insert(None, None)                 # no invoice number: unrestricted
