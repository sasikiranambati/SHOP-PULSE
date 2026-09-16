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

def get_authenticated_headers(email: str = "shopowner@example.com") -> dict:
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create shop for user
    client.post("/api/v1/shops", json={
        "shop_name": "My Retail Shop",
        "owner_name": "Owner",
        "business_type": "Grocery/Kirana",
        "location": "Main Road"
    }, headers=headers)
    return headers

def test_create_product_success():
    headers = get_authenticated_headers("product_creator@example.com")
    payload = {
        "name": "Basmati Rice 5kg",
        "category": "Groceries",
        "selling_price": 450.0,
        "purchase_price": 380.0,
        "current_stock": 25,
        "reorder_level": 5,
        "unit": "pack",
        "sku": "RICE-5KG"
    }
    
    response = client.post("/api/v1/products", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Basmati Rice 5kg"
    assert data["category"] == "Groceries"
    assert data["selling_price"] == 450.0
    assert data["current_stock"] == 25
    assert "id" in data
    assert "shop_id" in data

def test_create_product_without_shop_fails():
    # User registered but no shop created
    client.post("/api/v1/auth/register", json={"email": "noshop@example.com", "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": "noshop@example.com", "password": "password123"})
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}
    
    payload = {
        "name": "Orphan Product",
        "selling_price": 100.0,
        "current_stock": 10
    }
    response = client.post("/api/v1/products", json=payload, headers=headers)
    assert response.status_code == 400
    assert "User must create a shop profile" in response.json()["detail"]

def test_create_product_negative_stock_or_price_fails():
    headers = get_authenticated_headers("negative_validation@example.com")
    
    # Negative stock
    payload1 = {
        "name": "Bad Stock Product",
        "selling_price": 100.0,
        "current_stock": -5
    }
    res1 = client.post("/api/v1/products", json=payload1, headers=headers)
    assert res1.status_code == 422
    
    # Negative price
    payload2 = {
        "name": "Bad Price Product",
        "selling_price": -50.0,
        "current_stock": 10
    }
    res2 = client.post("/api/v1/products", json=payload2, headers=headers)
    assert res2.status_code == 422

def test_get_products_list_pagination_and_filters():
    headers = get_authenticated_headers("list_products@example.com")
    
    products = [
        {"name": "Whole Milk 1L", "category": "Dairy", "selling_price": 60.0, "current_stock": 50},
        {"name": "Skimmed Milk 1L", "category": "Dairy", "selling_price": 55.0, "current_stock": 30},
        {"name": "White Bread", "category": "Bakery", "selling_price": 40.0, "current_stock": 15},
        {"name": "Brown Bread", "category": "Bakery", "selling_price": 45.0, "current_stock": 20},
    ]
    for p in products:
        client.post("/api/v1/products", json=p, headers=headers)
        
    # Get all products
    res_all = client.get("/api/v1/products", headers=headers)
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert data_all["total"] == 4
    assert len(data_all["items"]) == 4
    
    # Filter by category
    res_dairy = client.get("/api/v1/products?category=Dairy", headers=headers)
    assert res_dairy.status_code == 200
    assert res_dairy.json()["total"] == 2
    
    # Search by name
    res_search = client.get("/api/v1/products?search=Bread", headers=headers)
    assert res_search.status_code == 200
    assert res_search.json()["total"] == 2
    
    # Test pagination (limit 2)
    res_page = client.get("/api/v1/products?skip=0&limit=2", headers=headers)
    assert res_page.status_code == 200
    assert len(res_page.json()["items"]) == 2
    assert res_page.json()["total"] == 4

def test_get_product_by_id():
    headers = get_authenticated_headers("get_id@example.com")
    create_res = client.post("/api/v1/products", json={
        "name": "Apple Crisp",
        "category": "Snacks",
        "selling_price": 25.0,
        "current_stock": 100
    }, headers=headers)
    product_id = create_res.json()["id"]
    
    response = client.get(f"/api/v1/products/{product_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Apple Crisp"

def test_update_product_success():
    headers = get_authenticated_headers("update_prod@example.com")
    create_res = client.post("/api/v1/products", json={
        "name": "Old Soda 500ml",
        "selling_price": 30.0,
        "current_stock": 10
    }, headers=headers)
    product_id = create_res.json()["id"]
    
    update_payload = {
        "name": "New Soda 500ml",
        "selling_price": 35.0,
        "current_stock": 50
    }
    update_res = client.put(f"/api/v1/products/{product_id}", json=update_payload, headers=headers)
    assert update_res.status_code == 200
    data = update_res.json()
    assert data["name"] == "New Soda 500ml"
    assert data["selling_price"] == 35.0
    assert data["current_stock"] == 50

def test_delete_product_success():
    headers = get_authenticated_headers("delete_prod@example.com")
    create_res = client.post("/api/v1/products", json={
        "name": "Item to Delete",
        "selling_price": 10.0,
        "current_stock": 1
    }, headers=headers)
    product_id = create_res.json()["id"]
    
    del_res = client.delete(f"/api/v1/products/{product_id}", headers=headers)
    assert del_res.status_code == 204
    
    # Confirm deletion
    get_res = client.get(f"/api/v1/products/{product_id}", headers=headers)
    assert get_res.status_code == 404

def test_access_other_shops_product_fails():
    headers1 = get_authenticated_headers("owner1@example.com")
    headers2 = get_authenticated_headers("owner2@example.com")
    
    # Owner 1 creates product
    create_res = client.post("/api/v1/products", json={
        "name": "Owner 1 Secret Item",
        "selling_price": 99.0,
        "current_stock": 5
    }, headers=headers1)
    product_id = create_res.json()["id"]
    
    # Owner 2 tries to view, update, or delete Owner 1's product
    get_res = client.get(f"/api/v1/products/{product_id}", headers=headers2)
    assert get_res.status_code == 403
    
    put_res = client.put(f"/api/v1/products/{product_id}", json={"selling_price": 1.0}, headers=headers2)
    assert put_res.status_code == 403
    
    del_res = client.delete(f"/api/v1/products/{product_id}", headers=headers2)
    assert del_res.status_code == 403

def test_unauthenticated_access_fails():
    res1 = client.post("/api/v1/products", json={"name": "Anon Product", "selling_price": 10.0})
    assert res1.status_code == 401
    
    res2 = client.get("/api/v1/products")
    assert res2.status_code == 401
    
    fake_id = "00000000-0000-0000-0000-000000000000"
    res3 = client.get(f"/api/v1/products/{fake_id}")
    assert res3.status_code == 401
