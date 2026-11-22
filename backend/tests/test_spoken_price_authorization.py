"""
Stage 4C.1 Decision 1: a spoken (customer-requested) price in Voice-to-Bill.

- The server prices every line from the catalogue (Universal Decimal Pricing Engine).
- A requested price within ₹0.01 of the catalogue line checks out normally (any role, no override).
- A different requested price is never applied silently: a Cashier is refused (403, nothing written);
  a Manager or Owner may approve it if it is above zero and within the line MRP; every approved override
  is recorded in PricingAuditLog in the same transaction as the sale.
"""

from sqlalchemy import text

from tests.test_stage4c1_verification import _product, api, shop  # noqa: F401  (fixtures)


def _sale(c, h, lines):
    return c.post("/api/v1/sales", json={"items": lines, "payment_method": "cash"}, headers=h)


def _state(c, engine, h, pid):
    stock = c.get(f"/api/v1/products/{pid}", headers=h).json()["current_stock"]
    with engine.connect() as conn:
        sales = conn.execute(text("SELECT count(*) FROM sales")).scalar()
        audits = conn.execute(text("SELECT count(*) FROM pricing_audit_logs WHERE action_type = 'SALE_PRICE_OVERRIDE'")).scalar()
    return stock, sales, audits


def _tea(c, roles, **over):
    return _product(c, roles["owner"], name="Tea", unit="packet", price_basis_unit="packet", selling_price=40.0,
                    current_stock=20, pricing_status="VERIFIED", **over)


def test_matching_spoken_price_checks_out_normally_for_a_cashier(shop):
    c, engine, roles = shop
    tea = _tea(c, roles)
    r = _sale(c, roles["cashier"], [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 120.0}])
    assert r.status_code == 201, r.text
    assert r.json()["total_amount"] == 120.0
    # within the ₹0.01 tolerance is the same price
    r = _sale(c, roles["cashier"], [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 120.01}])
    assert r.status_code == 201 and r.json()["total_amount"] == 120.0
    assert _state(c, engine, roles["owner"], tea["id"]) == (14, 2, 0)  # no override recorded


def test_cashier_cannot_apply_a_different_spoken_price(shop):
    c, engine, roles = shop
    tea = _tea(c, roles)
    r = _sale(c, roles["cashier"], [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 100.0}])
    assert r.status_code == 403
    assert "Manager approval required" in r.json()["detail"] and "₹100.00" in r.json()["detail"] and "₹120.00" in r.json()["detail"]
    assert _state(c, engine, roles["owner"], tea["id"]) == (20, 0, 0)  # nothing sold, nothing audited


def test_manager_approves_a_spoken_price_and_it_is_audited(shop):
    c, engine, roles = shop
    tea = _tea(c, roles)
    r = _sale(c, roles["manager"], [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 100.0}])
    assert r.status_code == 201, r.text
    sale = r.json()
    assert sale["total_amount"] == 100.0
    assert _state(c, engine, roles["owner"], tea["id"]) == (17, 1, 1)
    (entry,) = [e for e in c.get(f"/api/v1/products/{tea['id']}/audit-trail", headers=roles["owner"]).json()
                if e["action_type"] == "SALE_PRICE_OVERRIDE"]
    assert entry["previous_selling_price"] == 40.0 and round(entry["new_selling_price"], 3) == 33.333
    assert sale["id"][:8] in entry["reason"] and "requested ₹100.00 instead of catalogue ₹120.00" in entry["reason"]
    with engine.connect() as conn:
        actor = conn.execute(text("SELECT acting_user_id FROM pricing_audit_logs WHERE action_type = 'SALE_PRICE_OVERRIDE'")).scalar()
        cashier_or_manager = conn.execute(text("SELECT user_id, role FROM shop_members")).fetchall()
    assert dict((str(u), r) for u, r in cashier_or_manager)[str(actor)] == "MANAGER"
    # the catalogue price itself is unchanged
    assert c.get(f"/api/v1/products/{tea['id']}", headers=roles["owner"]).json()["selling_price"] == 40.0


def test_owner_may_approve_too(shop):
    c, engine, roles = shop
    tea = _tea(c, roles)
    r = _sale(c, roles["owner"], [{"product_id": tea["id"], "quantity": 2, "requested_line_total": 75.0}])
    assert r.status_code == 201 and r.json()["total_amount"] == 75.0
    assert _state(c, engine, roles["owner"], tea["id"]) == (18, 1, 1)


def test_spoken_price_above_mrp_is_refused_even_for_a_manager(shop):
    c, engine, roles = shop
    tea = _tea(c, roles, mrp=45.0)  # line MRP for 3 = ₹135
    r = _sale(c, roles["manager"], [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 140.0}])
    assert r.status_code == 400 and "MRP" in r.json()["detail"]
    assert _state(c, engine, roles["owner"], tea["id"]) == (20, 0, 0)
    ok = _sale(c, roles["manager"], [{"product_id": tea["id"], "quantity": 3, "requested_line_total": 130.0}])
    assert ok.status_code == 201 and ok.json()["total_amount"] == 130.0


def test_zero_spoken_price_is_refused(shop):
    c, engine, roles = shop
    tea = _tea(c, roles)
    r = _sale(c, roles["owner"], [{"product_id": tea["id"], "quantity": 1, "requested_line_total": 0}])
    assert r.status_code == 400 and "greater than zero" in r.json()["detail"]
    assert _state(c, engine, roles["owner"], tea["id"]) == (20, 0, 0)


def test_a_bill_with_an_unapproved_line_is_refused_as_a_whole(shop):
    c, engine, roles = shop
    tea = _tea(c, roles)
    sugar = _product(c, roles["owner"], name="Sugar", pricing_status="VERIFIED")
    r = _sale(c, roles["cashier"], [{"product_id": sugar["id"], "quantity": 1},
                                     {"product_id": tea["id"], "quantity": 3, "requested_line_total": 100.0}])
    assert r.status_code == 403
    assert c.get(f"/api/v1/products/{sugar['id']}", headers=roles["owner"]).json()["current_stock"] == 10
    assert _state(c, engine, roles["owner"], tea["id"]) == (20, 0, 0)


def test_unverified_products_cannot_be_sold_even_with_approval(shop):
    c, _, roles = shop
    p = _product(c, roles["owner"], name="New Item")  # NEEDS_REVIEW
    r = _sale(c, roles["manager"], [{"product_id": p["id"], "quantity": 1, "requested_line_total": 50.0}])
    assert r.status_code == 400 and "requires manager pricing review" in r.json()["detail"]


def test_voice_flags_a_different_spoken_price_for_approval(shop):
    c, _, roles = shop
    _tea(c, roles)
    v = c.post("/api/v1/voice/process", json={"simulation_text": "3 tea packets for 100 rupees", "language_code": "en-IN"},
               headers=roles["cashier"]).json()
    (m,) = v["matched_items"]
    assert (m["total_price"], m["catalog_line_total"], m["needs_price_approval"]) == (100.0, 120.0, True)
    same = c.post("/api/v1/voice/process", json={"simulation_text": "3 tea packets for 120 rupees", "language_code": "en-IN"},
                  headers=roles["cashier"]).json()["matched_items"][0]
    assert (same["total_price"], same["needs_price_approval"]) == (120.0, False)
