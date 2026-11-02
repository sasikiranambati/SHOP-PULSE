import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import unittest
from datetime import date, datetime, timedelta, timezone
from uuid import UUID
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app, init_db_schema
from db.session import Base
from db.models import Product, Sale, SaleItem, ShopOperatingStatus, StockoutEvent, ProductCategory
from api.deps import get_db


class TestPhase2BackendApis(unittest.TestCase):
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

    def create_shop_user(self, email: str, shop_name: str = "Test Kirana"):
        reg_res = self.client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
        self.assertEqual(reg_res.status_code, 201)
        login_res = self.client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
        self.assertEqual(login_res.status_code, 200)
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        shop_res = self.client.post(
            "/api/v1/shops",
            json={
                "shop_name": shop_name,
                "owner_name": "Retailer",
                "business_type": "Grocery/Kirana",
                "location": "Main Bazar",
            },
            headers=headers,
        )
        self.assertEqual(shop_res.status_code, 201)
        shop_id = shop_res.json()["id"]
        return {"headers": headers, "shop_id": shop_id, "email": email}

    # ==========================================
    # 1. Shop Operating-Status API Tests
    # ==========================================

    def test_01_record_and_get_shop_status(self):
        """Test recording shop operating status for a date and retrieving it."""
        user = self.create_shop_user("status_test1@example.com")
        headers = user["headers"]
        today = date.today().isoformat()

        # 1. Record closed day with reason
        payload = {
            "operating_date": today,
            "is_open": False,
            "closure_reason": "FESTIVAL",
            "notes": "Diwali holiday closure",
        }
        res = self.client.post("/api/v1/shop-status", json=payload, headers=headers)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["operating_date"], today)
        self.assertEqual(data["is_open"], False)
        self.assertEqual(data["closure_reason"], "FESTIVAL")
        self.assertEqual(data["notes"], "Diwali holiday closure")

        # 2. Retrieve status by date
        get_res = self.client.get(f"/api/v1/shop-status/date/{today}", headers=headers)
        self.assertEqual(get_res.status_code, 200)
        get_data = get_res.json()
        self.assertEqual(get_data["id"], data["id"])
        self.assertEqual(get_data["is_open"], False)

    def test_02_duplicate_operating_status_idempotent(self):
        """Test sending duplicate operating-status requests updates safely with 200 OK."""
        user = self.create_shop_user("status_dup@example.com")
        headers = user["headers"]
        test_date = (date.today() + timedelta(days=1)).isoformat()

        # First POST: Create
        res1 = self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": test_date, "is_open": True, "notes": "Initial open"},
            headers=headers,
        )
        self.assertEqual(res1.status_code, 201)
        status_id = res1.json()["id"]

        # Second POST with same date: Safe Idempotent Upsert (returns 200 OK)
        res2 = self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": test_date, "is_open": False, "closure_reason": "PERSONAL", "notes": "Updated to closed"},
            headers=headers,
        )
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["id"], status_id)
        self.assertEqual(res2.json()["is_open"], False)
        self.assertEqual(res2.json()["closure_reason"], "PERSONAL")

    def test_03_update_operating_status_endpoint(self):
        """Test PUT /api/v1/shop-status/date/{operating_date}."""
        user = self.create_shop_user("status_put@example.com")
        headers = user["headers"]
        test_date = (date.today() + timedelta(days=2)).isoformat()

        # 404 if date not recorded yet
        put_404 = self.client.put(
            f"/api/v1/shop-status/date/{test_date}",
            json={"is_open": False, "closure_reason": "EMERGENCY"},
            headers=headers,
        )
        self.assertEqual(put_404.status_code, 404)

        # Create record
        self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": test_date, "is_open": True},
            headers=headers,
        )

        # Update record
        put_res = self.client.put(
            f"/api/v1/shop-status/date/{test_date}",
            json={"is_open": False, "closure_reason": "EMERGENCY", "notes": "Plumbing repair"},
            headers=headers,
        )
        self.assertEqual(put_res.status_code, 200)
        self.assertEqual(put_res.json()["is_open"], False)
        self.assertEqual(put_res.json()["closure_reason"], "EMERGENCY")

    def test_04_operating_status_history_date_range(self):
        """Test retrieving operating status history over a date range."""
        user = self.create_shop_user("status_hist@example.com")
        headers = user["headers"]

        d1 = (date.today() - timedelta(days=3)).isoformat()
        d2 = (date.today() - timedelta(days=2)).isoformat()
        d3 = (date.today() - timedelta(days=1)).isoformat()

        self.client.post("/api/v1/shop-status", json={"operating_date": d1, "is_open": True}, headers=headers)
        self.client.post("/api/v1/shop-status", json={"operating_date": d2, "is_open": False, "closure_reason": "WEEKLY_OFF"}, headers=headers)
        self.client.post("/api/v1/shop-status", json={"operating_date": d3, "is_open": True}, headers=headers)

        # Query range d2 to d3
        range_res = self.client.get(f"/api/v1/shop-status?start_date={d2}&end_date={d3}", headers=headers)
        self.assertEqual(range_res.status_code, 200)
        data = range_res.json()
        self.assertEqual(data["total"], 2)
        dates = [item["operating_date"] for item in data["items"]]
        self.assertIn(d2, dates)
        self.assertIn(d3, dates)
        self.assertNotIn(d1, dates)

    def test_05_independent_calendars_for_multiple_shops(self):
        """Verify that multiple shops maintain strictly isolated operating calendars."""
        user1 = self.create_shop_user("shop1_cal@example.com", "Shop 1")
        user2 = self.create_shop_user("shop2_cal@example.com", "Shop 2")

        test_date = (date.today() + timedelta(days=5)).isoformat()

        # Shop 1 records CLOSED
        res1 = self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": test_date, "is_open": False, "closure_reason": "PERSONAL"},
            headers=user1["headers"],
        )
        self.assertEqual(res1.status_code, 201)

        # Shop 2 records OPEN for same date
        res2 = self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": test_date, "is_open": True},
            headers=user2["headers"],
        )
        self.assertEqual(res2.status_code, 201)

        # Verify Shop 1 sees CLOSED
        chk1 = self.client.get(f"/api/v1/shop-status/date/{test_date}", headers=user1["headers"])
        self.assertEqual(chk1.json()["is_open"], False)

        # Verify Shop 2 sees OPEN
        chk2 = self.client.get(f"/api/v1/shop-status/date/{test_date}", headers=user2["headers"])
        self.assertEqual(chk2.json()["is_open"], True)

    # ==========================================
    # 2. Product Category Normalization Tests
    # ==========================================

    def test_06_get_canonical_categories(self):
        """Test GET /api/v1/products/categories returns 12 master categories."""
        user = self.create_shop_user("cat_master@example.com")
        res = self.client.get("/api/v1/products/categories", headers=user["headers"])
        self.assertEqual(res.status_code, 200)
        categories = res.json()
        self.assertEqual(len(categories), 12)
        codes = [c["code"] for c in categories]
        self.assertIn("STAPLES", codes)
        self.assertIn("GRAINS_PULSES", codes)
        self.assertIn("DAIRY", codes)
        self.assertIn("EDIBLE_OILS", codes)

    def test_07_product_creation_category_normalization(self):
        """Test category normalization during product creation."""
        user = self.create_shop_user("prod_cat_test@example.com")
        headers = user["headers"]

        # Case A: Canonical category provided
        p1_res = self.client.post(
            "/api/v1/products",
            json={
                "name": "Amul Fresh Cream 250ml",
                "category": "Dairy",
                "selling_price": 65.0,
                "current_stock": 20,
            },
            headers=headers,
        )
        self.assertEqual(p1_res.status_code, 201)
        p1 = p1_res.json()
        self.assertEqual(p1["standardized_category"], "Dairy")
        self.assertEqual(p1["needs_category_review"], False)

        # Case B: Alias / Raw category provided ("Edible Oil" -> "Edible Oils")
        p2_res = self.client.post(
            "/api/v1/products",
            json={
                "name": "Fortune Sunflower Oil 1L",
                "category": "Edible Oil",
                "selling_price": 140.0,
                "current_stock": 15,
            },
            headers=headers,
        )
        self.assertEqual(p2_res.status_code, 201)
        p2 = p2_res.json()
        self.assertEqual(p2["standardized_category"], "Edible Oils")
        self.assertEqual(p2["raw_category"], "Edible Oil")
        self.assertEqual(p2["needs_category_review"], False)

        # Case C: Ambiguous or unknown category flagged for review ("Miscellaneous Unmapped" -> "Other")
        p3_res = self.client.post(
            "/api/v1/products",
            json={
                "name": "Special Handmade Craft XYZ",
                "category": "Miscellaneous Unmapped",
                "selling_price": 500.0,
                "current_stock": 5,
            },
            headers=headers,
        )
        self.assertEqual(p3_res.status_code, 201)
        p3 = p3_res.json()
        self.assertEqual(p3["standardized_category"], "Other")
        self.assertEqual(p3["raw_category"], "Miscellaneous Unmapped")
        self.assertEqual(p3["needs_category_review"], True)

    # ==========================================
    # 3. Sales Data Quality Tests
    # ==========================================

    def test_08_sales_duplicate_line_merging_and_cost_price(self):
        """Test cart line merging for duplicate product IDs and reliable cost_price_at_sale."""
        user = self.create_shop_user("sales_merge@example.com")
        headers = user["headers"]

        # Product with reliable purchase price
        p_res = self.client.post(
            "/api/v1/products",
            json={
                "name": "Tata Salt 1kg",
                "category": "Staples & Grains",
                "selling_price": 28.0,
                "purchase_price": 22.0,
                "current_stock": 50,
            },
            headers=headers,
        )
        pid = p_res.json()["id"]

        # Sale with repeated product ID in cart
        sale_res = self.client.post(
            "/api/v1/sales",
            json={
                "items": [
                    {"product_id": pid, "quantity": 3},
                    {"product_id": pid, "quantity": 2},
                ],
                "payment_method": "cash",
            },
            headers=headers,
        )
        self.assertEqual(sale_res.status_code, 201)
        sale_data = sale_res.json()

        # Should merge into 1 line item with quantity 5
        self.assertEqual(len(sale_data["items"]), 1)
        line = sale_data["items"][0]
        self.assertEqual(line["product_id"], pid)
        self.assertEqual(line["quantity"], 5)
        self.assertEqual(line["cost_price_at_sale"], 22.0)
        self.assertEqual(sale_data["total_amount"], 5 * 28.0)

        # Verify stock deducted from 50 to 45
        prod_chk = self.client.get(f"/api/v1/products/{pid}", headers=headers)
        self.assertEqual(prod_chk.json()["current_stock"], 45)

    def test_09_sales_quantity_validation(self):
        """Test rejection of zero/negative quantities and discrete unit constraints."""
        user = self.create_shop_user("sales_val@example.com")
        headers = user["headers"]

        # Discrete unit product: "pcs"
        p_discrete = self.client.post(
            "/api/v1/products",
            json={"name": "Soap Bar", "unit": "pcs", "selling_price": 35.0, "current_stock": 100},
            headers=headers,
        ).json()

        # Continuous unit product: "kg"
        p_continuous = self.client.post(
            "/api/v1/products",
            json={"name": "Loose Basmati Rice", "unit": "kg", "selling_price": 90.0, "current_stock": 100},
            headers=headers,
        ).json()

        # 1. Zero or negative quantity should fail Pydantic schema validation (422)
        res_zero = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_discrete["id"], "quantity": 0}]},
            headers=headers,
        )
        self.assertEqual(res_zero.status_code, 422)

        res_neg = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_discrete["id"], "quantity": -5}]},
            headers=headers,
        )
        self.assertEqual(res_neg.status_code, 422)

        # 2. Discrete unit with fractional quantity should fail business logic (400)
        res_frac_discrete = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_discrete["id"], "quantity": 1.5}]},
            headers=headers,
        )
        self.assertEqual(res_frac_discrete.status_code, 400)
        self.assertIn("whole-number quantity", res_frac_discrete.json()["detail"])

        # 3. Continuous unit with fractional quantity should succeed
        res_frac_cont = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_continuous["id"], "quantity": 2.5}]},
            headers=headers,
        )
        self.assertEqual(res_frac_cont.status_code, 201)
        self.assertEqual(res_frac_cont.json()["items"][0]["quantity"], 2.5)

    def test_10_bulk_quantity_threshold_confirmation(self):
        """Test large quantity protection threshold (>500) requires confirmation."""
        user = self.create_shop_user("sales_bulk@example.com")
        headers = user["headers"]

        p = self.client.post(
            "/api/v1/products",
            json={"name": "Matchbox Bundle", "selling_price": 5.0, "current_stock": 2000},
            headers=headers,
        ).json()

        # Quantity 600 without confirmation fails
        unconfirmed_res = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p["id"], "quantity": 600}]},
            headers=headers,
        )
        self.assertEqual(unconfirmed_res.status_code, 400)
        self.assertIn("Unusually large quantity", unconfirmed_res.json()["detail"])

        # Quantity 600 with confirmation succeeds
        confirmed_res = self.client.post(
            "/api/v1/sales",
            json={
                "items": [{"product_id": p["id"], "quantity": 600, "confirmed_large_quantity": True}],
                "payment_method": "cash",
            },
            headers=headers,
        )
        self.assertEqual(confirmed_res.status_code, 201)

    def test_11_closed_day_conflict_and_implicit_open(self):
        """Test that explicit shop closure blocks sales (409 Conflict), while unrecorded day marks shop open."""
        user = self.create_shop_user("sales_closed@example.com")
        headers = user["headers"]
        today = date.today().isoformat()

        p = self.client.post(
            "/api/v1/products",
            json={"name": "Milk Packet 500ml", "selling_price": 30.0, "current_stock": 20},
            headers=headers,
        ).json()

        # Explicitly mark shop as closed for today
        self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": today, "is_open": False, "closure_reason": "PERSONAL"},
            headers=headers,
        )

        # Attempting a sale should return 409 Conflict
        conflict_res = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p["id"], "quantity": 1}]},
            headers=headers,
        )
        self.assertEqual(conflict_res.status_code, 409)
        self.assertIn("explicitly marked as closed", conflict_res.json()["detail"])

        # Update status to open
        self.client.put(
            f"/api/v1/shop-status/date/{today}",
            json={"is_open": True},
            headers=headers,
        )

        # Now sale should succeed
        success_res = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p["id"], "quantity": 1}]},
            headers=headers,
        )
        self.assertEqual(success_res.status_code, 201)

    # ==========================================
    # 4. Sale Cancellation & Refund Safety Tests
    # ==========================================

    def test_12_sale_cancellation_and_inventory_restoration(self):
        """Test cancelling a sale atomically restores inventory exactly once (idempotent)."""
        user = self.create_shop_user("sale_cancel@example.com")
        headers = user["headers"]

        p = self.client.post(
            "/api/v1/products",
            json={"name": "Wheat Flour 10kg", "selling_price": 380.0, "current_stock": 20},
            headers=headers,
        ).json()
        pid = p["id"]

        # Complete sale of 5 bags (stock 20 -> 15)
        sale = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": pid, "quantity": 5}]},
            headers=headers,
        ).json()
        sale_id = sale["id"]

        chk_stock1 = self.client.get(f"/api/v1/products/{pid}", headers=headers).json()
        self.assertEqual(chk_stock1["current_stock"], 15)

        # Cancel sale
        cancel_res = self.client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Customer entered wrong phone number and aborted checkout"},
            headers=headers,
        )
        self.assertEqual(cancel_res.status_code, 200)
        c_data = cancel_res.json()
        self.assertEqual(c_data["status"], "CANCELLED")
        self.assertIsNotNone(c_data["cancelled_at"])
        self.assertEqual(c_data["cancellation_reason"], "Customer entered wrong phone number and aborted checkout")

        # Inventory must be restored: 15 -> 20
        chk_stock2 = self.client.get(f"/api/v1/products/{pid}", headers=headers).json()
        self.assertEqual(chk_stock2["current_stock"], 20)

        # Idempotency check: Cancel again must NOT restore inventory a second time
        cancel_res2 = self.client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Repeated cancel call"},
            headers=headers,
        )
        self.assertEqual(cancel_res2.status_code, 200)
        chk_stock3 = self.client.get(f"/api/v1/products/{pid}", headers=headers).json()
        self.assertEqual(chk_stock3["current_stock"], 20)  # Still 20!

    def test_13_sale_refund_with_and_without_restock(self):
        """Test sale refunding with optional inventory restoration."""
        user = self.create_shop_user("sale_refund@example.com")
        headers = user["headers"]

        p1 = self.client.post(
            "/api/v1/products",
            json={"name": "Packaged Biscuits", "selling_price": 20.0, "current_stock": 50},
            headers=headers,
        ).json()

        p2 = self.client.post(
            "/api/v1/products",
            json={"name": "Damaged Milk Pouch", "selling_price": 25.0, "current_stock": 50},
            headers=headers,
        ).json()

        # Sale 1: Returned in good condition (restock_items=True)
        sale1 = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p1["id"], "quantity": 10}]},
            headers=headers,
        ).json()

        # Stock is 40
        self.assertEqual(self.client.get(f"/api/v1/products/{p1['id']}", headers=headers).json()["current_stock"], 40)

        ref1 = self.client.post(
            f"/api/v1/sales/{sale1['id']}/refund",
            json={"reason": "Unopened return within 24h", "restock_items": True},
            headers=headers,
        )
        self.assertEqual(ref1.status_code, 200)
        self.assertEqual(ref1.json()["status"], "REFUNDED")
        # Stock restored back to 50
        self.assertEqual(self.client.get(f"/api/v1/products/{p1['id']}", headers=headers).json()["current_stock"], 50)

        # Sale 2: Damaged / Perishable return (restock_items=False)
        sale2 = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p2["id"], "quantity": 5}]},
            headers=headers,
        ).json()

        # Stock is 45
        self.assertEqual(self.client.get(f"/api/v1/products/{p2['id']}", headers=headers).json()["current_stock"], 45)

        ref2 = self.client.post(
            f"/api/v1/sales/{sale2['id']}/refund",
            json={"reason": "Leaking milk pouch - discarded", "restock_items": False},
            headers=headers,
        )
        self.assertEqual(ref2.status_code, 200)
        self.assertEqual(ref2.json()["status"], "REFUNDED")
        # Stock remains 45 (not restored)
        self.assertEqual(self.client.get(f"/api/v1/products/{p2['id']}", headers=headers).json()["current_stock"], 45)

    def test_14_unauthorized_cross_shop_mutation(self):
        """Test tenant boundary: Shop B cannot access, cancel or refund Shop A's sale."""
        shop_a = self.create_shop_user("owner_a@example.com", "Shop A")
        shop_b = self.create_shop_user("owner_b@example.com", "Shop B")

        # Shop A creates product and sale
        p = self.client.post(
            "/api/v1/products",
            json={"name": "Shop A Exclusive Product", "selling_price": 100.0, "current_stock": 10},
            headers=shop_a["headers"],
        ).json()

        sale = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p["id"], "quantity": 2}]},
            headers=shop_a["headers"],
        ).json()
        sale_id = sale["id"]

        # Shop B attempts to get sale
        get_res = self.client.get(f"/api/v1/sales/{sale_id}", headers=shop_b["headers"])
        self.assertEqual(get_res.status_code, 403)

        # Shop B attempts to cancel sale
        cancel_res = self.client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Malicious cancellation attempt"},
            headers=shop_b["headers"],
        )
        self.assertEqual(cancel_res.status_code, 403)

        # Shop B attempts to refund sale
        refund_res = self.client.post(
            f"/api/v1/sales/{sale_id}/refund",
            json={"reason": "Malicious refund attempt"},
            headers=shop_b["headers"],
        )
        self.assertEqual(refund_res.status_code, 403)

    # ==========================================
    # 5. Stockout Event Lifecycle Tests
    # ==========================================

    def test_15_stockout_event_lifecycle_with_sale_and_cancel(self):
        """Test that depleting inventory to 0 creates an active stockout event, and cancelling resolves it."""
        user = self.create_shop_user("stockout_lc@example.com")
        headers = user["headers"]
        shop_id = user["shop_id"]

        # Product with 5 in stock
        p = self.client.post(
            "/api/v1/products",
            json={"name": "Last Stock Item", "selling_price": 50.0, "current_stock": 5},
            headers=headers,
        ).json()
        pid_str = p["id"]
        pid_uuid = UUID(pid_str)

        # Sell all 5 units -> Stock reaches 0
        sale = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": pid_str, "quantity": 5}]},
            headers=headers,
        ).json()
        self.assertEqual(sale["status"], "COMPLETED")

        # Check DB for active stockout event
        db_events = self.db.query(StockoutEvent).filter(
            StockoutEvent.product_id == pid_uuid,
            StockoutEvent.ended_at.is_(None),
        ).all()
        self.assertEqual(len(db_events), 1)
        active_event = db_events[0]
        self.assertEqual(active_event.reason, "DEPLETED_BY_SALE")
        self.assertIsNone(active_event.ended_at)

        # Cancel sale -> Stock restored to 5 -> active stockout event closed
        self.client.post(
            f"/api/v1/sales/{sale['id']}/cancel",
            json={"reason": "Customer cancelled order"},
            headers=headers,
        )

        self.db.expire_all()
        active_events_after = self.db.query(StockoutEvent).filter(
            StockoutEvent.product_id == pid_uuid,
            StockoutEvent.ended_at.is_(None),
        ).all()
        self.assertEqual(len(active_events_after), 0)

        closed_event = self.db.query(StockoutEvent).filter(
            StockoutEvent.id == active_event.id
        ).first()
        self.assertIsNotNone(closed_event.ended_at)

    # ==========================================
    # 6. Existing POS & Purchase Regression Tests
    # ==========================================

    def test_16_existing_pos_checkout_flow(self):
        """Regression test: standard multi-item POS sales checkout and history retrieval."""
        user = self.create_shop_user("pos_reg@example.com")
        headers = user["headers"]

        # Create two products
        p1 = self.client.post(
            "/api/v1/products",
            json={"name": "Atta 5kg", "selling_price": 210.0, "current_stock": 30},
            headers=headers,
        ).json()

        p2 = self.client.post(
            "/api/v1/products",
            json={"name": "Sugar 1kg", "selling_price": 42.0, "current_stock": 50},
            headers=headers,
        ).json()

        # Checkout sale: 2 Atta, 3 Sugar
        sale_res = self.client.post(
            "/api/v1/sales",
            json={
                "items": [
                    {"product_id": p1["id"], "quantity": 2},
                    {"product_id": p2["id"], "quantity": 3},
                ],
                "payment_method": "upi",
            },
            headers=headers,
        )
        self.assertEqual(sale_res.status_code, 201)
        sale_data = sale_res.json()
        expected_total = (2 * 210.0) + (3 * 42.0)
        self.assertEqual(sale_data["total_amount"], expected_total)
        self.assertEqual(sale_data["payment_method"], "upi")
        self.assertEqual(sale_data["status"], "COMPLETED")
        self.assertIsNotNone(sale_data["created_at"])

        # Stock deduction verification
        self.assertEqual(self.client.get(f"/api/v1/products/{p1['id']}", headers=headers).json()["current_stock"], 28)
        self.assertEqual(self.client.get(f"/api/v1/products/{p2['id']}", headers=headers).json()["current_stock"], 47)

        # Sales list filter by status
        list_res = self.client.get("/api/v1/sales?status=COMPLETED", headers=headers)
        self.assertEqual(list_res.status_code, 200)
        self.assertEqual(list_res.json()["total"], 1)

    def test_17_purchase_restock_resolves_stockout(self):
        """Regression test: Receiving purchase stock resolves existing active stockout events."""
        user = self.create_shop_user("purch_restock@example.com")
        headers = user["headers"]

        # Create supplier
        sup = self.client.post(
            "/api/v1/suppliers",
            json={"supplier_name": "Agro Wholesaler", "phone": "9876543210"},
            headers=headers,
        ).json()

        # Create product with 0 stock (triggers initial stockout)
        p = self.client.post(
            "/api/v1/products",
            json={"name": "Depleted Pulses 1kg", "selling_price": 120.0, "current_stock": 0},
            headers=headers,
        ).json()
        pid_uuid = UUID(p["id"])

        # Active stockout event should exist
        active_before = self.db.query(StockoutEvent).filter(
            StockoutEvent.product_id == pid_uuid,
            StockoutEvent.ended_at.is_(None),
        ).all()
        self.assertEqual(len(active_before), 1)

        # Purchase order restock of 50 units
        purch_res = self.client.post(
            "/api/v1/purchases",
            json={
                "supplier_id": sup["id"],
                "items": [{"product_id": p["id"], "quantity": 50, "purchase_price": 95.0}],
            },
            headers=headers,
        )
        self.assertEqual(purch_res.status_code, 201)

        # Product stock should now be 50
        prod_chk = self.client.get(f"/api/v1/products/{p['id']}", headers=headers).json()
        self.assertEqual(prod_chk.current_stock if hasattr(prod_chk, "current_stock") else prod_chk["current_stock"], 50)

        # Active stockout event should now be resolved
        self.db.expire_all()
        active_after = self.db.query(StockoutEvent).filter(
            StockoutEvent.product_id == pid_uuid,
            StockoutEvent.ended_at.is_(None),
        ).all()
        self.assertEqual(len(active_after), 0)


if __name__ == "__main__":
    unittest.main()

