import time
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from db.session import Base
import db.models
from api.deps import get_db

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

def get_authenticated_headers(email: str = "dash_user@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_dashboard_unauthorized():
    response = client.get("/api/v1/dashboard")
    assert response.status_code == 401

def test_dashboard_no_shop_profile_fails():
    headers = get_authenticated_headers("no_shop_dash@example.com")
    response = client.get("/api/v1/dashboard", headers=headers)
    assert response.status_code == 400
    assert "User must create a shop profile" in response.json()["detail"]

def test_dashboard_empty_shop():
    headers = get_authenticated_headers("empty_shop_dash@example.com")
    
    # Create shop profile
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Empty Supermart",
        "owner_name": "John Doe",
        "business_type": "Grocery/Kirana",
        "location": "Downtown"
    }, headers=headers)
    assert shop_res.status_code == 201

    # Fetch dashboard
    response = client.get("/api/v1/dashboard", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["today_sales"] == 0.0
    assert data["products_count"] == 0
    assert data["low_stock_count"] == 0
    assert data["items_sold_today"] == 0
    assert data["top_products"] == []
    assert data["low_stock_products"] == []
    assert data["recent_sales"] == []

def test_dashboard_shop_with_products():
    headers = get_authenticated_headers("prod_dash@example.com")
    
    # Create shop profile
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Product Mart",
        "owner_name": "Jane Owner",
        "business_type": "Mobile & Electronics Accessories",
        "location": "City Center"
    }, headers=headers)
    assert shop_res.status_code == 201

    # Product 1: Normal stock (stock=50, reorder=10)
    client.post("/api/v1/products", json={
        "name": "Wireless Mouse",
        "selling_price": 500.0,
        "current_stock": 50,
        "reorder_level": 10
    }, headers=headers)

    # Product 2: Low stock (stock=5, reorder=10)
    client.post("/api/v1/products", json={
        "name": "USB Keyboard",
        "selling_price": 800.0,
        "current_stock": 5,
        "reorder_level": 10
    }, headers=headers)

    # Fetch dashboard
    response = client.get("/api/v1/dashboard", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["products_count"] == 2
    assert data["low_stock_count"] == 1
    assert len(data["low_stock_products"]) == 1
    assert data["low_stock_products"][0]["name"] == "USB Keyboard"
    assert data["low_stock_products"][0]["stock_status"] in ["Low Stock", "Critical"]

def test_dashboard_shop_with_sales():
    headers = get_authenticated_headers("sales_dash@example.com")
    
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Full Sales Mart",
        "owner_name": "Bob Trader",
        "business_type": "Other Retail Store",
        "location": "Market Yard"
    }, headers=headers)
    assert shop_res.status_code == 201

    # Add Product A (Price: 100, Stock: 100)
    p_a_res = client.post("/api/v1/products", json={
        "name": "Product A",
        "selling_price": 100.0,
        "current_stock": 100,
        "reorder_level": 20
    }, headers=headers)
    assert p_a_res.status_code == 201
    p_a = p_a_res.json()

    # Add Product B (Price: 50, Stock: 100)
    p_b_res = client.post("/api/v1/products", json={
        "name": "Product B",
        "selling_price": 50.0,
        "current_stock": 100,
        "reorder_level": 20
    }, headers=headers)
    assert p_b_res.status_code == 201
    p_b = p_b_res.json()

    # Sale 1: 5 of Product A (Revenue = 500)
    s1_res = client.post("/api/v1/sales", json={
        "items": [{"product_id": p_a["id"], "quantity": 5}],
        "payment_method": "cash"
    }, headers=headers)
    assert s1_res.status_code == 201

    # Sale 2: 10 of Product B and 2 of Product A (Revenue = 10*50 + 2*100 = 700)
    s2_res = client.post("/api/v1/sales", json={
        "items": [
            {"product_id": p_b["id"], "quantity": 10},
            {"product_id": p_a["id"], "quantity": 2}
        ],
        "payment_method": "upi"
    }, headers=headers)
    assert s2_res.status_code == 201

    # Total today_sales = 500 + 700 = 1200
    # Total items_sold_today = 5 + 10 + 2 = 17
    # Product B sold 10, Product A sold 7 -> Top product is Product B (total_sold=10), then Product A (total_sold=7)

    response = client.get("/api/v1/dashboard", headers=headers)
    assert response.status_code == 200
    data = response.json()

    assert data["today_sales"] == 1200.0
    assert data["products_count"] == 2
    assert data["items_sold_today"] == 17
    assert len(data["recent_sales"]) == 2
    assert len(data["top_products"]) == 2

    # Verify top products ranking
    assert data["top_products"][0]["name"] == "Product B"
    assert data["top_products"][0]["total_sold"] == 10

    assert data["top_products"][1]["name"] == "Product A"
    assert data["top_products"][1]["total_sold"] == 7

def test_dashboard_performance_verification():
    headers = get_authenticated_headers("perf_dash@example.com")
    
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Perf Mart",
        "owner_name": "Speedy",
        "business_type": "Other Retail Store",
        "location": "Highway"
    }, headers=headers)
    assert shop_res.status_code == 201

    start_time = time.time()
    response = client.get("/api/v1/dashboard", headers=headers)
    elapsed_ms = (time.time() - start_time) * 1000

    assert response.status_code == 200
    assert elapsed_ms < 500.0  # Must execute under 500ms
