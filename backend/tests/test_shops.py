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

def get_auth_token(email: str = "owner@example.com", password: str = "password123") -> str:
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    return login_res.json()["access_token"]

def test_create_shop_success():
    token = get_auth_token("create_shop@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    
    payload = {
        "shop_name": "Corner Grocery",
        "owner_name": "John Doe",
        "business_type": "Grocery/Kirana",
        "location": "123 Main Street"
    }
    
    response = client.post("/api/v1/shops", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["shop_name"] == "Corner Grocery"
    assert data["owner_name"] == "John Doe"
    assert data["business_type"] == "Grocery/Kirana"
    assert data["location"] == "123 Main Street"
    assert "id" in data
    assert "owner_id" in data

def test_create_duplicate_shop_fails():
    token = get_auth_token("duplicate_shop@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    
    payload = {
        "shop_name": "First Shop",
        "owner_name": "John Doe",
        "business_type": "Bakery",
        "location": "Downtown"
    }
    
    res1 = client.post("/api/v1/shops", json=payload, headers=headers)
    assert res1.status_code == 201
    
    payload2 = {
        "shop_name": "Second Shop",
        "owner_name": "John Doe",
        "business_type": "Sweet Shop",
        "location": "Uptown"
    }
    res2 = client.post("/api/v1/shops", json=payload2, headers=headers)
    assert res2.status_code == 400
    assert res2.json()["detail"] == "User already has a shop profile."

def test_create_shop_invalid_business_type():
    token = get_auth_token("invalid_bt@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    
    payload = {
        "shop_name": "Invalid Shop",
        "owner_name": "Jane Doe",
        "business_type": "Space Exploration",
        "location": "Mars"
    }
    response = client.post("/api/v1/shops", json=payload, headers=headers)
    assert response.status_code == 422

def test_get_my_shop_success():
    token = get_auth_token("get_shop@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    
    create_payload = {
        "shop_name": "City Pharmacy",
        "owner_name": "Alice Smith",
        "business_type": "Medical/Pharmacy",
        "location": "Health Ave"
    }
    client.post("/api/v1/shops", json=create_payload, headers=headers)
    
    response = client.get("/api/v1/shops/me", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["shop_name"] == "City Pharmacy"
    assert data["business_type"] == "Medical/Pharmacy"

def test_get_my_shop_not_found():
    token = get_auth_token("no_shop@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    
    response = client.get("/api/v1/shops/me", headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Shop profile not found for current user."

def test_update_shop_success():
    token = get_auth_token("update_shop@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    
    create_payload = {
        "shop_name": "Old Tech Store",
        "owner_name": "Bob Martin",
        "business_type": "Hardware Store",
        "location": "Industrial Area"
    }
    create_res = client.post("/api/v1/shops", json=create_payload, headers=headers)
    shop_id = create_res.json()["id"]
    
    update_payload = {
        "shop_name": "Modern Tech Store",
        "business_type": "Mobile & Electronics Accessories"
    }
    update_res = client.put(f"/api/v1/shops/{shop_id}", json=update_payload, headers=headers)
    assert update_res.status_code == 200
    updated_data = update_res.json()
    assert updated_data["shop_name"] == "Modern Tech Store"
    assert updated_data["business_type"] == "Mobile & Electronics Accessories"
    assert updated_data["owner_name"] == "Bob Martin"

def test_update_other_users_shop_fails():
    token1 = get_auth_token("user1@example.com")
    token2 = get_auth_token("user2@example.com")
    
    headers1 = {"Authorization": f"Bearer {token1}"}
    headers2 = {"Authorization": f"Bearer {token2}"}
    
    create_res = client.post(
        "/api/v1/shops",
        json={
            "shop_name": "User 1 Shop",
            "owner_name": "User 1",
            "business_type": "Bakery"
        },
        headers=headers1
    )
    shop_id = create_res.json()["id"]
    
    # User 2 attempts to update User 1's shop
    update_res = client.put(
        f"/api/v1/shops/{shop_id}",
        json={"shop_name": "Hacked Shop Name"},
        headers=headers2
    )
    assert update_res.status_code == 403
    assert update_res.json()["detail"] == "Not authorized to update this shop."

def test_update_non_existent_shop_fails():
    token = get_auth_token("non_existent@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    fake_uuid = "00000000-0000-0000-0000-000000000000"
    
    update_res = client.put(
        f"/api/v1/shops/{fake_uuid}",
        json={"shop_name": "New Name"},
        headers=headers
    )
    assert update_res.status_code == 404
    assert update_res.json()["detail"] == "Shop not found."

def test_unauthorized_access_fails():
    res1 = client.post("/api/v1/shops", json={
        "shop_name": "Anon Shop",
        "owner_name": "Anon",
        "business_type": "Bakery"
    })
    assert res1.status_code == 401
    
    res2 = client.get("/api/v1/shops/me")
    assert res2.status_code == 401
    
    fake_uuid = "00000000-0000-0000-0000-000000000000"
    res3 = client.put(f"/api/v1/shops/{fake_uuid}", json={"shop_name": "New Name"})
    assert res3.status_code == 401
