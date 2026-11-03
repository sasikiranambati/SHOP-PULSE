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
    ProductCategory,
)
from api.deps import get_db


class TestAutomatedWorkflows(unittest.TestCase):
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

    def register_and_login(self, email: str, password: str = "password123"):
        reg_res = self.client.post("/api/v1/auth/register", json={"email": email, "password": password})
        self.assertEqual(reg_res.status_code, 201)
        login_res = self.client.post("/api/v1/auth/login", json={"email": email, "password": password})
        self.assertEqual(login_res.status_code, 200)
        token = login_res.json()["access_token"]
        return {"headers": {"Authorization": f"Bearer {token}"}, "user_id": reg_res.json()["id"]}

    def create_shop_for_user(self, headers: dict, shop_name: str = "Standard Kirana"):
        res = self.client.post(
            "/api/v1/shops",
            json={
                "shop_name": shop_name,
                "owner_name": "Store Manager",
                "business_type": "Grocery/Kirana",
                "location": "Market Yard",
            },
            headers=headers,
        )
        self.assertEqual(res.status_code, 201)
        return res.json()

    # =========================================================================
    # WORKFLOW 1: User Registration and Login
    # =========================================================================

    def test_wf01_register_and_login_scenarios(self):
        """Test registration, duplicate email, invalid email, and login credentials."""
        # 1. Valid registration
        reg = self.client.post("/api/v1/auth/register", json={"email": "wf01_user@test.com", "password": "securepassword"})
        self.assertEqual(reg.status_code, 201)
        u = reg.json()
        self.assertEqual(u["email"], "wf01_user@test.com")
        self.assertTrue(u["is_active"])
        self.assertIn("id", u)

        # 2. Duplicate registration rejected
        dup = self.client.post("/api/v1/auth/register", json={"email": "wf01_user@test.com", "password": "anotherpassword"})
        self.assertEqual(dup.status_code, 400)
        self.assertIn("already exists", dup.json()["detail"].lower())

        # 3. Invalid email format rejected
        inv = self.client.post("/api/v1/auth/register", json={"email": "notanemail", "password": "password123"})
        self.assertEqual(inv.status_code, 422)

        # 4. Valid login returns bearer token
        login = self.client.post("/api/v1/auth/login", json={"email": "wf01_user@test.com", "password": "securepassword"})
        self.assertEqual(login.status_code, 200)
        token_data = login.json()
        self.assertIn("access_token", token_data)
        self.assertEqual(token_data["token_type"].lower(), "bearer")

        # 5. Invalid password rejected
        bad_pw = self.client.post("/api/v1/auth/login", json={"email": "wf01_user@test.com", "password": "wrongpassword"})
        self.assertEqual(bad_pw.status_code, 401)

        # 6. Nonexistent user login rejected
        no_user = self.client.post("/api/v1/auth/login", json={"email": "ghost@test.com", "password": "password123"})
        self.assertEqual(no_user.status_code, 401)

    # =========================================================================
    # WORKFLOW 2: Authenticated Profile Access
    # =========================================================================

    def test_wf02_authenticated_profile_access(self):
        """Test accessing user profile with and without valid JWT."""
        user = self.register_and_login("wf02_profile@test.com")
        headers = user["headers"]

        # Valid token access
        prof_res = self.client.get("/api/v1/auth/profile", headers=headers)
        self.assertEqual(prof_res.status_code, 200)
        p_data = prof_res.json()
        self.assertEqual(p_data["email"], "wf02_profile@test.com")
        self.assertEqual(p_data["id"], user["user_id"])

        # Unauthenticated access rejected
        no_auth = self.client.get("/api/v1/auth/profile")
        self.assertEqual(no_auth.status_code, 401)

        # Invalid token rejected
        bad_auth = self.client.get("/api/v1/auth/profile", headers={"Authorization": "Bearer invalid.token.value"})
        self.assertEqual(bad_auth.status_code, 401)

    # =========================================================================
    # WORKFLOW 3: Shop Creation and Retrieval
    # =========================================================================

    def test_wf03_shop_lifecycle(self):
        """Test shop profile creation, duplicate restriction, retrieval, and updates."""
        user = self.register_and_login("wf03_shop@test.com")
        headers = user["headers"]

        # 1. Access before shop creation -> 404
        get_before = self.client.get("/api/v1/shops/me", headers=headers)
        self.assertEqual(get_before.status_code, 404)

        # 2. Create shop
        shop = self.create_shop_for_user(headers, "Sunrise Grocers")
        shop_id = shop["id"]
        self.assertEqual(shop["shop_name"], "Sunrise Grocers")

        # 3. Duplicate shop creation by same owner -> 400
        dup_shop = self.client.post(
            "/api/v1/shops",
            json={"shop_name": "Second Shop", "owner_name": "Owner", "business_type": "Grocery/Kirana", "location": "City"},
            headers=headers,
        )
        self.assertEqual(dup_shop.status_code, 400)
        self.assertIn("already has a shop", dup_shop.json()["detail"].lower())

        # 4. Get current user's shop profile
        get_me = self.client.get("/api/v1/shops/me", headers=headers)
        self.assertEqual(get_me.status_code, 200)
        self.assertEqual(get_me.json()["id"], shop_id)

        # 5. Update shop profile
        put_res = self.client.put(
            f"/api/v1/shops/{shop_id}",
            json={"shop_name": "Sunrise Supermart", "location": "Prime Street"},
            headers=headers,
        )
        self.assertEqual(put_res.status_code, 200)
        self.assertEqual(put_res.json()["shop_name"], "Sunrise Supermart")
        self.assertEqual(put_res.json()["location"], "Prime Street")

    # =========================================================================
    # WORKFLOW 4: Shop Operating Status Creation, Update and History
    # =========================================================================

    def test_wf04_shop_operating_status_lifecycle(self):
        """Test creating, idempotently upserting, updating, and querying operating status history."""
        user = self.register_and_login("wf04_status@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Status Kirana")

        today = date.today().isoformat()
        tomorrow = (date.today() + timedelta(days=1)).isoformat()

        # 1. 404 for unrecorded date
        chk_unrec = self.client.get(f"/api/v1/shop-status/date/{today}", headers=headers)
        self.assertEqual(chk_unrec.status_code, 404)

        # 2. Record status for today as closed
        create_res = self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": today, "is_open": False, "closure_reason": "PERSONAL", "notes": "Family Function"},
            headers=headers,
        )
        self.assertEqual(create_res.status_code, 201)
        rec_id = create_res.json()["id"]

        # 3. Duplicate POST for same date safely upserts (200 OK)
        upsert_res = self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": today, "is_open": True, "notes": "Reopened in evening"},
            headers=headers,
        )
        self.assertEqual(upsert_res.status_code, 200)
        self.assertEqual(upsert_res.json()["id"], rec_id)
        self.assertTrue(upsert_res.json()["is_open"])

        # 4. PUT update on existing date
        put_res = self.client.put(
            f"/api/v1/shop-status/date/{today}",
            json={"is_open": False, "closure_reason": "EMERGENCY"},
            headers=headers,
        )
        self.assertEqual(put_res.status_code, 200)
        self.assertFalse(put_res.json()["is_open"])
        self.assertEqual(put_res.json()["closure_reason"], "EMERGENCY")

        # 5. Record second date (tomorrow)
        self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": tomorrow, "is_open": True},
            headers=headers,
        )

        # 6. Retrieve history over date range
        hist_res = self.client.get(f"/api/v1/shop-status?start_date={today}&end_date={tomorrow}", headers=headers)
        self.assertEqual(hist_res.status_code, 200)
        items = hist_res.json()["items"]
        self.assertEqual(len(items), 2)
        rec_dates = [i["operating_date"] for i in items]
        self.assertIn(today, rec_dates)
        self.assertIn(tomorrow, rec_dates)

    # =========================================================================
    # WORKFLOW 5 & 6: Closed Shop Must Reject a Sale, Reopening Must Allow Sales
    # =========================================================================

    def test_wf05_and_wf06_closed_and_reopened_shop_sales(self):
        """Test that explicit shop closure blocks POS sales (409 Conflict) and reopening enables them."""
        user = self.register_and_login("wf0506_closed_open@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Daily Mart")

        p = self.client.post(
            "/api/v1/products",
            json={"name": "Aashirvaad Atta 5kg", "selling_price": 240.0, "current_stock": 20},
            headers=headers,
        ).json()
        pid = p["id"]

        today = date.today().isoformat()

        # Mark shop explicitly as CLOSED
        self.client.post(
            "/api/v1/shop-status",
            json={"operating_date": today, "is_open": False, "closure_reason": "WEEKLY_OFF"},
            headers=headers,
        )

        # Workflow 5: Sale must be rejected with HTTP 409 Conflict
        sale_blocked = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": pid, "quantity": 2}]},
            headers=headers,
        )
        self.assertEqual(sale_blocked.status_code, 409)
        self.assertIn("explicitly marked as closed", sale_blocked.json()["detail"].lower())

        # Verify DB state: No sale recorded, product stock remains unchanged
        prod_chk = self.client.get(f"/api/v1/products/{pid}", headers=headers).json()
        self.assertEqual(prod_chk["current_stock"], 20)
        sales_count = self.client.get("/api/v1/sales", headers=headers).json()["total"]
        self.assertEqual(sales_count, 0)

        # Workflow 6: Reopen shop
        reopen_res = self.client.put(
            f"/api/v1/shop-status/date/{today}",
            json={"is_open": True, "notes": "Special festival opening"},
            headers=headers,
        )
        self.assertEqual(reopen_res.status_code, 200)
        self.assertTrue(reopen_res.json()["is_open"])

        # Attempting sale now must succeed
        sale_ok = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": pid, "quantity": 2}], "payment_method": "cash"},
            headers=headers,
        )
        self.assertEqual(sale_ok.status_code, 201)
        self.assertEqual(sale_ok.json()["status"], "COMPLETED")
        self.assertEqual(sale_ok.json()["total_amount"], 480.0)

        # Verify stock deducted in DB
        prod_after = self.client.get(f"/api/v1/products/{pid}", headers=headers).json()
        self.assertEqual(prod_after["current_stock"], 18)

    # =========================================================================
    # WORKFLOW 7: Product Creation and Listing
    # =========================================================================

    def test_wf07_product_creation_and_listing(self):
        """Test product creation, retrieval, search, category filter, and low-stock view."""
        user = self.register_and_login("wf07_products@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Product Mart")

        # Create products
        p1 = self.client.post(
            "/api/v1/products",
            json={"name": "Dettol Soap 100g", "category": "Personal Care", "selling_price": 40.0, "current_stock": 50, "reorder_level": 10},
            headers=headers,
        ).json()

        p2 = self.client.post(
            "/api/v1/products",
            json={"name": "Lifebuoy Soap 125g", "category": "Personal Care", "selling_price": 35.0, "current_stock": 4, "reorder_level": 10},
            headers=headers,
        ).json()

        p3 = self.client.post(
            "/api/v1/products",
            json={"name": "Tata Tea Gold 500g", "category": "Beverages", "selling_price": 320.0, "current_stock": 15, "reorder_level": 5},
            headers=headers,
        ).json()

        # 1. List all products
        list_all = self.client.get("/api/v1/products", headers=headers).json()
        self.assertEqual(list_all["total"], 3)

        # 2. Filter by search name
        search_res = self.client.get("/api/v1/products?search=Soap", headers=headers).json()
        self.assertEqual(search_res["total"], 2)

        # 3. Filter by category
        cat_res = self.client.get("/api/v1/products?category=Beverages", headers=headers).json()
        self.assertEqual(cat_res["total"], 1)
        self.assertEqual(cat_res["items"][0]["name"], "Tata Tea Gold 500g")

        # 4. Low stock products (stock <= reorder_level: Lifebuoy Soap stock 4 <= 10)
        low_res = self.client.get("/api/v1/products/low-stock", headers=headers).json()
        self.assertEqual(low_res["total"], 1)
        self.assertEqual(low_res["items"][0]["id"], p2["id"])

        # 5. Get product details by ID
        get_p = self.client.get(f"/api/v1/products/{p1['id']}", headers=headers)
        self.assertEqual(get_p.status_code, 200)
        self.assertEqual(get_p.json()["name"], "Dettol Soap 100g")

    # =========================================================================
    # WORKFLOW 8: Product Category Normalization and Category Review Flags
    # =========================================================================

    def test_wf08_product_category_normalization(self):
        """Test canonical category taxonomy master and non-destructive normalization."""
        user = self.register_and_login("wf08_categories@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Taxonomy Mart")

        # 1. Canonical categories master endpoint
        cat_master = self.client.get("/api/v1/products/categories", headers=headers)
        self.assertEqual(cat_master.status_code, 200)
        cats = cat_master.json()
        self.assertEqual(len(cats), 12)
        codes = [c["code"] for c in cats]
        self.assertIn("STAPLES", codes)
        self.assertIn("GRAINS_PULSES", codes)
        self.assertIn("DAIRY", codes)
        self.assertIn("EDIBLE_OILS", codes)

        # 2. Canonical category input (e.g. "Dairy")
        p_canon = self.client.post(
            "/api/v1/products",
            json={"name": "Amul Milk 1L", "category": "Dairy", "selling_price": 60.0, "current_stock": 20},
            headers=headers,
        ).json()
        self.assertEqual(p_canon["standardized_category"], "Dairy")
        self.assertFalse(p_canon["needs_category_review"])

        # 3. Alias category input (e.g. "Edible Oil" -> "Edible Oils")
        p_alias = self.client.post(
            "/api/v1/products",
            json={"name": "Dhara Mustard Oil 1L", "category": "Edible Oil", "selling_price": 160.0, "current_stock": 10},
            headers=headers,
        ).json()
        self.assertEqual(p_alias["standardized_category"], "Edible Oils")
        self.assertEqual(p_alias["raw_category"], "Edible Oil")
        self.assertFalse(p_alias["needs_category_review"])

        # 4. Ambiguous category input (e.g. "Handmade Kirana Item" -> "Other", flagged for review)
        p_ambig = self.client.post(
            "/api/v1/products",
            json={"name": "Handmade Clay Lamp", "category": "Festive Crafts", "selling_price": 25.0, "current_stock": 50},
            headers=headers,
        ).json()
        self.assertEqual(p_ambig["standardized_category"], "Other")
        self.assertEqual(p_ambig["raw_category"], "Festive Crafts")
        self.assertTrue(p_ambig["needs_category_review"])

        # 5. Updating category to a canonical one resolves needs_category_review flag
        p_updated = self.client.put(
            f"/api/v1/products/{p_ambig['id']}",
            json={"standardized_category": "Other", "needs_category_review": False},
            headers=headers,
        ).json()
        self.assertFalse(p_updated["needs_category_review"])

    # =========================================================================
    # WORKFLOW 9: Valid Sale Creation and Total Calculation
    # =========================================================================

    def test_wf09_valid_sale_creation_and_calculation(self):
        """Test multi-item sale creation, total calculations, cart merging, UTC timestamp, and cost price capture."""
        user = self.register_and_login("wf09_sales@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Sales Quality Mart")

        p1 = self.client.post(
            "/api/v1/products",
            json={"name": "Basmati Rice 1kg", "selling_price": 110.0, "purchase_price": 85.0, "current_stock": 50},
            headers=headers,
        ).json()

        p2 = self.client.post(
            "/api/v1/products",
            json={"name": "Chana Dal 500g", "selling_price": 55.0, "purchase_price": 42.0, "current_stock": 40},
            headers=headers,
        ).json()

        # Cart contains multiple items, plus duplicate entries of p1 that should be merged
        sale_res = self.client.post(
            "/api/v1/sales",
            json={
                "items": [
                    {"product_id": p1["id"], "quantity": 2},
                    {"product_id": p2["id"], "quantity": 3},
                    {"product_id": p1["id"], "quantity": 1},  # Duplicate p1 in cart
                ],
                "payment_method": "upi",
            },
            headers=headers,
        )
        self.assertEqual(sale_res.status_code, 201)
        data = sale_res.json()

        # Merged cart should have 2 unique items: p1 (qty 3), p2 (qty 3)
        self.assertEqual(len(data["items"]), 2)
        p1_line = next(i for i in data["items"] if i["product_id"] == p1["id"])
        p2_line = next(i for i in data["items"] if i["product_id"] == p2["id"])

        self.assertEqual(p1_line["quantity"], 3)
        self.assertEqual(p1_line["cost_price_at_sale"], 85.0)

        self.assertEqual(p2_line["quantity"], 3)
        self.assertEqual(p2_line["cost_price_at_sale"], 42.0)

        expected_total = (3 * 110.0) + (3 * 55.0)  # 330 + 165 = 495.0
        self.assertEqual(data["total_amount"], expected_total)
        self.assertEqual(data["status"], "COMPLETED")
        self.assertIsNotNone(data["created_at"])

    # =========================================================================
    # WORKFLOW 10: Inventory Stock Deduction After a Sale
    # =========================================================================

    def test_wf10_inventory_deduction(self):
        """Test atomic stock deduction across single and multiple items in a checkout."""
        user = self.register_and_login("wf10_deduct@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Inventory Mart")

        p = self.client.post(
            "/api/v1/products",
            json={"name": "Wheat Bran 1kg", "selling_price": 50.0, "current_stock": 35},
            headers=headers,
        ).json()
        pid = p["id"]

        # Sell 7 units
        self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": pid, "quantity": 7}]},
            headers=headers,
        )

        # Check API response
        prod_api = self.client.get(f"/api/v1/products/{pid}", headers=headers).json()
        self.assertEqual(prod_api["current_stock"], 28)

        # Check DB directly
        prod_db = self.db.query(Product).filter(Product.id == UUID(pid)).first()
        self.assertEqual(prod_db.current_stock, 28)

    # =========================================================================
    # WORKFLOW 11: Invalid Quantities and Invalid Product IDs
    # =========================================================================

    def test_wf11_invalid_quantities_and_product_ids(self):
        """Test rejection of zero, negative, discrete fractional, unconfirmed bulk quantities, and bad IDs."""
        user = self.register_and_login("wf11_validation@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Validation Mart")

        # Discrete unit product
        p_pcs = self.client.post(
            "/api/v1/products",
            json={"name": "Toothbrush", "unit": "pcs", "selling_price": 30.0, "current_stock": 100},
            headers=headers,
        ).json()

        # 1. Zero quantity rejected (422)
        res_zero = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_pcs["id"], "quantity": 0}]},
            headers=headers,
        )
        self.assertEqual(res_zero.status_code, 422)

        # 2. Negative quantity rejected (422)
        res_neg = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_pcs["id"], "quantity": -3}]},
            headers=headers,
        )
        self.assertEqual(res_neg.status_code, 422)

        # 3. Fractional quantity on discrete unit rejected (400)
        res_frac = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_pcs["id"], "quantity": 2.5}]},
            headers=headers,
        )
        self.assertEqual(res_frac.status_code, 400)
        self.assertIn("whole-number quantity", res_frac.json()["detail"].lower())

        # 4. Unconfirmed large quantity (> 500) rejected (400)
        res_bulk = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_pcs["id"], "quantity": 600}]},
            headers=headers,
        )
        self.assertEqual(res_bulk.status_code, 400)
        self.assertIn("unusually large quantity", res_bulk.json()["detail"].lower())

        # 5. Quantity exceeding stock rejected (400)
        res_over = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p_pcs["id"], "quantity": 105}]},
            headers=headers,
        )
        self.assertEqual(res_over.status_code, 400)
        self.assertIn("insufficient stock", res_over.json()["detail"].lower())

        # 6. Nonexistent product ID rejected (400)
        fake_id = str(uuid4())
        res_fake = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": fake_id, "quantity": 1}]},
            headers=headers,
        )
        self.assertEqual(res_fake.status_code, 400)
        self.assertIn("not found", res_fake.json()["detail"].lower())

    # =========================================================================
    # WORKFLOW 12 & 13: Sale Cancellation and Stock Restoration (Idempotent)
    # =========================================================================

    def test_wf12_and_wf13_cancellation_and_idempotency(self):
        """Test sale cancellation atomically restores stock, and repeated calls do not double-restore."""
        user = self.register_and_login("wf1213_cancel@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Cancel Mart")

        p = self.client.post(
            "/api/v1/products",
            json={"name": "Premium Tea 250g", "selling_price": 95.0, "current_stock": 20},
            headers=headers,
        ).json()
        pid = p["id"]

        # Sale: 5 units (stock drops from 20 -> 15)
        sale = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": pid, "quantity": 5}]},
            headers=headers,
        ).json()
        sale_id = sale["id"]

        self.assertEqual(self.client.get(f"/api/v1/products/{pid}", headers=headers).json()["current_stock"], 15)

        # Workflow 12: Cancel sale
        cancel_res = self.client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Customer changed mind at billing counter"},
            headers=headers,
        )
        self.assertEqual(cancel_res.status_code, 200)
        c_data = cancel_res.json()
        self.assertEqual(c_data["status"], "CANCELLED")
        self.assertIsNotNone(c_data["cancelled_at"])
        self.assertEqual(c_data["cancellation_reason"], "Customer changed mind at billing counter")

        # Verify stock restored back to 20
        self.assertEqual(self.client.get(f"/api/v1/products/{pid}", headers=headers).json()["current_stock"], 20)
        prod_db = self.db.query(Product).filter(Product.id == UUID(pid)).first()
        self.assertEqual(prod_db.current_stock, 20)

        # Workflow 13: Repeated cancellation must NOT increment stock a second time
        cancel_dup = self.client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Repeated network cancel request"},
            headers=headers,
        )
        self.assertEqual(cancel_dup.status_code, 200)
        self.assertEqual(cancel_dup.json()["status"], "CANCELLED")

        # Stock must remain 20
        self.assertEqual(self.client.get(f"/api/v1/products/{pid}", headers=headers).json()["current_stock"], 20)
        self.db.expire_all()
        prod_db2 = self.db.query(Product).filter(Product.id == UUID(pid)).first()
        self.assertEqual(prod_db2.current_stock, 20)

    # =========================================================================
    # WORKFLOW 14: Refund Behavior, Including Optional Restocking & Restrictions
    # =========================================================================

    def test_wf14_refund_workflows(self):
        """Test refunds with and without restock, idempotency, and cancellation conflict rules."""
        user = self.register_and_login("wf14_refund@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Refund Mart")

        p1 = self.client.post(
            "/api/v1/products",
            json={"name": "Sealed Rice Bag 5kg", "selling_price": 300.0, "current_stock": 30},
            headers=headers,
        ).json()

        p2 = self.client.post(
            "/api/v1/products",
            json={"name": "Expired Biscuit Pack", "selling_price": 20.0, "current_stock": 30},
            headers=headers,
        ).json()

        # Sale 1 (eligible for restock)
        s1 = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p1["id"], "quantity": 4}]},
            headers=headers,
        ).json()
        self.assertEqual(self.client.get(f"/api/v1/products/{p1['id']}", headers=headers).json()["current_stock"], 26)

        # Refund Sale 1 with restock_items=True
        ref1 = self.client.post(
            f"/api/v1/sales/{s1['id']}/refund",
            json={"reason": "Wrong item chosen by customer", "restock_items": True},
            headers=headers,
        )
        self.assertEqual(ref1.status_code, 200)
        self.assertEqual(ref1.json()["status"], "REFUNDED")
        self.assertEqual(self.client.get(f"/api/v1/products/{p1['id']}", headers=headers).json()["current_stock"], 30)

        # Repeated refund call on Sale 1 -> Idempotent, no extra stock added
        ref1_dup = self.client.post(
            f"/api/v1/sales/{s1['id']}/refund",
            json={"reason": "Retry call", "restock_items": True},
            headers=headers,
        )
        self.assertEqual(ref1_dup.status_code, 200)
        self.assertEqual(self.client.get(f"/api/v1/products/{p1['id']}", headers=headers).json()["current_stock"], 30)

        # Sale 2 (damaged/perishable return - do not restock)
        s2 = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p2["id"], "quantity": 6}]},
            headers=headers,
        ).json()
        self.assertEqual(self.client.get(f"/api/v1/products/{p2['id']}", headers=headers).json()["current_stock"], 24)

        # Refund Sale 2 with restock_items=False
        ref2 = self.client.post(
            f"/api/v1/sales/{s2['id']}/refund",
            json={"reason": "Customer reported expired batch", "restock_items": False},
            headers=headers,
        )
        self.assertEqual(ref2.status_code, 200)
        self.assertEqual(ref2.json()["status"], "REFUNDED")
        # Stock remains 24
        self.assertEqual(self.client.get(f"/api/v1/products/{p2['id']}", headers=headers).json()["current_stock"], 24)

        # Cannot cancel an already refunded sale
        cancel_refunded = self.client.post(
            f"/api/v1/sales/{s1['id']}/cancel",
            json={"reason": "Attempting cancel on refunded sale"},
            headers=headers,
        )
        self.assertEqual(cancel_refunded.status_code, 400)
        self.assertIn("already been refunded", cancel_refunded.json()["detail"].lower())

    # =========================================================================
    # WORKFLOW 15 & 16: Stockout Event Creation and Closure Lifecycle
    # =========================================================================

    def test_wf15_and_wf16_stockout_lifecycle(self):
        """Test stockout creation when reaching zero, deduplication, and resolution upon stock replenishment."""
        user = self.register_and_login("wf1516_stockout@test.com")
        headers = user["headers"]
        self.create_shop_for_user(headers, "Stockout Mart")

        p = self.client.post(
            "/api/v1/products",
            json={"name": "Last Cooking Oil Tin", "selling_price": 210.0, "current_stock": 2},
            headers=headers,
        ).json()
        pid_uuid = UUID(p["id"])

        # Workflow 15: Deplete remaining 2 units -> Stock hits 0
        sale = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": p["id"], "quantity": 2}]},
            headers=headers,
        ).json()

        # Check DB for active stockout event
        active_events = self.db.query(StockoutEvent).filter(
            StockoutEvent.product_id == pid_uuid,
            StockoutEvent.ended_at.is_(None),
        ).all()
        self.assertEqual(len(active_events), 1)
        ev = active_events[0]
        self.assertEqual(ev.reason, "DEPLETED_BY_SALE")
        self.assertIsNone(ev.ended_at)

        # Check product last_stockout_at is set
        p_db = self.db.query(Product).filter(Product.id == pid_uuid).first()
        self.assertIsNotNone(p_db.last_stockout_at)

        # Update stock manually while still at 0: should not create duplicate active event
        self.client.put(
            f"/api/v1/products/{p['id']}",
            json={"current_stock": 0},
            headers=headers,
        )
        self.db.expire_all()
        active_events_dup_chk = self.db.query(StockoutEvent).filter(
            StockoutEvent.product_id == pid_uuid,
            StockoutEvent.ended_at.is_(None),
        ).all()
        self.assertEqual(len(active_events_dup_chk), 1)

        # Workflow 16: Cancel sale -> Stock restored to 2 -> Active stockout event resolved
        self.client.post(
            f"/api/v1/sales/{sale['id']}/cancel",
            json={"reason": "Customer card declined"},
            headers=headers,
        )

        self.db.expire_all()
        active_events_after = self.db.query(StockoutEvent).filter(
            StockoutEvent.product_id == pid_uuid,
            StockoutEvent.ended_at.is_(None),
        ).all()
        self.assertEqual(len(active_events_after), 0)

        closed_ev = self.db.query(StockoutEvent).filter(StockoutEvent.id == ev.id).first()
        self.assertIsNotNone(closed_ev.ended_at)

    # =========================================================================
    # WORKFLOW 17: Cross-Shop Access Must Be Rejected
    # =========================================================================

    def test_wf17_cross_shop_access_rejected(self):
        """Test tenant boundary: Shop B cannot inspect, mutate, cancel, or sell Shop A's resources."""
        shop_a = self.register_and_login("shop_a_owner@test.com")
        self.create_shop_for_user(shop_a["headers"], "Shop Alpha")

        shop_b = self.register_and_login("shop_b_owner@test.com")
        self.create_shop_for_user(shop_b["headers"], "Shop Beta")

        # Shop A creates product and sale
        pa = self.client.post(
            "/api/v1/products",
            json={"name": "Alpha Specialty Sauce", "selling_price": 180.0, "current_stock": 10},
            headers=shop_a["headers"],
        ).json()

        sa = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": pa["id"], "quantity": 1}]},
            headers=shop_a["headers"],
        ).json()

        # 1. Shop B attempts to get Shop A product -> 403 Forbidden
        get_p_res = self.client.get(f"/api/v1/products/{pa['id']}", headers=shop_b["headers"])
        self.assertEqual(get_p_res.status_code, 403)

        # 2. Shop B attempts to update Shop A product -> 403 Forbidden
        put_p_res = self.client.put(
            f"/api/v1/products/{pa['id']}",
            json={"selling_price": 10.0},
            headers=shop_b["headers"],
        )
        self.assertEqual(put_p_res.status_code, 403)

        # 3. Shop B attempts to delete Shop A product -> 403 Forbidden
        del_p_res = self.client.delete(f"/api/v1/products/{pa['id']}", headers=shop_b["headers"])
        self.assertEqual(del_p_res.status_code, 403)

        # 4. Shop B attempts to view Shop A sale -> 403 Forbidden
        get_s_res = self.client.get(f"/api/v1/sales/{sa['id']}", headers=shop_b["headers"])
        self.assertEqual(get_s_res.status_code, 403)

        # 5. Shop B attempts to cancel Shop A sale -> 403 Forbidden
        cancel_s_res = self.client.post(
            f"/api/v1/sales/{sa['id']}/cancel",
            json={"reason": "Unauthorized attack"},
            headers=shop_b["headers"],
        )
        self.assertEqual(cancel_s_res.status_code, 403)

        # 6. Shop B attempts to refund Shop A sale -> 403 Forbidden
        refund_s_res = self.client.post(
            f"/api/v1/sales/{sa['id']}/refund",
            json={"reason": "Unauthorized attack", "restock_items": True},
            headers=shop_b["headers"],
        )
        self.assertEqual(refund_s_res.status_code, 403)

        # 7. Shop B attempts to create sale referencing Shop A product -> 400 Bad Request
        sell_other_p = self.client.post(
            "/api/v1/sales",
            json={"items": [{"product_id": pa["id"], "quantity": 1}]},
            headers=shop_b["headers"],
        )
        self.assertEqual(sell_other_p.status_code, 400)
        self.assertIn("not found or does not belong to your shop", sell_other_p.json()["detail"].lower())

    # =========================================================================
    # WORKFLOW 18: Ensure One User's Data Is Never Visible to Another User
    # =========================================================================

    def test_wf18_user_data_isolation(self):
        """Test full data separation across products, sales, and operating calendar records."""
        user1 = self.register_and_login("tenant1@test.com")
        self.create_shop_for_user(user1["headers"], "Tenant 1 Shop")

        user2 = self.register_and_login("tenant2@test.com")
        self.create_shop_for_user(user2["headers"], "Tenant 2 Shop")

        # Tenant 1 populates data
        p1 = self.client.post("/api/v1/products", json={"name": "Tenant 1 Rice", "selling_price": 80.0, "current_stock": 20}, headers=user1["headers"]).json()
        self.client.post("/api/v1/sales", json={"items": [{"product_id": p1["id"], "quantity": 2}]}, headers=user1["headers"])
        d1 = date.today().isoformat()
        self.client.post("/api/v1/shop-status", json={"operating_date": d1, "is_open": False, "closure_reason": "PERSONAL"}, headers=user1["headers"])

        # Tenant 2 populates data
        p2 = self.client.post("/api/v1/products", json={"name": "Tenant 2 Sugar", "selling_price": 40.0, "current_stock": 30}, headers=user2["headers"]).json()
        self.client.post("/api/v1/sales", json={"items": [{"product_id": p2["id"], "quantity": 1}]}, headers=user2["headers"])
        self.client.post("/api/v1/shop-status", json={"operating_date": d1, "is_open": True}, headers=user2["headers"])

        # Tenant 2 lists products: must see ONLY Tenant 2 Sugar
        t2_prods = self.client.get("/api/v1/products", headers=user2["headers"]).json()
        self.assertEqual(t2_prods["total"], 1)
        self.assertEqual(t2_prods["items"][0]["name"], "Tenant 2 Sugar")

        # Tenant 2 lists sales: must see ONLY Tenant 2's sale
        t2_sales = self.client.get("/api/v1/sales", headers=user2["headers"]).json()
        self.assertEqual(t2_sales["total"], 1)
        self.assertEqual(t2_sales["items"][0]["total_amount"], 40.0)

        # Tenant 2 checks status for d1: must see OPEN (Tenant 1's is CLOSED)
        t2_status = self.client.get(f"/api/v1/shop-status/date/{d1}", headers=user2["headers"]).json()
        self.assertTrue(t2_status["is_open"])


if __name__ == "__main__":
    unittest.main()
