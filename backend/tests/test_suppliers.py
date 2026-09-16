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

def get_authenticated_headers(email: str = "supplierowner@example.com") -> dict:
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create shop for user
    client.post("/api/v1/shops", json={
        "shop_name": "Supplier Shop",
        "owner_name": "Shop Owner",
        "business_type": "Grocery/Kirana",
        "location": "Market Street"
    }, headers=headers)
    return headers

def test_create_supplier_success():
    headers = get_authenticated_headers("create_sup@example.com")
    payload = {
        "supplier_name": "Metro Wholesale Traders",
        "phone": "+91 9876543210",
        "address": "45 Commercial Hub, Industrial Area"
    }
    
    response = client.post("/api/v1/suppliers", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["supplier_name"] == "Metro Wholesale Traders"
    assert data["phone"] == "+91 9876543210"
    assert data["address"] == "45 Commercial Hub, Industrial Area"
    assert "id" in data
    assert "shop_id" in data

def test_create_supplier_without_shop_fails():
    client.post("/api/v1/auth/register", json={"email": "noshopprof@example.com", "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": "noshopprof@example.com", "password": "password123"})
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}
    
    payload = {
        "supplier_name": "Orphan Supplier"
    }
    response = client.post("/api/v1/suppliers", json=payload, headers=headers)
    assert response.status_code == 400
    assert "User must create a shop profile" in response.json()["detail"]

def test_get_suppliers_list_pagination_and_search():
    headers = get_authenticated_headers("list_sup@example.com")
    
    suppliers = [
        {"supplier_name": "Alpha Distributors", "phone": "111-222-3333"},
        {"supplier_name": "Apex Food Suppliers", "phone": "444-555-6666"},
        {"supplier_name": "Beta Pharma Logistics", "phone": "777-888-9999"},
    ]
    for s in suppliers:
        client.post("/api/v1/suppliers", json=s, headers=headers)
        
    # Get all suppliers
    res_all = client.get("/api/v1/suppliers", headers=headers)
    assert res_all.status_code == 200
    assert res_all.json()["total"] == 3
    
    # Search by supplier name
    res_search = client.get("/api/v1/suppliers?search=Alpha", headers=headers)
    assert res_search.status_code == 200
    assert res_search.json()["total"] == 1
    assert res_search.json()["items"][0]["supplier_name"] == "Alpha Distributors"
    
    # Test pagination (skip=0, limit=2)
    res_page = client.get("/api/v1/suppliers?skip=0&limit=2", headers=headers)
    assert res_page.status_code == 200
    assert len(res_page.json()["items"]) == 2
    assert res_page.json()["total"] == 3

def test_get_supplier_by_id():
    headers = get_authenticated_headers("get_sup_id@example.com")
    create_res = client.post("/api/v1/suppliers", json={
        "supplier_name": "Global Tech Suppliers",
        "phone": "555-1234"
    }, headers=headers)
    supplier_id = create_res.json()["id"]
    
    response = client.get(f"/api/v1/suppliers/{supplier_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["supplier_name"] == "Global Tech Suppliers"

def test_update_supplier_success():
    headers = get_authenticated_headers("edit_sup@example.com")
    create_res = client.post("/api/v1/suppliers", json={
        "supplier_name": "Old Supplier Name",
        "phone": "000-0000"
    }, headers=headers)
    supplier_id = create_res.json()["id"]
    
    update_payload = {
        "supplier_name": "Updated Supplier Name",
        "phone": "111-9999",
        "address": "New Office Location"
    }
    update_res = client.put(f"/api/v1/suppliers/{supplier_id}", json=update_payload, headers=headers)
    assert update_res.status_code == 200
    data = update_res.json()
    assert data["supplier_name"] == "Updated Supplier Name"
    assert data["phone"] == "111-9999"
    assert data["address"] == "New Office Location"

def test_delete_supplier_success():
    headers = get_authenticated_headers("del_sup@example.com")
    create_res = client.post("/api/v1/suppliers", json={
        "supplier_name": "Supplier to Remove"
    }, headers=headers)
    supplier_id = create_res.json()["id"]
    
    del_res = client.delete(f"/api/v1/suppliers/{supplier_id}", headers=headers)
    assert del_res.status_code == 204
    
    # Confirm deletion
    get_res = client.get(f"/api/v1/suppliers/{supplier_id}", headers=headers)
    assert get_res.status_code == 404

def test_access_other_shops_supplier_fails():
    headers1 = get_authenticated_headers("sup_owner1@example.com")
    headers2 = get_authenticated_headers("sup_owner2@example.com")
    
    # Owner 1 creates supplier
    create_res = client.post("/api/v1/suppliers", json={
        "supplier_name": "Owner 1 Exclusive Supplier"
    }, headers=headers1)
    supplier_id = create_res.json()["id"]
    
    # Owner 2 attempts to view, edit, or delete Owner 1's supplier
    get_res = client.get(f"/api/v1/suppliers/{supplier_id}", headers=headers2)
    assert get_res.status_code == 403
    
    put_res = client.put(f"/api/v1/suppliers/{supplier_id}", json={"supplier_name": "Hacked Name"}, headers=headers2)
    assert put_res.status_code == 403
    
    del_res = client.delete(f"/api/v1/suppliers/{supplier_id}", headers=headers2)
    assert del_res.status_code == 403

def test_unauthenticated_supplier_access_fails():
    res1 = client.post("/api/v1/suppliers", json={"supplier_name": "Anon Supplier"})
    assert res1.status_code == 401
    
    res2 = client.get("/api/v1/suppliers")
    assert res2.status_code == 401
    
    fake_id = "00000000-0000-0000-0000-000000000000"
    res3 = client.get(f"/api/v1/suppliers/{fake_id}")
    assert res3.status_code == 401
