"""
Stage 5 frontend-integration endpoints (read-only):

- GET  /shops/me/membership: the signed-in user's role, so the interface offers the right actions
  (authorization stays with every endpoint).
- POST /sales/quote: prices a cart exactly as checkout would (same evaluation code), line by line, without
  recording a sale or changing stock, so the POS shows server totals and reasons instead of its own pricing.
"""

import uuid

from sqlalchemy import text

from tests.test_stage4c1_verification import _product, _user, api, shop  # noqa: F401  (fixtures)


def _quote(c, h, lines):
    r = c.post("/api/v1/sales/quote", json={"items": lines, "payment_method": "cash"}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _counts(engine):
    with engine.connect() as conn:
        return tuple(conn.execute(text(f"SELECT count(*) FROM {t}")).scalar() for t in ("sales", "sale_items", "pricing_audit_logs"))


# ------------------------------------------------------------------------------- membership


def test_membership_reports_each_role(shop):
    c, _, roles = shop
    got = {r: c.get("/api/v1/shops/me/membership", headers=roles[r]).json() for r in ("owner", "manager", "cashier")}
    assert {r: got[r]["role"] for r in got} == {"owner": "OWNER", "manager": "MANAGER", "cashier": "CASHIER"}
    assert [got[r]["can_approve_price_overrides"] for r in ("owner", "manager", "cashier")] == [True, True, False]
    assert [got[r]["can_verify_pricing"] for r in ("owner", "manager", "cashier")] == [True, True, False]
    assert len({got[r]["shop_id"] for r in got}) == 1
    _, outsider = _user(c, "outsider")
    assert c.get("/api/v1/shops/me/membership", headers=outsider).status_code == 404


# ------------------------------------------------------------------------------- quote


def test_quote_returns_server_totals_and_basis(shop):
    c, engine, roles = shop
    h = roles["cashier"]
    tea = _product(c, roles["owner"], name="Tea", unit="packet", price_basis_unit="packet", selling_price=40.0, pricing_status="VERIFIED")
    saffron = _product(c, roles["owner"], name="Saffron", unit="kg", selling_price=30.0, price_basis_quantity=100,
                       price_basis_unit="g", pricing_status="VERIFIED")
    before = _counts(engine)
    q = _quote(c, h, [{"product_id": tea["id"], "quantity": 3}, {"product_id": saffron["id"], "quantity": 0.25}])
    a, b = q["lines"]
    assert (a["ok"], a["line_total"], a["effective_unit_price"], a["pricing_basis_quantity"], a["pricing_basis_unit"]) == (True, 120.0, 40.0, 1.0, "packet")
    # ₹30 per 100 g, 0.25 kg = 250 g -> ₹75.00 (computed by the server's engine, not the browser)
    assert (b["ok"], b["line_total"], b["pricing_basis_quantity"], b["pricing_basis_unit"], b["stock_deduction_quantity"]) == (True, 75.0, 100.0, "g", 0.25)
    assert (q["total"], q["all_ok"], q["requires_approval"], q["role"]) == (195.0, True, False, "CASHIER")
    assert _counts(engine) == before  # nothing recorded
    assert c.get(f"/api/v1/products/{tea['id']}", headers=h).json()["current_stock"] == 10


def test_quote_explains_each_pricing_status(shop):
    c, engine, roles = shop
    o = roles["owner"]
    verified = _product(c, o, name="Verified", pricing_status="VERIFIED")
    review = _product(c, o, name="Review")  # NEEDS_REVIEW (default)
    incomplete = _product(c, o, name="Incomplete", pricing_status="VERIFIED")
    wholesale = _product(c, o, name="Wholesale Bag", unit="bag", price_basis_unit="bag", pricing_status="VERIFIED")
    with engine.begin() as conn:
        conn.execute(text("UPDATE products SET pricing_status = 'INCOMPLETE' WHERE id = :i"), {"i": uuid.UUID(incomplete["id"]).hex})
        conn.execute(text("UPDATE products SET pricing_status = 'WHOLESALE_ONLY' WHERE id = :i"), {"i": uuid.UUID(wholesale["id"]).hex})
    q = _quote(c, roles["cashier"], [{"product_id": p["id"], "quantity": 1} for p in (verified, review, incomplete, wholesale)])
    by = {line["index"]: line for line in q["lines"]}
    assert by[0]["ok"] and by[0]["pricing_status"] == "VERIFIED"
    assert (by[1]["ok"], by[1]["code"], by[1]["pricing_status"]) == (False, "pricing_status", "NEEDS_REVIEW")
    assert (by[2]["ok"], by[2]["code"], by[2]["pricing_status"]) == (False, "pricing_status", "INCOMPLETE")
    assert by[3]["ok"] and by[3]["pricing_status"] == "WHOLESALE_ONLY"  # whole bags are fine
    assert not q["all_ok"]
    # Wholesale-only: a loose (fractional) quantity is refused, never rounded
    wq = _quote(c, roles["cashier"], [{"product_id": wholesale["id"], "quantity": 1.5}])["lines"][0]
    assert not wq["ok"] and wq["code"] in ("unit", "invalid")


def test_quote_reports_mrp_stock_and_unit_problems(shop):
    c, engine, roles = shop
    o = roles["owner"]
    p = _product(c, o, name="Ghee", unit="L", price_basis_unit="L", selling_price=60.0, mrp=70.0, pricing_status="VERIFIED")
    with engine.begin() as conn:
        conn.execute(text("UPDATE products SET selling_price = 75 WHERE id = :i"), {"i": uuid.UUID(p["id"]).hex})
    q = _quote(c, roles["cashier"], [{"product_id": p["id"], "quantity": 1}, {"product_id": p["id"], "quantity": 99},
                                     {"product_id": p["id"], "quantity": 1, "unit": "kg"}])
    codes = [line["code"] for line in q["lines"]]
    assert codes[0] == "mrp_exceeded" and "MRP" in q["lines"][0]["message"]
    assert codes[1] in ("mrp_exceeded", "insufficient_stock")
    assert codes[2] == "unit"


def test_quote_requested_price_by_role(shop):
    c, engine, roles = shop
    tea = _product(c, roles["owner"], name="Tea", unit="packet", price_basis_unit="packet", selling_price=40.0,
                   mrp=45.0, pricing_status="VERIFIED")
    before = _counts(engine)
    line = [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 100.0}]
    cq = _quote(c, roles["cashier"], line)
    cl = cq["lines"][0]
    assert (cl["ok"], cl["code"], cl["requires_approval"], cl["catalogue_line_total"], cl["line_total"]) == (False, "approval_required", True, 120.0, 120.0)
    assert (cq["requires_approval"], cq["can_approve_price_overrides"]) == (True, False)
    mq = _quote(c, roles["manager"], line)
    ml = mq["lines"][0]
    assert (ml["ok"], ml["requires_approval"], ml["line_total"], mq["total"], mq["can_approve_price_overrides"]) == (True, True, 100.0, 100.0, True)
    over = _quote(c, roles["manager"], [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 140.0}])["lines"][0]
    assert (over["ok"], over["code"]) == (False, "mrp_exceeded") and "MRP" in over["message"]  # ₹140 > line MRP ₹135
    same = _quote(c, roles["cashier"], [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 120.0}])["lines"][0]
    assert (same["ok"], same["requires_approval"]) == (True, False)
    assert _counts(engine) == before  # a quote never records a sale or an audit entry


def test_quote_is_shop_scoped(shop):
    c, _, roles = shop
    p = _product(c, roles["owner"], name="Private", pricing_status="VERIFIED")
    _, outsider = _user(c, "outsider2")
    c.post("/api/v1/shops", json={"shop_name": "Other", "owner_name": "O", "business_type": "Grocery/Kirana", "location": "X"}, headers=outsider)
    line = _quote(c, outsider, [{"product_id": p["id"], "quantity": 1}])["lines"][0]
    assert (line["ok"], line["code"], line["line_total"]) == (False, "not_found", None)
