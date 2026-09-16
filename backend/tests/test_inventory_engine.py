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

def get_auth_setup(email: str = "inventory_owner@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create shop
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Inventory Mart",
        "owner_name": "Inventory Manager",
        "business_type": "Grocery/Kirana",
        "location": "Central Market"
    }, headers=headers)
    shop_id = shop_res.json()["id"]
    return {"headers": headers, "shop_id": shop_id}

def test_sale_reduces_stock():
    setup = get_auth_setup("sale_reduce@example.com")
    headers = setup["headers"]
    
    # Create product with 50 stock
    p_res = client.post("/api/v1/products", json={
        "name": "Organic Honey 500g",
        "selling_price": 250.0,
        "current_stock": 50,
        "reorder_level": 10
    }, headers=headers)
    product_id = p_res.json()["id"]
    
    # Perform sale of 15 units
    client.post("/api/v1/sales", json={
        "items": [{"product_id": product_id, "quantity": 15}],
        "payment_method": "cash"
    }, headers=headers)
    
    # Check current stock reduced to 35
    prod = client.get(f"/api/v1/products/{product_id}", headers=headers).json()
    assert prod["current_stock"] == 35
    assert prod["stock_status"] == "In Stock"

def test_purchase_increases_stock():
    setup = get_auth_setup("purchase_increase@example.com")
    headers = setup["headers"]
    
    # Create product with 10 stock
    p_res = client.post("/api/v1/products", json={
        "name": "Olive Oil 1L",
        "selling_price": 600.0,
        "current_stock": 10,
        "reorder_level": 5
    }, headers=headers)
    product_id = p_res.json()["id"]
    
    # Perform purchase of 40 units
    client.post("/api/v1/purchases", json={
        "items": [{"product_id": product_id, "quantity": 40, "purchase_price": 450.0}]
    }, headers=headers)
    
    # Check current stock increased to 50
    prod = client.get(f"/api/v1/products/{product_id}", headers=headers).json()
    assert prod["current_stock"] == 50
    assert prod["stock_status"] == "In Stock"

def test_overselling_blocked():
    setup = get_auth_setup("overselling_block@example.com")
    headers = setup["headers"]
    
    # Create product with 5 stock
    p_res = client.post("/api/v1/products", json={
        "name": "Limited Spice Pack",
        "selling_price": 100.0,
        "current_stock": 5,
        "reorder_level": 2
    }, headers=headers)
    product_id = p_res.json()["id"]
    
    # Attempt sale of 10 units (greater than 5)
    sale_res = client.post("/api/v1/sales", json={
        "items": [{"product_id": product_id, "quantity": 10}],
        "payment_method": "cash"
    }, headers=headers)
    assert sale_res.status_code == 400
    assert "Insufficient stock" in sale_res.json()["detail"]
    
    # Check stock remains unchanged at 5
    prod = client.get(f"/api/v1/products/{product_id}", headers=headers).json()
    assert prod["current_stock"] == 5

def test_low_stock_endpoint_and_status_calculation():
    setup = get_auth_setup("low_stock_endpoint@example.com")
    headers = setup["headers"]
    
    # Create Milk: Stock=12, Reorder=15 -> Expected: "Low Stock"
    p_milk = client.post("/api/v1/products", json={
        "name": "Milk",
        "category": "Dairy",
        "selling_price": 30.0,
        "current_stock": 12,
        "reorder_level": 15
    }, headers=headers).json()
    
    # Create Normal Product: Stock=50, Reorder=10 -> Expected: "In Stock"
    client.post("/api/v1/products", json={
        "name": "Butter 200g",
        "category": "Dairy",
        "selling_price": 80.0,
        "current_stock": 50,
        "reorder_level": 10
    }, headers=headers)
    
    # Call low-stock endpoint
    low_res = client.get("/api/v1/products/low-stock", headers=headers)
    assert low_res.status_code == 200
    low_data = low_res.json()
    assert low_data["total"] == 1
    assert low_data["items"][0]["name"] == "Milk"
    assert low_data["items"][0]["current_stock"] == 12
    assert low_data["items"][0]["reorder_level"] == 15
    assert low_data["items"][0]["stock_status"] == "Low Stock"

def test_critical_status_calculation():
    setup = get_auth_setup("critical_status@example.com")
    headers = setup["headers"]
    
    # Product with 0 stock -> Expected: "Critical"
    p_zero = client.post("/api/v1/products", json={
        "name": "Empty Item",
        "selling_price": 50.0,
        "current_stock": 0,
        "reorder_level": 10
    }, headers=headers).json()
    assert p_zero["stock_status"] == "Critical"
    
    # Product with critically low stock (stock=2 <= reorder//2 = 7) -> Expected: "Critical"
    p_critical = client.post("/api/v1/products", json={
        "name": "Critically Low Tea",
        "selling_price": 100.0,
        "current_stock": 2,
        "reorder_level": 15
    }, headers=headers).json()
    assert p_critical["stock_status"] == "Critical"
    
    # Both products should appear in low-stock endpoint
    low_res = client.get("/api/v1/products/low-stock", headers=headers)
    assert low_res.status_code == 200
    assert low_res.json()["total"] == 2
