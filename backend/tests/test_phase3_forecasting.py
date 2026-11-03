import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import unittest
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app, init_db_schema
from db.session import Base
from db.models import (
    User,
    Shop,
    Product,
    Sale,
    SaleItem,
    ShopOperatingStatus,
    StockoutEvent,
)
from api.deps import get_db


class TestPhase3Forecasting(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        Base.metadata.create_all(bind=self.engine)
        init_db_schema(bind=self.engine)

        def override_get_db():
            db = self.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        self.db = self.TestingSessionLocal()

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)

    def register_user_and_shop(self, email: str, shop_name: str = "Forecasting Mart"):
        reg = self.client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
        self.assertEqual(reg.status_code, 201)
        login = self.client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
        self.assertEqual(login.status_code, 200)
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        shop_res = self.client.post(
            "/api/v1/shops",
            json={
                "shop_name": shop_name,
                "owner_name": "Kirana Owner",
                "business_type": "Grocery/Kirana",
                "location": "Central Market",
            },
            headers=headers,
        )
        self.assertEqual(shop_res.status_code, 201)
        return {"headers": headers, "shop_id": UUID(shop_res.json()["id"])}

    def create_product(self, headers: dict, name: str, stock: int = 50, reorder_level: int = 10, category: str = "Staples", unit: str = "pcs"):
        res = self.client.post(
            "/api/v1/products",
            json={
                "name": name,
                "category": category,
                "selling_price": 100.0,
                "purchase_price": 80.0,
                "current_stock": stock,
                "reorder_level": reorder_level,
                "unit": unit,
            },
            headers=headers,
        )
        self.assertEqual(res.status_code, 201)
        return res.json()

    def add_operating_status(self, shop_id: UUID, op_date: date, is_open: bool = True, reason: str = None):
        rec = ShopOperatingStatus(
            shop_id=shop_id,
            operating_date=op_date,
            is_open=is_open,
            closure_reason=reason,
            created_at=datetime.combine(op_date, datetime.min.time(), tzinfo=timezone.utc),
        )
        self.db.add(rec)
        self.db.commit()

    def add_completed_sale(self, shop_id: UUID, product_id: UUID, qty: float, sale_date: date, status: str = "COMPLETED"):
        sale_dt = datetime.combine(sale_date, datetime.min.time(), tzinfo=timezone.utc)
        sale = Sale(
            shop_id=shop_id,
            total_amount=qty * 100.0,
            payment_method="cash",
            status=status,
            created_at=sale_dt,
        )
        self.db.add(sale)
        self.db.flush()

        item = SaleItem(
            sale_id=sale.id,
            product_id=product_id,
            quantity=qty,
            unit_price=100.0,
            created_at=sale_dt,
        )
        self.db.add(item)
        self.db.commit()

    # =========================================================================
    # Test 1: No Sales History
    # =========================================================================
    def test_01_no_sales_history(self):
        """Product with zero sales history returns INSUFFICIENT_HISTORY with transparent reorder reference."""
        user = self.register_user_and_shop("fc01@test.com")
        p = self.create_product(user["headers"], "No Sales Item", stock=20, reorder_level=5)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=user["headers"])
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data["items"]), 1)
        fc = data["items"][0]

        self.assertEqual(fc["forecast_method"], "INSUFFICIENT_HISTORY")
        self.assertEqual(fc["confidence_status"], "INSUFFICIENT_DATA")
        self.assertIsNone(fc["average_daily_demand"])
        self.assertIsNone(fc["estimated_weekly_demand"])
        self.assertIsNone(fc["recommended_reorder_quantity"])
        self.assertEqual(fc["reorder_level"], 5)
        self.assertIn("insufficient history", fc["insights"].lower())
        self.assertIn("5 pcs", fc["insights"].lower())

    # =========================================================================
    # Test 2: Fewer Than 7 Valid Days
    # =========================================================================
    def test_02_fewer_than_7_valid_days(self):
        """Product with 5 valid selling days (< 7) remains in Stage 0 (INSUFFICIENT_HISTORY)."""
        user = self.register_user_and_shop("fc02@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Five Day Item", stock=15, reorder_level=5)
        pid = UUID(p["id"])

        # Backdate product created_at to 10 days ago
        base_date = date.today() - timedelta(days=10)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # Record 5 open days with sales
        for i in range(5):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=4.0, sale_date=d)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        self.assertEqual(fc["valid_history_days"], 5)
        self.assertEqual(fc["forecast_method"], "INSUFFICIENT_HISTORY")
        self.assertIsNone(fc["average_daily_demand"])
        self.assertIsNone(fc["recommended_reorder_quantity"])

    # =========================================================================
    # Test 3: Exactly 7 Valid Days (Stage 1 Moving Average)
    # =========================================================================
    def test_03_exactly_7_valid_days(self):
        """Product with exactly 7 valid open selling days enters Stage 1 (MOVING_AVERAGE_7)."""
        user = self.register_user_and_shop("fc03@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Seven Day Item", stock=30, reorder_level=15)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=10)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # Sales quantities: 10, 10, 10, 10, 10, 10, 10 -> Avg: 10.0, Weekly: 70.0
        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=10.0, sale_date=d)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        self.assertEqual(fc["valid_history_days"], 7)
        self.assertEqual(fc["forecast_method"], "MOVING_AVERAGE_7")
        self.assertEqual(fc["confidence_status"], "STAGE_1_MOVING_AVERAGE")
        self.assertEqual(fc["average_daily_demand"], 10.0)
        self.assertEqual(fc["estimated_weekly_demand"], 70.0)
        self.assertEqual(fc["days_until_stockout"], 3.0)  # stock 30 / 10 = 3.0
        self.assertEqual(fc["stockout_risk"], "HIGH")  # <= 3 days

    # =========================================================================
    # Test 4: 7–20 Valid Days
    # =========================================================================
    def test_04_seven_to_twenty_valid_days(self):
        """Product with 14 valid selling days uses latest 7 days for MOVING_AVERAGE_7."""
        user = self.register_user_and_shop("fc04@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Fourteen Day Item", stock=100, reorder_level=20)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=20)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # First 7 days: qty = 2
        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=2.0, sale_date=d)

        # Latest 7 days: qty = 6
        for i in range(7, 14):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=6.0, sale_date=d)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        self.assertEqual(fc["valid_history_days"], 14)
        self.assertEqual(fc["forecast_method"], "MOVING_AVERAGE_7")
        # Must use latest 7 days (qty=6), average = 6.0 (not (2*7 + 6*7)/14 = 4.0)
        self.assertEqual(fc["average_daily_demand"], 6.0)
        self.assertEqual(fc["estimated_weekly_demand"], 42.0)

    # =========================================================================
    # Test 5 & 6: 21+ Valid Days & Weekday Seasonal Forecasting (Stage 2)
    # =========================================================================
    def test_05_and_06_weekday_seasonal_forecasting(self):
        """Product with 28 valid days and >=3 observations per weekday generates WEEKDAY_SEASONAL forecast."""
        user = self.register_user_and_shop("fc0506@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Seasonal Item", stock=80, reorder_level=30)
        pid = UUID(p["id"])

        # 4 full weeks = 28 consecutive open days -> exactly 4 observations for each weekday (0 to 6)
        base_date = date.today() - timedelta(days=35)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # Weekdays have varying demand: e.g. Mon=5, Tue=5, Wed=5, Thu=5, Fri=10, Sat=15, Sun=20
        demand_by_weekday = {0: 5.0, 1: 5.0, 2: 5.0, 3: 5.0, 4: 10.0, 5: 15.0, 6: 20.0}
        for i in range(28):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            qty = demand_by_weekday[d.weekday()]
            self.add_completed_sale(shop_id, pid, qty=qty, sale_date=d)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        self.assertEqual(fc["valid_history_days"], 28)
        self.assertEqual(fc["forecast_method"], "WEEKDAY_SEASONAL")
        self.assertEqual(fc["confidence_status"], "STAGE_2_WEEKDAY_SEASONAL")
        # Weekly sum = 5+5+5+5+10+15+20 = 65.0
        self.assertEqual(fc["estimated_weekly_demand"], 65.0)
        self.assertEqual(fc["average_daily_demand"], round(65.0 / 7.0, 2))

    # =========================================================================
    # Test 7: Weekday Fallback to Moving Average
    # =========================================================================
    def test_07_weekday_fallback_when_weekday_history_insufficient(self):
        """21+ valid days but fewer than 3 observations for some weekdays falls back to MOVING_AVERAGE_7."""
        user = self.register_user_and_shop("fc07@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Fallback Item", stock=50, reorder_level=10)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=30)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # Create 21 observations, but only on Mondays, Tuesdays, and Wednesdays (weekdays 0, 1, 2)
        # Weekdays 3, 4, 5, 6 will have 0 observations (<3)
        valid_count = 0
        cur_d = base_date
        while valid_count < 21:
            if cur_d.weekday() in (0, 1, 2):
                self.add_operating_status(shop_id, cur_d, is_open=True)
                self.add_completed_sale(shop_id, pid, qty=8.0, sale_date=cur_d)
                valid_count += 1
            cur_d += timedelta(days=1)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        self.assertEqual(fc["valid_history_days"], 21)
        # Should gracefully fall back to MOVING_AVERAGE_7
        self.assertEqual(fc["forecast_method"], "MOVING_AVERAGE_7")
        self.assertEqual(fc["confidence_status"], "STAGE_1_MOVING_AVERAGE")
        self.assertEqual(fc["average_daily_demand"], 8.0)
        self.assertTrue(any("fell back" in w.lower() for w in fc["warnings"]))

    # =========================================================================
    # Test 8: Closed-Day Exclusion
    # =========================================================================
    def test_08_closed_day_exclusion(self):
        """Explicitly closed shop days are not treated as zero-demand days and not counted as valid days."""
        user = self.register_user_and_shop("fc08@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Closed Day Item", stock=40)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=12)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # 7 open days with qty=10
        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=10.0, sale_date=d)

        # 3 closed days (e.g. weekly off / holiday)
        for i in range(7, 10):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=False, reason="WEEKLY_OFF")

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        # Valid days must be 7 (closed days excluded)
        self.assertEqual(fc["valid_history_days"], 7)
        # Average demand must be 10.0 (not dragged down by closed days: (70 + 0)/10 = 7.0)
        self.assertEqual(fc["average_daily_demand"], 10.0)

    # =========================================================================
    # Test 9: Genuine Open Zero-Sales Days
    # =========================================================================
    def test_09_genuine_open_zero_sales_days(self):
        """Genuine open days with zero sales when stock is available ARE included with demand = 0."""
        user = self.register_user_and_shop("fc09@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Slow Moving Item", stock=50)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=10)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # 4 open days with qty=7, and 3 open days with qty=0 (no sales, but in stock)
        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            if i < 4:
                self.add_completed_sale(shop_id, pid, qty=7.0, sale_date=d)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        # Valid days must be 7 (4 sale days + 3 genuine zero-sale open days)
        self.assertEqual(fc["valid_history_days"], 7)
        # Total demand = 4 * 7 = 28; average = 28 / 7 = 4.0
        self.assertEqual(fc["average_daily_demand"], 4.0)

    # =========================================================================
    # Test 10: Unknown Operating-Status Days Excluded
    # =========================================================================
    def test_10_unknown_operating_status_days(self):
        """Calendar dates without any operating status record are excluded from valid days."""
        user = self.register_user_and_shop("fc10@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Unrecorded Days Item", stock=50)
        pid = UUID(p["id"])

        # Product created 15 days ago, but only 4 days have recorded status
        base_date = date.today() - timedelta(days=15)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # Record only 4 days
        for i in [1, 3, 5, 7]:
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=5.0, sale_date=d)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        # Only 4 valid days; unrecorded days between base_date and today are ignored
        self.assertEqual(fc["valid_history_days"], 4)
        self.assertEqual(fc["forecast_method"], "INSUFFICIENT_HISTORY")

    # =========================================================================
    # Test 11: Cancelled Sales Exclusion
    # =========================================================================
    def test_11_cancelled_sales_exclusion(self):
        """Sales with status CANCELLED are excluded from demand calculations."""
        user = self.register_user_and_shop("fc11@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Cancelled Test Item", stock=50)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=10)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # 7 open days: each day has 1 completed sale of 10, and 1 cancelled sale of 50
        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=10.0, sale_date=d, status="COMPLETED")
            self.add_completed_sale(shop_id, pid, qty=50.0, sale_date=d, status="CANCELLED")

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        # Average must be 10.0 (the 50.0 cancelled sales must be completely ignored)
        self.assertEqual(fc["average_daily_demand"], 10.0)

    # =========================================================================
    # Test 12: Refund Quantity Handling
    # =========================================================================
    def test_12_refund_quantity_handling(self):
        """Refunded sales have returned quantities excluded from true customer demand."""
        user = self.register_user_and_shop("fc12@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Refund Test Item", stock=50)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=10)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # 7 open days: completed sales of 5.0, plus refunded sales of 20.0
        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=5.0, sale_date=d, status="COMPLETED")
            self.add_completed_sale(shop_id, pid, qty=20.0, sale_date=d, status="REFUNDED")

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        # Demand must reflect only net completed sales (5.0 per day), not refunded ones
        self.assertEqual(fc["average_daily_demand"], 5.0)

    # =========================================================================
    # Test 13: Stockout-Censored Periods
    # =========================================================================
    def test_13_stockout_censored_periods(self):
        """Zero sales during active stockout events are excluded from valid days and flagged."""
        user = self.register_user_and_shop("fc13@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "Censored Stockout Item", stock=0)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=12)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # Days 0-6: Open with sales of 10 units
        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=10.0, sale_date=d)

        # Days 7-9: Open, but product was out of stock (StockoutEvent covering days 7-9)
        so_start = datetime.combine(base_date + timedelta(days=7), datetime.min.time(), tzinfo=timezone.utc)
        so_end = datetime.combine(base_date + timedelta(days=9), datetime.max.time(), tzinfo=timezone.utc)
        so_event = StockoutEvent(shop_id=shop_id, product_id=pid, started_at=so_start, ended_at=so_end, reason="DEPLETED_BY_SALE")
        self.db.add(so_event)
        self.db.commit()

        for i in range(7, 10):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            # 0 sales on these days because product was out of stock

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        # Valid days must be 7 (the 3 stockout days are censored and excluded from zero-demand calculation)
        self.assertEqual(fc["valid_history_days"], 7)
        self.assertEqual(fc["average_daily_demand"], 10.0)
        self.assertTrue(fc["has_stockout_censoring"])
        self.assertTrue(any("stockout-censored" in w.lower() for w in fc["warnings"]))

    # =========================================================================
    # Test 14: Products Created Recently
    # =========================================================================
    def test_14_products_created_recently(self):
        """Periods before a product was created are excluded, preventing artificial zero-demand penalties."""
        user = self.register_user_and_shop("fc14@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        # Shop has 30 days of operating history
        base_date = date.today() - timedelta(days=30)
        for i in range(30):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)

        # Product created only 3 days ago
        prod_create_date = date.today() - timedelta(days=3)
        p = self.create_product(headers, "Brand New Item", stock=20)
        pid = UUID(p["id"])
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(prod_create_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # Add 3 sales on the 3 days after creation
        for i in range(3):
            d = prod_create_date + timedelta(days=i)
            self.add_completed_sale(shop_id, pid, qty=4.0, sale_date=d)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        # Must have only 3 valid days (the prior 27 shop open days before product existed are excluded)
        self.assertEqual(fc["valid_history_days"], 3)
        self.assertEqual(fc["forecast_method"], "INSUFFICIENT_HISTORY")

    # =========================================================================
    # Test 15: Tenant Isolation
    # =========================================================================
    def test_15_tenant_isolation(self):
        """Shop B's forecast request never includes or leaks Shop A's products or sales."""
        user_a = self.register_user_and_shop("owner_a@test.com", "Shop A")
        user_b = self.register_user_and_shop("owner_b@test.com", "Shop B")

        pa = self.create_product(user_a["headers"], "Shop A Item", stock=50)
        pb = self.create_product(user_b["headers"], "Shop B Item", stock=30)

        # Query forecast as Shop B
        res_b = self.client.get("/api/v1/forecast", headers=user_b["headers"])
        self.assertEqual(res_b.status_code, 200)
        items_b = res_b.json()["items"]

        # Must only see Shop B Item
        self.assertEqual(len(items_b), 1)
        self.assertEqual(items_b[0]["product_id"], pb["id"])
        self.assertEqual(items_b[0]["product_name"], "Shop B Item")

        # Shop B querying Shop A product explicitly returns empty items list
        res_cross = self.client.get(f"/api/v1/forecast?product_id={pa['id']}", headers=user_b["headers"])
        self.assertEqual(res_cross.status_code, 200)
        self.assertEqual(len(res_cross.json()["items"]), 0)

    # =========================================================================
    # Test 16: Products with No Reorder Level
    # =========================================================================
    def test_16_products_with_no_reorder_level(self):
        """Products without a configured reorder level are processed cleanly and flagged with a warning."""
        user = self.register_user_and_shop("fc16@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        p = self.create_product(headers, "No Reorder Level Item", stock=40, reorder_level=None)
        pid = UUID(p["id"])

        base_date = date.today() - timedelta(days=10)
        prod_db = self.db.query(Product).filter(Product.id == pid).first()
        prod_db.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        prod_db.reorder_level = None
        self.db.commit()

        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid, qty=5.0, sale_date=d)

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        self.assertIsNone(fc["reorder_level"])
        self.assertEqual(fc["average_daily_demand"], 5.0)
        self.assertTrue(any("no reorder level" in w.lower() for w in fc["warnings"]))

    # =========================================================================
    # Test 17: Insufficient History Response
    # =========================================================================
    def test_17_insufficient_history_response(self):
        """Stage 0 response explicitly explains unavailability and does not generate arbitrary numbers."""
        user = self.register_user_and_shop("fc17@test.com")
        headers = user["headers"]

        p = self.create_product(headers, "New Arrival Milk", stock=12, reorder_level=6, unit="pack")

        res = self.client.get(f"/api/v1/forecast?product_id={p['id']}", headers=headers)
        self.assertEqual(res.status_code, 200)
        fc = res.json()["items"][0]

        self.assertEqual(fc["forecast_method"], "INSUFFICIENT_HISTORY")
        self.assertIsNone(fc["average_daily_demand"])
        self.assertIsNone(fc["estimated_weekly_demand"])
        self.assertIsNone(fc["recommended_reorder_quantity"])
        self.assertIn("insufficient", fc["insights"].lower())
        self.assertIn("6 pack", fc["insights"].lower())

    # =========================================================================
    # Test 18: Forecast API Authentication
    # =========================================================================
    def test_18_forecast_api_authentication(self):
        """Unauthenticated requests return 401; users without a shop profile return 400."""
        # 1. No token -> 401
        res_no_auth = self.client.get("/api/v1/forecast")
        self.assertEqual(res_no_auth.status_code, 401)

        # 2. User without a shop profile -> 400
        self.client.post("/api/v1/auth/register", json={"email": "noshop@test.com", "password": "password123"})
        login = self.client.post("/api/v1/auth/login", json={"email": "noshop@test.com", "password": "password123"})
        token = login.json()["access_token"]
        res_noshop = self.client.get("/api/v1/forecast", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(res_noshop.status_code, 400)
        self.assertIn("shop profile", res_noshop.json()["detail"].lower())

    # =========================================================================
    # Test 19: Forecast API Filtering
    # =========================================================================
    def test_19_forecast_api_filtering(self):
        """Forecast API supports filtering by product_id and standardized_category."""
        user = self.register_user_and_shop("fc19@test.com")
        headers = user["headers"]

        p_dairy = self.create_product(headers, "Amul Butter", category="Dairy")
        p_staple = self.create_product(headers, "Basmati Rice", category="Staples")

        # 1. Filter by product_id
        res_p = self.client.get(f"/api/v1/forecast?product_id={p_dairy['id']}", headers=headers)
        self.assertEqual(res_p.status_code, 200)
        items_p = res_p.json()["items"]
        self.assertEqual(len(items_p), 1)
        self.assertEqual(items_p[0]["product_id"], p_dairy["id"])

        # 2. Filter by category
        res_cat = self.client.get("/api/v1/forecast?standardized_category=Staples", headers=headers)
        self.assertEqual(res_cat.status_code, 200)
        items_cat = res_cat.json()["items"]
        self.assertEqual(len(items_cat), 1)
        self.assertEqual(items_cat[0]["product_id"], p_staple["id"])

    # =========================================================================
    # Test 20: Correct Stockout Horizon Calculations
    # =========================================================================
    def test_20_correct_stockout_horizon_calculations(self):
        """Days until stockout accurately reflects current_stock / average_daily_demand with correct risk tiers."""
        user = self.register_user_and_shop("fc20@test.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        # Product A: High Risk (stock = 15, avg demand = 10 -> 1.5 days <= 3.0)
        pa = self.create_product(headers, "High Risk Item", stock=15, reorder_level=20)
        pid_a = UUID(pa["id"])

        # Product B: Medium Risk (stock = 50, avg demand = 10 -> 5.0 days <= 7.0)
        pb = self.create_product(headers, "Medium Risk Item", stock=50, reorder_level=20)
        pid_b = UUID(pb["id"])

        # Product C: Low Risk (stock = 120, avg demand = 10 -> 12.0 days > 7.0)
        pc = self.create_product(headers, "Low Risk Item", stock=120, reorder_level=20)
        pid_c = UUID(pc["id"])

        # Product D: Out of Stock (stock = 0)
        pd = self.create_product(headers, "Out Of Stock Item", stock=0, reorder_level=20)
        pid_d = UUID(pd["id"])

        base_date = date.today() - timedelta(days=10)
        for p_id in (pid_a, pid_b, pid_c, pid_d):
            p_rec = self.db.query(Product).filter(Product.id == p_id).first()
            p_rec.created_at = datetime.combine(base_date, datetime.min.time(), tzinfo=timezone.utc)
        self.db.commit()

        # Add 7 open days with demand = 10 for products A, B, C
        for i in range(7):
            d = base_date + timedelta(days=i)
            self.add_operating_status(shop_id, d, is_open=True)
            self.add_completed_sale(shop_id, pid_a, qty=10.0, sale_date=d)
            self.add_completed_sale(shop_id, pid_b, qty=10.0, sale_date=d)
            self.add_completed_sale(shop_id, pid_c, qty=10.0, sale_date=d)

        res = self.client.get("/api/v1/forecast", headers=headers)
        self.assertEqual(res.status_code, 200)
        items_map = {item["product_name"]: item for item in res.json()["items"]}

        # Product A: 15 / 10 = 1.5 days -> HIGH
        self.assertEqual(items_map["High Risk Item"]["days_until_stockout"], 1.5)
        self.assertEqual(items_map["High Risk Item"]["stockout_risk"], "HIGH")
        # Recommended reorder: ceil(70 - 15) = 55
        self.assertEqual(items_map["High Risk Item"]["recommended_reorder_quantity"], 55)

        # Product B: 50 / 10 = 5.0 days -> MEDIUM
        self.assertEqual(items_map["Medium Risk Item"]["days_until_stockout"], 5.0)
        self.assertEqual(items_map["Medium Risk Item"]["stockout_risk"], "MEDIUM")

        # Product C: 120 / 10 = 12.0 days -> LOW
        self.assertEqual(items_map["Low Risk Item"]["days_until_stockout"], 12.0)
        self.assertEqual(items_map["Low Risk Item"]["stockout_risk"], "LOW")
        self.assertEqual(items_map["Low Risk Item"]["recommended_reorder_quantity"], 0)

        # Product D: Stock 0 -> OUT_OF_STOCK
        self.assertEqual(items_map["Out Of Stock Item"]["days_until_stockout"], 0.0)
        self.assertEqual(items_map["Out Of Stock Item"]["stockout_risk"], "OUT_OF_STOCK")


if __name__ == "__main__":
    unittest.main()
