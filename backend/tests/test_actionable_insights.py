"""
Stage 7.5: proactive, prioritized insights (GET /api/v1/insights/actionable).

- Every category is produced only from real records, with evidence and a centralized priority.
- No stockout prediction without demand history; no trend from insufficient history; no
  "fast-moving" from a single sale; new products are not called slow-moving.
- Read-only, deterministic, shop-isolated, OWNER/MANAGER only, constant query count.
In-memory database; generic test values.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import db.models  # noqa: F401
from api.deps import get_db
from db.models.notification import Notification
from db.models.product import Product
from db.models.sale import Sale
from db.models.sale_item import SaleItem
from db.session import Base
from main import app
from schemas.forecast import ShopForecastSummary
from services import actionable_insights as engine_mod
from services.actionable_insights import build_actionable_insights
from services.forecasting import invalidate_forecast_cache
from services.insight_rules import DEFAULT_THRESHOLDS, forecast_stockout_priority, sales_trend_priority
from schemas.forecast import ConfidenceLevel

_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(bind=_engine, autoflush=False)
NOW = datetime.now(timezone.utc).replace(microsecond=0)


@pytest.fixture(autouse=True)
def _db():
    Base.metadata.create_all(bind=_engine)

    def override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override
    invalidate_forecast_cache()
    yield
    app.dependency_overrides.clear()
    invalidate_forecast_cache()
    Base.metadata.drop_all(bind=_engine)


client = TestClient(app)


def owner(tag="o"):
    email = f"ai-{tag}-{uuid.uuid4().hex[:8]}@example.com"
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    tok = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    r = client.post("/api/v1/shops", json={"shop_name": "S", "owner_name": "O", "business_type": "Grocery/Kirana", "location": "L"}, headers=h)
    assert r.status_code == 201, r.text
    return h, uuid.UUID(r.json()["id"])


def member(shop_id, owner_h, role):
    email = f"ai-{role.lower()}-{uuid.uuid4().hex[:8]}@example.com"
    uid = client.post("/api/v1/auth/register", json={"email": email, "password": "password123"}).json()["id"]
    r = client.post(f"/api/v1/shops/{shop_id}/members", json={"user_id": uid, "role": role}, headers=owner_h)
    assert r.status_code in (200, 201), r.text
    tok = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def product(db, shop_id, name, stock, *, unit="pcs", reorder=0, age_days=60):
    p = Product(
        name=name, selling_price=10.0, purchase_price=5.0, current_stock=stock, reorder_level=reorder, unit=unit,
        shop_id=shop_id, is_active=True, pricing_status="VERIFIED", created_at=NOW - timedelta(days=age_days),
    )
    db.add(p)
    db.commit()
    return p


def sale(db, shop_id, when, lines):
    s = Sale(shop_id=shop_id, total_amount=sum(q * price for _, q, price in lines), payment_method="cash", created_at=when)
    db.add(s)
    db.flush()
    for p, q, price in lines:
        db.add(SaleItem(sale_id=s.id, product_id=p.id, quantity=q, unit_price=price, created_at=when))
    db.commit()
    return s


def build(db, shop_id, now=NOW):
    insights, summary, _ = build_actionable_insights(db, shop_id, now=now, use_forecast_cache=False)
    return insights, summary


def by_type(insights, t, name=None):
    return [i for i in insights if i.type == t and (name is None or i.product_name == name)]


def ev(insight):
    return {e.label: (e.value, e.source.value) for e in insight.evidence}


# ------------------------------------------------------------------------------ priority rules

def test_priority_rules_are_centralized_and_explainable():
    t = DEFAULT_THRESHOLDS
    assert forecast_stockout_priority(2, ConfidenceLevel.MEDIUM, t).value == "CRITICAL"
    assert forecast_stockout_priority(2, ConfidenceLevel.LOW, t).value == "HIGH"  # never CRITICAL on low confidence
    assert forecast_stockout_priority(6, ConfidenceLevel.HIGH, t).value == "HIGH"
    assert forecast_stockout_priority(6, ConfidenceLevel.LOW, t).value == "MEDIUM"
    assert forecast_stockout_priority(10, ConfidenceLevel.HIGH, t) is None
    assert forecast_stockout_priority(1, ConfidenceLevel.NONE, t) is None
    assert sales_trend_priority(-45, t).value == "HIGH"
    assert sales_trend_priority(-25, t).value == "MEDIUM"
    assert sales_trend_priority(-10, t) is None and sales_trend_priority(15, t) is None
    assert sales_trend_priority(30, t).value == "LOW"


# ------------------------------------------------------------------------------ inventory risk

def test_out_of_stock_with_and_without_demand():
    _, shop = owner()
    db = Session()
    rice = product(db, shop, "Rice", 0, unit="kg", reorder=5)
    oil = product(db, shop, "Oil", 0, unit="L")
    sale(db, shop, NOW - timedelta(days=3), [(rice, 2, 60.0)])
    sale(db, shop, NOW - timedelta(days=40), [(oil, 1, 120.0)])
    insights, summary = build(db, shop)

    r = by_type(insights, "out_of_stock_with_demand", "Rice")[0]
    assert r.priority.value == "CRITICAL" and r.category.value == "INVENTORY_RISK"
    e = ev(r)
    assert e["Current stock"] == ("0 kg", "OBSERVED")
    assert e["Sold in the last 30 days"] == ("2 kg in 1 transaction", "OBSERVED")
    assert e["Minimum stock level"] == ("5 kg", "CONFIGURED")
    assert r.is_actionable and r.suggested_action.startswith("Restock Rice")

    o = by_type(insights, "out_of_stock", "Oil")[0]
    assert o.priority.value == "MEDIUM"
    assert "Last sold" in ev(o)
    assert insights[0].id == r.id  # CRITICAL first
    assert summary.out_of_stock_count == 2
    db.close()


def _daily_sales(db, shop, p, days, qty, price=10.0):
    for k in range(1, days + 1):
        sale(db, shop, NOW - timedelta(days=k), [(p, qty, price)])


def test_forecast_stockout_priorities_follow_confidence_and_merge_low_stock():
    _, shop = owner()
    db = Session()
    milk = product(db, shop, "Milk", 3, unit="L", reorder=5, age_days=20)     # tier 1, ~2 days left
    eggs = product(db, shop, "Eggs", 8, age_days=20)                           # tier 1, ~5-6 days left
    bread = product(db, shop, "Bread", 2, age_days=6)                          # tier 2 (3 sales), LOW confidence
    _daily_sales(db, shop, milk, 15, 2)
    _daily_sales(db, shop, eggs, 15, 2)
    _daily_sales(db, shop, bread, 3, 2)
    insights, summary = build(db, shop)

    m = by_type(insights, "imminent_stockout", "Milk")[0]
    assert m.priority.value == "CRITICAL" and m.data_quality.value == "MEDIUM"
    e = ev(m)
    assert e["Estimated daily demand"][1] == "FORECAST" and e["Projected stock cover"][1] == "FORECAST"
    assert e["Minimum stock level"] == ("5 L", "CONFIGURED")
    assert not by_type(insights, "below_minimum_stock", "Milk")  # merged, not duplicated
    assert "lead time" in m.suggested_action and "advisory" in m.suggested_action
    assert "(medium confidence" in m.suggested_action  # a forecast quantity always carries its confidence

    assert by_type(insights, "stockout_within_7_days", "Eggs")[0].priority.value == "HIGH"

    b = (by_type(insights, "imminent_stockout", "Bread") or by_type(insights, "stockout_within_7_days", "Bread"))[0]
    assert b.priority.value in ("HIGH", "MEDIUM") and b.data_quality.value == "LOW"
    assert "limited sales history" in b.description
    assert summary.forecast_stockout_risk_count == 3
    db.close()


def test_no_stockout_prediction_without_demand_history():
    _, shop = owner()
    db = Session()
    product(db, shop, "Jam", 2, reorder=5, age_days=60)  # never sold, below minimum
    insights, _ = build(db, shop)
    assert not [i for i in insights if i.type in ("imminent_stockout", "stockout_within_7_days") and i.product_name == "Jam"]
    low = by_type(insights, "below_minimum_stock", "Jam")[0]
    assert low.priority.value == "MEDIUM" and low.category.value == "LOW_STOCK"
    assert ev(low)["Minimum stock level"] == ("5 pcs", "CONFIGURED")
    assert low.current_value == 2 and low.threshold_value == 5
    db.close()


def test_threshold_not_set_means_no_low_stock_insight():
    _, shop = owner()
    db = Session()
    product(db, shop, "Salt", 1, reorder=0, age_days=5)
    insights, _ = build(db, shop)
    assert not by_type(insights, "below_minimum_stock")
    db.close()


# ------------------------------------------------------------------------------ sales trends

def _trend_shop(db, shop, prev_amount, cur_amount, n=6):
    p = product(db, shop, "Tea", 1000, age_days=90)
    sale(db, shop, NOW - timedelta(days=20), [(p, 1, 10.0)])  # history covers both windows
    for k in range(n):
        sale(db, shop, NOW - timedelta(days=8, hours=k * 5), [(p, 1, prev_amount)])
        sale(db, shop, NOW - timedelta(days=1, hours=k * 5), [(p, 1, cur_amount)])
    return p


@pytest.mark.parametrize("prev,cur,expected_type,priority", [
    (100.0, 40.0, "sales_decline", "HIGH"),
    (100.0, 75.0, "sales_decline", "MEDIUM"),
    (100.0, 130.0, "sales_increase", "LOW"),
    (100.0, 95.0, "sales_stable", "INFO"),
])
def test_sales_trend_compares_equal_windows(prev, cur, expected_type, priority):
    _, shop = owner()
    db = Session()
    _trend_shop(db, shop, prev, cur)
    insights, _ = build(db, shop)
    tr = by_type(insights, expected_type)
    assert len(tr) == 1, [i.type for i in insights]
    i = tr[0]
    assert i.priority.value == priority
    labels = list(ev(i))
    assert labels[0].startswith("Last 7 days (") and "UTC" in labels[0]
    assert labels[1].startswith("Previous 7 days (")
    assert ev(i)[labels[1]][0] == f"₹{prev * 6:,.2f} in 6 transactions"
    assert i.is_actionable == (expected_type == "sales_decline")
    db.close()


def test_no_trend_from_insufficient_history():
    _, shop = owner()
    db = Session()
    p = product(db, shop, "Tea", 100, age_days=5)
    for k in range(6):
        sale(db, shop, NOW - timedelta(days=2, hours=k), [(p, 1, 100.0)])
    insights, summary = build(db, shop)
    assert not [i for i in insights if i.type in ("sales_decline", "sales_increase", "sales_stable")]
    note = by_type(insights, "insufficient_sales_history")[0]
    assert note.priority.value == "INFO" and note.data_quality.value == "INSUFFICIENT"
    assert summary.data_notes and "Sales trend not assessed" in summary.data_notes[0]
    db.close()


def test_unusually_low_last_day():
    _, shop = owner()
    db = Session()
    p = product(db, shop, "Tea", 1000, age_days=90)
    day0 = NOW.replace(hour=12, minute=0, second=0) if NOW.hour >= 12 else NOW.replace(hour=0, minute=30, second=0)
    for d in range(2, 17):  # 15 full days before yesterday, ₹100 each
        sale(db, shop, day0 - timedelta(days=d), [(p, 1, 100.0)])
    sale(db, shop, day0 - timedelta(days=1), [(p, 1, 20.0)])  # yesterday: ₹20
    insights, _ = build(db, shop)
    low = by_type(insights, "unusually_low_day")
    assert low and low[0].priority.value == "MEDIUM"
    assert low[0].current_value == 20.0 and low[0].threshold_value == 100.0
    db.close()


# ------------------------------------------------------------------------------ fast / slow moving

def test_fast_moving_needs_repeated_sales_and_is_observed():
    _, shop = owner()
    db = Session()
    one = product(db, shop, "Single", 50, age_days=90)
    tea = product(db, shop, "Tea", 500, age_days=90)
    sale(db, shop, NOW - timedelta(days=2), [(one, 30, 10.0)])  # one big sale: not fast-moving
    for k in (1, 2, 3, 5):
        sale(db, shop, NOW - timedelta(days=k), [(tea, 2, 10.0)])
    insights, _ = build(db, shop)
    assert not by_type(insights, "high_volume_product", "Single")
    hv = by_type(insights, "high_volume_product", "Tea")[0]
    assert hv.priority.value == "LOW" and not hv.is_actionable
    assert ev(hv)["Sold in the last 14 days"] == ("8 pcs in 4 transactions", "OBSERVED")
    # Observed history and forecast estimates are kept apart and labelled
    assert ev(hv)["Estimated daily demand (forecast)"][1] == "FORECAST"
    assert ev(hv)["Days with sales"] == ("4", "OBSERVED")
    db.close()


def test_increasing_demand_compares_equal_product_windows():
    _, shop = owner()
    db = Session()
    tea = product(db, shop, "Tea", 500, age_days=90)
    for k in (16, 20):
        sale(db, shop, NOW - timedelta(days=k), [(tea, 1, 10.0)])
    for k in (1, 3, 5, 7):
        sale(db, shop, NOW - timedelta(days=k), [(tea, 2, 10.0)])
    insights, _ = build(db, shop)
    inc = by_type(insights, "increasing_demand", "Tea")[0]
    assert ev(inc)["Change"] == ("+300%", "OBSERVED")
    assert not by_type(insights, "high_volume_product", "Tea")  # not reported twice
    db.close()


def test_slow_moving_only_with_full_observation_window():
    _, shop = owner()
    db = Session()
    product(db, shop, "Old Soap", 40, age_days=90)
    product(db, shop, "New Soap", 40, age_days=5)
    insights, _ = build(db, shop)
    slow = by_type(insights, "no_sales_in_window", "Old Soap")[0]
    assert slow.priority.value == "MEDIUM" and slow.category.value == "SLOW_MOVING"
    assert ev(slow)["Last sold"] == ("Never recorded", "OBSERVED")
    assert "dead" not in (slow.title + slow.description).lower()
    assert not by_type(insights, "no_sales_in_window", "New Soap")
    new = by_type(insights, "too_new_to_assess")[0]
    assert new.priority.value == "INFO" and "New Soap" in ev(new)["Products"][0]
    db.close()


def test_excess_stock_relative_to_observed_demand():
    _, shop = owner()
    db = Session()
    oil = product(db, shop, "Oil", 600, unit="L", age_days=90)
    for k in (3, 10, 20):
        sale(db, shop, NOW - timedelta(days=k), [(oil, 1, 100.0)])
    insights, _ = build(db, shop)
    ex = by_type(insights, "excess_stock", "Oil")[0]
    assert ex.priority.value == "LOW" and ex.category.value == "INVENTORY_OPPORTUNITY"
    assert ev(ex)["Stock cover at that rate"] == ("6000 days", "OBSERVED")
    assert "advisory" in ex.suggested_action
    db.close()


# ------------------------------------------------------------------------------ summary, safety

def test_daily_summary_uses_only_recorded_values():
    _, shop = owner()
    db = Session()
    tea = product(db, shop, "Tea", 50, age_days=90)
    sugar = product(db, shop, "Sugar", 10, unit="kg", age_days=90)
    today = max(NOW - timedelta(minutes=1), NOW.replace(hour=0, minute=0, second=1))
    sale(db, shop, today, [(tea, 2, 40.0), (sugar, 1, 44.0)])
    insights, s = build(db, shop)
    assert (s.today_sales, s.today_transactions, s.products_sold_today) == (124.0, 1, 2)
    assert s.has_sales_history and s.forecast_stockout_risk_count == 0
    assert s.highlights[0] == "No urgent issues found in the current records."

    _, empty = owner("e")
    _, s2 = build(db, empty)
    assert (s2.today_sales, s2.today_transactions, s2.has_sales_history) == (0.0, 0, False)
    assert s2.data_notes == ["No sales recorded yet, so there are no sales trends."]
    db.close()


def test_read_only_and_deterministic():
    _, shop = owner()
    db = Session()
    rice = product(db, shop, "Rice", 0, unit="kg", reorder=5)
    sale(db, shop, NOW - timedelta(days=1), [(rice, 2, 60.0)])
    counts = lambda: (db.query(Sale).count(), db.query(SaleItem).count(), db.query(Notification).count(), [p.current_stock for p in db.query(Product).all()])
    before = counts()
    a, _ = build(db, shop)
    b, _ = build(db, shop)
    assert [i.model_dump() for i in a] == [i.model_dump() for i in b]
    db.expire_all()
    assert counts() == before
    db.close()


def test_query_count_does_not_grow_with_products(monkeypatch):
    """This module issues a fixed number of queries (forecast stubbed: it is the existing engine)."""
    monkeypatch.setattr(engine_mod, "get_shop_forecast", lambda *a, **k: ShopForecastSummary(
        shop_id=uuid.uuid4(), generated_at=NOW.isoformat(), total_products_analyzed=0, tier_1_count=0,
        tier_2_count=0, tier_3_count=0, out_of_stock_count=0, at_risk_stockout_7d_count=0, forecasts=[]))

    def run(n):
        _, shop = owner(f"q{n}")
        db = Session()
        prods = [product(db, shop, f"P{i}", i, reorder=3) for i in range(n)]
        for p in prods:
            sale(db, shop, NOW - timedelta(days=1), [(p, 1, 10.0)])
        statements = []
        listener = lambda *args: statements.append(args[2])
        event.listen(_engine, "before_cursor_execute", listener)
        try:
            build(db, shop)
        finally:
            event.remove(_engine, "before_cursor_execute", listener)
        db.close()
        return len(statements)

    assert run(3) == run(25) == 5


# ------------------------------------------------------------------------------ API: RBAC, isolation, filters

def test_api_roles_isolation_and_filters():
    h, shop = owner("a")
    hb, shop_b = owner("b")
    db = Session()
    rice = product(db, shop, "Rice", 0, unit="kg", reorder=5)
    sale(db, shop, NOW - timedelta(days=1), [(rice, 2, 60.0)])
    product(db, shop, "Jam", 2, reorder=5)
    secret = product(db, shop_b, "Zeta Secret Oil", 0, reorder=5)
    sale(db, shop_b, NOW - timedelta(days=1), [(secret, 1, 99.0)])
    db.close()

    r = client.get("/api/v1/insights/actionable", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    names = {i["product_name"] for i in body["insights"]}
    assert "Rice" in names and "Jam" in names and "Zeta Secret Oil" not in names
    assert body["insights"][0]["priority"] == "CRITICAL"
    assert body["counts_by_priority"]["CRITICAL"] == 1 and body["thresholds"]["lead_time_days"] == 3.0
    assert set(body["summary"]) >= {"today_sales", "out_of_stock_count", "highlights", "data_notes"}

    f = client.get("/api/v1/insights/actionable?priority=MEDIUM&category=LOW_STOCK", headers=h).json()
    assert f["total"] == 1 and f["insights"][0]["type"] == "below_minimum_stock"
    assert f["counts_by_priority"] == body["counts_by_priority"]  # counts are unfiltered
    t = client.get("/api/v1/insights/actionable?type=out_of_stock_with_demand", headers=h).json()
    assert [i["product_name"] for i in t["insights"]] == ["Rice"]
    page = client.get("/api/v1/insights/actionable?limit=1&offset=1", headers=h).json()
    assert len(page["insights"]) == 1 and page["insights"][0]["id"] == body["insights"][1]["id"]
    assert client.get("/api/v1/insights/actionable?priority=URGENT", headers=h).status_code == 422
    assert client.get("/api/v1/insights/actionable?limit=0", headers=h).status_code == 422

    b = client.get("/api/v1/insights/actionable", headers=hb).json()
    assert {i["product_name"] for i in b["insights"] if i["product_name"]} == {"Zeta Secret Oil"}

    assert client.get("/api/v1/insights/actionable", headers=member(shop, h, "MANAGER")).status_code == 200
    cashier = client.get("/api/v1/insights/actionable", headers=member(shop, h, "CASHIER"))
    assert cashier.status_code == 403
    assert client.get("/api/v1/insights/actionable").status_code == 401
