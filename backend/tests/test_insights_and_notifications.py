import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from db.session import Base
import db.models
from api.deps import get_db
from tests.pricing_helpers import verify_product

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)

client = TestClient(app)

def create_user_and_shop(email: str, shop_name: str):
    client.post("/api/v1/auth/register", json={"email": email, "password": "Password123!"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    shop_res = client.post(
        "/api/v1/shops",
        headers=headers,
        json={
            "shop_name": shop_name,
            "owner_name": "Test Owner",
            "business_type": "Grocery/Kirana",
            "location": "Hyderabad"
        }
    )
    assert shop_res.status_code == 201, f"Shop creation failed: {shop_res.text}"
    shop_id = shop_res.json()["id"]
    return headers, shop_id


def test_sales_insights_empty_shop():
    headers, _ = create_user_and_shop("empty_insights@example.com", "Empty Mart")
    res = client.get("/api/v1/insights/sales?period=7d", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["has_sufficient_data"] is False
    assert data["overview"]["total_sales"] == 0.0
    assert data["overview"]["transaction_count"] == 0
    assert data["overview"]["average_transaction_value"] == 0.0
    assert len(data["performance"]["best_selling"]) == 0


def test_sales_and_inventory_insights_with_data():
    headers, _ = create_user_and_shop("active_insights@example.com", "Active Mart")

    # 1. Create Products
    p1_res = client.post("/api/v1/products", headers=headers, json={
        "name": "Basmati Rice 5kg",
        "category": "Grains",
        "selling_price": 500.0,
        "purchase_price": 400.0,
        "current_stock": 20,
        "reorder_level": 5,
        "unit": "bag"
    })
    p1_id = p1_res.json()["id"]

    p2_res = client.post("/api/v1/products", headers=headers, json={
        "name": "Sunflower Oil 1L",
        "category": "Oil",
        "selling_price": 150.0,
        "purchase_price": 120.0,
        "current_stock": 3,
        "reorder_level": 10,  # Low stock: current_stock (3) <= reorder_level (10)
        "unit": "bottle"
    })
    p2_id = p2_res.json()["id"]

    p3_res = client.post("/api/v1/products", headers=headers, json={
        "name": "Tata Salt 1kg",
        "category": "Spices",
        "selling_price": 25.0,
        "purchase_price": 18.0,
        "current_stock": 0,  # Out of stock
        "reorder_level": 15,
        "unit": "pack"
    })
    p3_id = p3_res.json()["id"]

    p4_res = client.post("/api/v1/products", headers=headers, json={
        "name": "Maggi Noodles 4-pack",
        "category": "Snacks",
        "selling_price": 55.0,
        "purchase_price": 45.0,
        "current_stock": 100,  # Overstocked (> 5x reorder and >= 40)
        "reorder_level": 10,
        "unit": "pack"
    })
    p4_id = p4_res.json()["id"]

    # Products sold below are valid retail products: verified by the shop owner (Stage 4)
    verify_product(client, headers, p1_id)
    verify_product(client, headers, p2_id)

    # 2. Record Sales
    sale_res = client.post("/api/v1/sales", headers=headers, json={
        "payment_method": "cash",
        "items": [
            {"product_id": p1_id, "quantity": 3, "unit_price": 500.0},
            {"product_id": p2_id, "quantity": 1, "unit_price": 150.0}
        ]
    })
    assert sale_res.status_code == 201

    # 3. Test Sales Insights
    s_res = client.get("/api/v1/insights/sales?period=today", headers=headers)
    assert s_res.status_code == 200
    s_data = s_res.json()
    assert s_data["has_sufficient_data"] is True
    assert s_data["overview"]["total_sales"] == 1650.0  # (3 * 500) + (1 * 150)
    assert s_data["overview"]["transaction_count"] == 1
    assert s_data["overview"]["average_transaction_value"] == 1650.0

    # Best selling verification
    best_sellers = s_data["performance"]["best_selling"]
    assert len(best_sellers) >= 2
    assert best_sellers[0]["product_id"] == p1_id
    assert best_sellers[0]["quantity_sold"] == 3
    assert best_sellers[0]["revenue"] == 1500.0

    # 4. Test Inventory Insights
    inv_res = client.get("/api/v1/insights/inventory", headers=headers)
    assert inv_res.status_code == 200
    inv_data = inv_res.json()
    counts = inv_data["counts"]
    assert counts["total_products"] == 4
    assert counts["out_of_stock"] == 1  # Tata Salt
    assert counts["low_stock"] >= 1     # Sunflower Oil
    assert counts["overstocked"] == 1   # Maggi Noodles

    # Verify status mapping and actions
    salt_item = next(it for it in inv_data["items"] if it["product_id"] == p3_id)
    assert salt_item["status"] == "OUT OF STOCK"
    assert salt_item["urgency"] == "critical"

    oil_item = next(it for it in inv_data["items"] if it["product_id"] == p2_id)
    assert oil_item["status"] == "LOW STOCK"
    assert oil_item["urgency"] == "high"

    maggi_item = next(it for it in inv_data["items"] if it["product_id"] == p4_id)
    assert maggi_item["status"] == "OVERSTOCKED"

    # 5. Test AI Insights
    ai_res = client.get("/api/v1/insights/ai-summary", headers=headers)
    assert ai_res.status_code == 200
    ai_data = ai_res.json()
    assert len(ai_data["insights"]) > 0
    # Grounded data assertions
    titles = [c["title"] for c in ai_data["insights"]]
    assert any("Top Revenue Driver" in t for t in titles)
    assert any("Critical Stockout" in t for t in titles)


def test_notification_evaluation_and_deduplication():
    headers, _ = create_user_and_shop("notif_user@example.com", "Alert Supermart")

    # Add 1 product that is low stock
    prod_res = client.post("/api/v1/products", headers=headers, json={
        "name": "Dairy Milk Silk",
        "category": "Chocolates",
        "selling_price": 80.0,
        "purchase_price": 60.0,
        "current_stock": 2,
        "reorder_level": 8,
        "unit": "bar"
    })
    p_id = prod_res.json()["id"]

    # 1. Trigger evaluation
    trig1 = client.post("/api/v1/notifications/trigger-evaluation", headers=headers)
    assert trig1.status_code == 200
    data1 = trig1.json()
    assert data1["alerts_generated"] >= 1
    assert any(n["product_id"] == p_id for n in data1["notifications"])

    # 2. Trigger evaluation again immediately -> should be de-duplicated (0 new alerts)
    trig2 = client.post("/api/v1/notifications/trigger-evaluation", headers=headers)
    assert trig2.status_code == 200
    data2 = trig2.json()
    assert data2["alerts_generated"] == 0  # Deduplicated within 24h cooldown

    # 3. Check notifications list
    list_res = client.get("/api/v1/notifications", headers=headers)
    assert list_res.status_code == 200
    l_data = list_res.json()
    assert l_data["total"] >= 1
    assert l_data["unread_count"] >= 1
    notif_id = l_data["items"][0]["id"]

    # 4. Unread count endpoint
    unread_res = client.get("/api/v1/notifications/unread-count", headers=headers)
    assert unread_res.status_code == 200
    assert unread_res.json()["count"] >= 1

    # 5. Mark as read
    patch_res = client.patch(f"/api/v1/notifications/{notif_id}/read", headers=headers)
    assert patch_res.status_code == 200
    assert patch_res.json()["is_read"] is True

    # 6. Mark all as read
    mark_all = client.post("/api/v1/notifications/mark-all-read", headers=headers)
    assert mark_all.status_code == 200
    unread_res2 = client.get("/api/v1/notifications/unread-count", headers=headers)
    assert unread_res2.json()["count"] == 0

    # 7. Delete notification
    del_res = client.delete(f"/api/v1/notifications/{notif_id}", headers=headers)
    assert del_res.status_code == 200
    list_res2 = client.get("/api/v1/notifications", headers=headers)
    assert list_res2.json()["total"] == 0


def test_notification_preferences():
    headers, _ = create_user_and_shop("pref_user@example.com", "Pref Mart")

    # Fetch default preferences
    pref_res = client.get("/api/v1/notifications/preferences", headers=headers)
    assert pref_res.status_code == 200
    pref_data = pref_res.json()
    assert pref_data["sales_alerts"] is True
    assert pref_data["inventory_alerts"] is True

    # Disable inventory alerts
    update_res = client.put(
        "/api/v1/notifications/preferences",
        headers=headers,
        json={
            "sales_alerts": True,
            "inventory_alerts": False,
            "system_alerts": True,
            "in_app_enabled": True,
            "push_enabled": True,
            "daily_summary_enabled": True
        }
    )
    assert update_res.status_code == 200
    assert update_res.json()["inventory_alerts"] is False

    # Create low stock product
    client.post("/api/v1/products", headers=headers, json={
        "name": "Tea Powder 250g",
        "selling_price": 90.0,
        "current_stock": 1,
        "reorder_level": 5
    })

    # Trigger evaluation -> since inventory_alerts is False, no inventory alert should be emitted
    trig = client.post("/api/v1/notifications/trigger-evaluation", headers=headers)
    assert trig.status_code == 200
    assert trig.json()["alerts_generated"] == 0


def test_device_token_registration():
    headers, _ = create_user_and_shop("device_user@example.com", "Device Mart")

    # Register Android device token
    reg_res = client.post(
        "/api/v1/notifications/devices",
        headers=headers,
        json={"token": "fcm_dummy_token_12345", "platform": "android"}
    )
    assert reg_res.status_code == 200
    assert reg_res.json()["token"] == "fcm_dummy_token_12345"
    assert reg_res.json()["is_active"] is True

    # Unregister device token
    unreg_res = client.delete("/api/v1/notifications/devices/fcm_dummy_token_12345", headers=headers)
    assert unreg_res.status_code == 200
    assert unreg_res.json()["success"] is True


def test_store_isolation():
    headers_a, shop_a = create_user_and_shop("store_a@example.com", "Store A")
    headers_b, shop_b = create_user_and_shop("store_b@example.com", "Store B")

    # Create product in Store A with low stock
    client.post("/api/v1/products", headers=headers_a, json={
        "name": "Sugar 1kg",
        "selling_price": 45.0,
        "current_stock": 0,
        "reorder_level": 10
    })

    # Evaluate Store A
    client.post("/api/v1/notifications/trigger-evaluation", headers=headers_a)

    # Store A should have 1 notification
    list_a = client.get("/api/v1/notifications", headers=headers_a).json()
    assert list_a["total"] == 1

    # Store B must NEVER see Store A's notifications!
    list_b = client.get("/api/v1/notifications", headers=headers_b).json()
    assert list_b["total"] == 0

    # Store B's insights must not include Store A's products
    inv_b = client.get("/api/v1/insights/inventory", headers=headers_b).json()
    assert inv_b["counts"]["total_products"] == 0


def test_sale_creation_triggers_low_stock_alert():
    headers, _ = create_user_and_shop("sale_alert_user@example.com", "Sale Alert Store")

    # Product with current stock 5, reorder level 4
    prod_res = client.post("/api/v1/products", headers=headers, json={
        "name": "Aashirvaad Atta 5kg",
        "category": "Flour",
        "selling_price": 270.0,
        "purchase_price": 230.0,
        "current_stock": 5,
        "reorder_level": 4,
        "unit": "bag"
    })
    prod_id = prod_res.json()["id"]
    verify_product(client, headers, prod_id)  # valid retail product (Stage 4: verify before sale)

    # Sell 2 units -> stock drops to 3 (which is <= reorder_level 4)
    sale_res = client.post("/api/v1/sales", headers=headers, json={
        "payment_method": "upi",
        "items": [{"product_id": prod_id, "quantity": 2, "unit_price": 270.0}]
    })
    assert sale_res.status_code == 201

    # Check that low stock notification was automatically triggered
    notifs = client.get("/api/v1/notifications?category=inventory", headers=headers).json()
    assert notifs["total"] >= 1
    assert any("Aashirvaad Atta" in n["title"] and n["priority"] == "high" for n in notifs["items"])


def test_invoice_confirm_triggers_system_notification():
    headers, _ = create_user_and_shop("invoice_alert_user@example.com", "Invoice Alert Store")

    confirm_res = client.post("/api/v1/invoices/confirm", headers=headers, json={
        "supplier_name": "Metro Cash & Carry",
        "invoice_number": "INV-METRO-991",
        "items": [
            {
                "name": "Chana Dal 1kg",
                "quantity": 20,
                "unit": "kg",
                "purchase_price": 85.0,
                "selling_price": 105.0
            }
        ]
    })
    assert confirm_res.status_code == 201

    # Verify system notification exists
    notifs = client.get("/api/v1/notifications?category=system", headers=headers).json()
    assert notifs["total"] >= 1
    assert any("Invoice Processed" in n["title"] and "Metro Cash & Carry" or "INV-METRO-991" in n["message"] or n["title"] for n in notifs["items"])

