import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import unittest
from datetime import date, time, datetime, timezone
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import IntegrityError

from main import init_db_schema
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
from core.categories import (
    INDIAN_RETAIL_CATEGORIES,
    normalize_product_category,
)


class TestPhase1DatabaseFoundation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        Base.metadata.create_all(bind=self.engine)
        init_db_schema(bind=self.engine)
        self.db = self.SessionLocal()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def create_test_shop(self, user_email="owner@example.com") -> Shop:
        user = User(email=user_email, hashed_password="hashedpassword123", is_active=True)
        self.db.add(user)
        self.db.flush()

        shop = Shop(
            shop_name="Gupta Kirana Store",
            owner_name="Ramesh Gupta",
            business_type="Grocery/Kirana",
            owner_id=user.id,
        )
        self.db.add(shop)
        self.db.flush()
        return shop

    def test_01_new_tables_and_columns_exist(self):
        """Verify that all Phase 1 new tables and additive columns exist in the database."""
        with self.engine.connect() as conn:
            inspector = inspect(conn)
            tables = set(inspector.get_table_names())

            # 1. New tables
            self.assertIn("shop_operating_status", tables)
            self.assertIn("stockout_events", tables)
            self.assertIn("product_categories", tables)

            # 2. Check shop_operating_status columns
            sos_cols = {c["name"] for c in inspector.get_columns("shop_operating_status")}
            for col in ["id", "shop_id", "operating_date", "is_open", "opening_time", "closing_time", "closure_reason", "notes", "created_at", "updated_at"]:
                self.assertIn(col, sos_cols, f"Missing in shop_operating_status: {col}")

            # 3. Check stockout_events columns
            so_cols = {c["name"] for c in inspector.get_columns("stockout_events")}
            for col in ["id", "shop_id", "product_id", "started_at", "ended_at", "reason", "created_at"]:
                self.assertIn(col, so_cols, f"Missing in stockout_events: {col}")

            # 4. Check product_categories columns
            cat_cols = {c["name"] for c in inspector.get_columns("product_categories")}
            for col in ["code", "name", "description", "display_order", "is_active", "created_at"]:
                self.assertIn(col, cat_cols, f"Missing in product_categories: {col}")

            # 5. Check products additive columns
            prod_cols = {c["name"] for c in inspector.get_columns("products")}
            for col in ["standardized_category", "raw_category", "needs_category_review", "last_stockout_at", "is_active"]:
                self.assertIn(col, prod_cols, f"Missing in products: {col}")

            # 6. Check sales additive columns
            sales_cols = {c["name"] for c in inspector.get_columns("sales")}
            for col in ["status", "cancelled_at", "cancellation_reason"]:
                self.assertIn(col, sales_cols, f"Missing in sales: {col}")

            # 7. Check sale_items additive column
            si_cols = {c["name"] for c in inspector.get_columns("sale_items")}
            self.assertIn("cost_price_at_sale", si_cols, "Missing in sale_items: cost_price_at_sale")

    def test_02_unique_shop_operating_date_constraint(self):
        """Verify that a shop cannot have duplicate operating status records for the same date."""
        shop = self.create_test_shop("owner1@example.com")
        target_date = date(2026, 11, 3)

        status1 = ShopOperatingStatus(
            shop_id=shop.id,
            operating_date=target_date,
            is_open=True,
            opening_time=time(7, 0),
            closing_time=time(22, 0),
        )
        self.db.add(status1)
        self.db.commit()

        status2 = ShopOperatingStatus(
            shop_id=shop.id,
            operating_date=target_date,
            is_open=False,
            closure_reason="WEEKLY_OFF",
        )
        self.db.add(status2)
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_03_multi_shops_independent_operating_calendars(self):
        """Verify that multiple shops can independently record operating status for the same calendar date."""
        shop_a = self.create_test_shop("shop_a@example.com")
        shop_b = self.create_test_shop("shop_b@example.com")
        shared_date = date(2026, 11, 3)

        status_a = ShopOperatingStatus(
            shop_id=shop_a.id,
            operating_date=shared_date,
            is_open=True,
            opening_time=time(8, 0),
        )
        status_b = ShopOperatingStatus(
            shop_id=shop_b.id,
            operating_date=shared_date,
            is_open=False,
            closure_reason="FESTIVAL",
            notes="Diwali Holiday",
        )
        self.db.add_all([status_a, status_b])
        self.db.commit()

        res_a = self.db.query(ShopOperatingStatus).filter(
            ShopOperatingStatus.shop_id == shop_a.id,
            ShopOperatingStatus.operating_date == shared_date
        ).first()
        self.assertIsNotNone(res_a)
        self.assertTrue(res_a.is_open)

        res_b = self.db.query(ShopOperatingStatus).filter(
            ShopOperatingStatus.shop_id == shop_b.id,
            ShopOperatingStatus.operating_date == shared_date
        ).first()
        self.assertIsNotNone(res_b)
        self.assertFalse(res_b.is_open)
        self.assertEqual(res_b.closure_reason, "FESTIVAL")

    def test_04_stockout_event_lifecycle(self):
        """Verify creation, active state tracking, and resolution of stockout events."""
        shop = self.create_test_shop("stockout_shop@example.com")
        prod = Product(
            name="Amul Butter (100g)",
            category="Dairy",
            standardized_category="Dairy",
            raw_category="Dairy",
            needs_category_review=False,
            selling_price=58.0,
            current_stock=0,
            shop_id=shop.id,
        )
        self.db.add(prod)
        self.db.flush()

        event = StockoutEvent(
            shop_id=shop.id,
            product_id=prod.id,
            started_at=datetime.now(timezone.utc),
            reason="DEPLETED_BY_SALE",
        )
        self.db.add(event)
        prod.last_stockout_at = datetime.now(timezone.utc)
        self.db.commit()

        active_event = self.db.query(StockoutEvent).filter(
            StockoutEvent.shop_id == shop.id,
            StockoutEvent.product_id == prod.id,
            StockoutEvent.ended_at.is_(None)
        ).first()
        self.assertIsNotNone(active_event)
        self.assertEqual(active_event.reason, "DEPLETED_BY_SALE")

        active_event.ended_at = datetime.now(timezone.utc)
        prod.current_stock = 25
        prod.last_stockout_at = None
        self.db.commit()

        resolved = self.db.query(StockoutEvent).filter(StockoutEvent.id == active_event.id).first()
        self.assertIsNotNone(resolved.ended_at)
        self.assertIsNone(prod.last_stockout_at)

    def test_05_category_master_seeding(self):
        """Verify that all 12 Indian retail categories are seeded in product_categories."""
        categories = self.db.query(ProductCategory).order_by(ProductCategory.display_order).all()
        self.assertEqual(len(categories), 12)

        cat_names = [c.name for c in categories]
        for expected in INDIAN_RETAIL_CATEGORIES:
            self.assertIn(expected, cat_names)

    def test_06_category_normalization_logic(self):
        """Verify non-destructive normalization and review flagging rules."""
        # Unambiguous standard categories
        std, review = normalize_product_category("Dairy", "Amul Butter 100g")
        self.assertEqual(std, "Dairy")
        self.assertFalse(review)

        std, review = normalize_product_category("bakery", "Fresh White Bread")
        self.assertEqual(std, "Bakery")
        self.assertFalse(review)

        std, review = normalize_product_category("Spices", "Everest Garam Masala")
        self.assertEqual(std, "Spices")
        self.assertFalse(review)

        # Contextual staples
        std, review = normalize_product_category("Staples", "Basmati Rice 5kg")
        self.assertEqual(std, "Grains and Pulses")
        self.assertFalse(review)

        std, review = normalize_product_category("Staples", "Sunflower Cooking Oil 1L")
        self.assertEqual(std, "Edible Oils")
        self.assertFalse(review)

        std, review = normalize_product_category("Staples", "Aashirvaad Atta 5kg")
        self.assertEqual(std, "Staples")
        self.assertFalse(review)

        # Ambiguous categories (must flag for review without data loss)
        std, review = normalize_product_category("General", "Hardware Item")
        self.assertEqual(std, "Other")
        self.assertTrue(review)

        std, review = normalize_product_category(None, "Product Alpha")
        self.assertIsNone(std)
        self.assertTrue(review)

        std, review = normalize_product_category("", "Unknown Item")
        self.assertIsNone(std)
        self.assertTrue(review)

    def test_07_existing_product_and_sales_compatibility(self):
        """Verify that existing products and sales records with Phase 1 additions work seamlessly."""
        shop = self.create_test_shop("compat_shop@example.com")

        product = Product(
            name="Toned Milk (500ml)",
            category="Dairy",
            raw_category="Dairy",
            standardized_category="Dairy",
            needs_category_review=False,
            selling_price=28.0,
            purchase_price=22.0,
            current_stock=50,
            reorder_level=20,
            is_active=True,
            shop_id=shop.id,
        )
        self.db.add(product)
        self.db.commit()

        sale = Sale(
            shop_id=shop.id,
            total_amount=56.0,
            payment_method="upi",
            status="COMPLETED",
        )
        self.db.add(sale)
        self.db.flush()

        item = SaleItem(
            sale_id=sale.id,
            product_id=product.id,
            quantity=2,
            unit_price=28.0,
            cost_price_at_sale=22.0,
        )
        self.db.add(item)
        self.db.commit()

        saved_sale = self.db.query(Sale).filter(Sale.id == sale.id).first()
        self.assertEqual(saved_sale.status, "COMPLETED")
        self.assertIsNone(saved_sale.cancelled_at)

        saved_item = self.db.query(SaleItem).filter(SaleItem.id == item.id).first()
        self.assertEqual(saved_item.cost_price_at_sale, 22.0)

        saved_prod = self.db.query(Product).filter(Product.id == product.id).first()
        self.assertEqual(saved_prod.standardized_category, "Dairy")
        self.assertEqual(saved_prod.raw_category, "Dairy")
        self.assertFalse(saved_prod.needs_category_review)
        self.assertTrue(saved_prod.is_active)

    def test_08_repeated_migration_idempotency(self):
        """Verify that init_db_schema can be executed repeatedly without errors or duplicate columns."""
        for _ in range(3):
            init_db_schema(bind=self.engine)

        with self.engine.connect() as conn:
            inspector = inspect(conn)
            prod_cols = [c["name"] for c in inspector.get_columns("products")]
            self.assertEqual(len(prod_cols), len(set(prod_cols)))
            self.assertIn("standardized_category", prod_cols)

            cat_count = conn.execute(text("SELECT COUNT(*) FROM product_categories")).scalar()
            self.assertEqual(cat_count, 12)


if __name__ == "__main__":
    unittest.main()
