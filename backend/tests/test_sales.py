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

def get_auth_setup(email: str = "seller@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create shop
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Sales Retail Mart",
        "owner_name": "Sales Manager",
        "business_type": "Grocery/Kirana",
        "location": "High Street"
    }, headers=headers)
    shop_id = shop_res.json()["id"]
    
    # Create product 1 (Stock: 50, Price: 100.0)
    p1_res = client.post("/api/v1/products", json={
        "name": "Basmati Rice 1kg",
        "category": "Grains",
        "selling_price": 100.0,
        "current_stock": 50
    }, headers=headers)
    product1_id = p1_res.json()["id"]
    
    # Create product 2 (Stock: 30, Price: 40.0)
    p2_res = client.post("/api/v1/products", json={
        "name": "Refined Sugar 1kg",
        "category": "Groceries",
        "selling_price": 40.0,
        "current_stock": 30
    }, headers=headers)
    product2_id = p2_res.json()["id"]
    
    return {
        "headers": headers,
        "shop_id": shop_id,
        "product1_id": product1_id,
        "product2_id": product2_id
    }

def test_cash_sale_success():
    setup = get_auth_setup("cash_sale@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    
    payload = {
        "items": [
            {
                "product_id": product1_id,
                "quantity": 2
            }
        ],
        "payment_method": "cash"
    }
    
    response = client.post("/api/v1/sales", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["payment_method"] == "cash"
    assert data["total_amount"] == 200.0  # 2 * 100.0
    assert len(data["items"]) == 1
    assert data["items"][0]["quantity"] == 2
    assert data["items"][0]["unit_price"] == 100.0
    
    # Verify inventory deducted from 50 to 48
    p1 = client.get(f"/api/v1/products/{product1_id}", headers=headers).json()
    assert p1["current_stock"] == 48

def test_upi_sale_success():
    setup = get_auth_setup("upi_sale@example.com")
    headers = setup["headers"]
    product2_id = setup["product2_id"]
    
    payload = {
        "items": [
            {
                "product_id": product2_id,
                "quantity": 5
            }
        ],
        "payment_method": "upi"
    }
    
    response = client.post("/api/v1/sales", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["payment_method"] == "upi"
    assert data["total_amount"] == 200.0  # 5 * 40.0
    
    # Verify stock deducted from 30 to 25
    p2 = client.get(f"/api/v1/products/{product2_id}", headers=headers).json()
    assert p2["current_stock"] == 25

def test_multi_item_sale_success():
    setup = get_auth_setup("multi_sale@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    product2_id = setup["product2_id"]
    
    payload = {
        "items": [
            {
                "product_id": product1_id,
                "quantity": 3  # 3 * 100.0 = 300.0
            },
            {
                "product_id": product2_id,
                "quantity": 2  # 2 * 40.0 = 80.0
            }
        ],
        "payment_method": "card"
    }
    
    response = client.post("/api/v1/sales", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["total_amount"] == 380.0
    assert len(data["items"]) == 2
    
    # Verify stock deducted for both items
    p1 = client.get(f"/api/v1/products/{product1_id}", headers=headers).json()
    assert p1["current_stock"] == 47  # 50 - 3
    
    p2 = client.get(f"/api/v1/products/{product2_id}", headers=headers).json()
    assert p2["current_stock"] == 28  # 30 - 2

def test_insufficient_stock_fails_and_rollbacks():
    setup = get_auth_setup("overstock_sale@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]  # stock: 50
    
    payload = {
        "items": [
            {
                "product_id": product1_id,
                "quantity": 100  # requested > 50
            }
        ],
        "payment_method": "cash"
    }
    
    response = client.post("/api/v1/sales", json=payload, headers=headers)
    assert response.status_code == 400
    assert "Insufficient stock" in response.json()["detail"]
    
    # Verify stock remained at 50
    p1 = client.get(f"/api/v1/products/{product1_id}", headers=headers).json()
    assert p1["current_stock"] == 50

def test_invalid_product_fails_and_rollbacks():
    setup = get_auth_setup("invalid_sale_prod@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    fake_product_id = "00000000-0000-0000-0000-000000000000"
    
    payload = {
        "items": [
            {
                "product_id": product1_id,
                "quantity": 2
            },
            {
                "product_id": fake_product_id,
                "quantity": 1
            }
        ],
        "payment_method": "cash"
    }
    
    response = client.post("/api/v1/sales", json=payload, headers=headers)
    assert response.status_code == 400
    assert "not found or does not belong" in response.json()["detail"]
    
    # Verify product1 stock remained at 50 (atomic rollback)
    p1 = client.get(f"/api/v1/products/{product1_id}", headers=headers).json()
    assert p1["current_stock"] == 50

def test_get_sales_list_and_by_id():
    setup = get_auth_setup("get_sales@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    
    create_res = client.post("/api/v1/sales", json={
        "items": [{"product_id": product1_id, "quantity": 1}],
        "payment_method": "upi"
    }, headers=headers)
    sale_id = create_res.json()["id"]
    
    # List sales
    list_res = client.get("/api/v1/sales", headers=headers)
    assert list_res.status_code == 200
    data = list_res.json()
    assert data["total"] == 1
    
    # Get sale by ID
    get_res = client.get(f"/api/v1/sales/{sale_id}", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["id"] == sale_id
    assert get_res.json()["payment_method"] == "upi"

def test_unauthenticated_sale_access_fails():
    res1 = client.post("/api/v1/sales", json={
        "items": [{"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1}]
    })
    assert res1.status_code == 401
    
    res2 = client.get("/api/v1/sales")
    assert res2.status_code == 401
