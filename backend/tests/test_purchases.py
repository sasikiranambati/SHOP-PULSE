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

def get_auth_setup(email: str = "purchaser@example.com"):
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create shop
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Stock Shop",
        "owner_name": "Stock Manager",
        "business_type": "Grocery/Kirana",
        "location": "Warehouse District"
    }, headers=headers)
    shop_id = shop_res.json()["id"]
    
    # Create supplier
    sup_res = client.post("/api/v1/suppliers", json={
        "supplier_name": "Primary Supplier",
        "phone": "123-456-7890"
    }, headers=headers)
    supplier_id = sup_res.json()["id"]
    
    # Create product 1
    p1_res = client.post("/api/v1/products", json={
        "name": "Wheat Flour 10kg",
        "category": "Grains",
        "selling_price": 350.0,
        "purchase_price": 300.0,
        "current_stock": 10
    }, headers=headers)
    product1_id = p1_res.json()["id"]
    
    # Create product 2
    p2_res = client.post("/api/v1/products", json={
        "name": "Sunflower Oil 1L",
        "category": "Oils",
        "selling_price": 150.0,
        "purchase_price": 120.0,
        "current_stock": 20
    }, headers=headers)
    product2_id = p2_res.json()["id"]
    
    return {
        "headers": headers,
        "shop_id": shop_id,
        "supplier_id": supplier_id,
        "product1_id": product1_id,
        "product2_id": product2_id
    }

def test_single_product_purchase_success():
    setup = get_auth_setup("single_purchase@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    supplier_id = setup["supplier_id"]
    
    payload = {
        "supplier_id": supplier_id,
        "items": [
            {
                "product_id": product1_id,
                "quantity": 100,
                "purchase_price": 280.0
            }
        ]
    }
    
    response = client.post("/api/v1/purchases", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["supplier_id"] == supplier_id
    assert data["total_amount"] == 28000.0  # 100 * 280
    assert len(data["items"]) == 1
    assert data["items"][0]["quantity"] == 100
    assert data["items"][0]["purchase_price"] == 280.0
    
    # Verify product stock increased from 10 to 110
    prod_res = client.get(f"/api/v1/products/{product1_id}", headers=headers)
    assert prod_res.status_code == 200
    assert prod_res.json()["current_stock"] == 110
    assert prod_res.json()["purchase_price"] == 280.0

def test_multiple_product_purchase_success():
    setup = get_auth_setup("multi_purchase@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    product2_id = setup["product2_id"]
    supplier_id = setup["supplier_id"]
    
    payload = {
        "supplier_id": supplier_id,
        "items": [
            {
                "product_id": product1_id,
                "quantity": 50,
                "purchase_price": 290.0
            },
            {
                "product_id": product2_id,
                "quantity": 40,
                "purchase_price": 115.0
            }
        ]
    }
    
    response = client.post("/api/v1/purchases", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    expected_total = (50 * 290.0) + (40 * 115.0)  # 14500 + 4600 = 19100.0
    assert data["total_amount"] == expected_total
    assert len(data["items"]) == 2
    
    # Check inventory increase
    p1 = client.get(f"/api/v1/products/{product1_id}", headers=headers).json()
    assert p1["current_stock"] == 60  # 10 initial + 50
    
    p2 = client.get(f"/api/v1/products/{product2_id}", headers=headers).json()
    assert p2["current_stock"] == 60  # 20 initial + 40

def test_invalid_supplier_fails_and_rollbacks():
    setup = get_auth_setup("invalid_sup@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    fake_supplier_id = "00000000-0000-0000-0000-000000000000"
    
    payload = {
        "supplier_id": fake_supplier_id,
        "items": [
            {
                "product_id": product1_id,
                "quantity": 50,
                "purchase_price": 250.0
            }
        ]
    }
    
    response = client.post("/api/v1/purchases", json=payload, headers=headers)
    assert response.status_code == 400
    assert "Supplier not found" in response.json()["detail"]
    
    # Verify stock remained untouched (10)
    p1 = client.get(f"/api/v1/products/{product1_id}", headers=headers).json()
    assert p1["current_stock"] == 10

def test_invalid_product_fails_and_rollbacks():
    setup = get_auth_setup("invalid_prod@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    fake_product_id = "00000000-0000-0000-0000-000000000000"
    
    payload = {
        "items": [
            {
                "product_id": product1_id,
                "quantity": 50,
                "purchase_price": 250.0
            },
            {
                "product_id": fake_product_id,
                "quantity": 10,
                "purchase_price": 100.0
            }
        ]
    }
    
    response = client.post("/api/v1/purchases", json=payload, headers=headers)
    assert response.status_code == 400
    assert "not found or does not belong" in response.json()["detail"]
    
    # Verify atomic rollback: product1 stock must NOT have increased
    p1 = client.get(f"/api/v1/products/{product1_id}", headers=headers).json()
    assert p1["current_stock"] == 10

def test_get_purchases_list_and_by_id():
    setup = get_auth_setup("get_purchases@example.com")
    headers = setup["headers"]
    product1_id = setup["product1_id"]
    
    client.post("/api/v1/purchases", json={
        "items": [{"product_id": product1_id, "quantity": 15, "purchase_price": 100.0}]
    }, headers=headers)
    
    # List purchases
    list_res = client.get("/api/v1/purchases", headers=headers)
    assert list_res.status_code == 200
    data = list_res.json()
    assert data["total"] == 1
    purchase_id = data["items"][0]["id"]
    
    # Get by ID
    get_res = client.get(f"/api/v1/purchases/{purchase_id}", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["id"] == purchase_id

def test_unauthenticated_purchase_access_fails():
    res1 = client.post("/api/v1/purchases", json={
        "items": [{"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "purchase_price": 10.0}]
    })
    assert res1.status_code == 401
    
    res2 = client.get("/api/v1/purchases")
    assert res2.status_code == 401
