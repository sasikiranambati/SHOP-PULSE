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

def setup_shop_with_catalog(email: str = "voiceowner@example.com"):
    # 1. Register & login
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Create Shop
    shop_res = client.post("/api/v1/shops", json={
        "shop_name": "Sri Krishna Kirana Store",
        "owner_name": "Krishna Rao",
        "business_type": "Grocery/Kirana",
        "location": "Ameerpet, Hyderabad"
    }, headers=headers)
    assert shop_res.status_code == 201
    shop_id = shop_res.json()["id"]

    # 3. Create Products with Initial Stocks
    # Product A: Tata Salt (Stock: 50, Price: 28.0)
    p_salt = client.post("/api/v1/products", json={
        "name": "Tata Salt 1kg",
        "category": "Staples",
        "selling_price": 28.0,
        "purchase_price": 22.0,
        "current_stock": 50,
        "unit": "pkt"
    }, headers=headers).json()

    # Product B: Parle-G (Stock: 100, Price: 10.0)
    p_parle = client.post("/api/v1/products", json={
        "name": "Parle-G",
        "category": "Biscuits",
        "selling_price": 10.0,
        "purchase_price": 8.0,
        "current_stock": 100,
        "unit": "pack"
    }, headers=headers).json()

    # Product C: Sona Masoori Rice (Stock: 30, Price: 65.0)
    p_rice = client.post("/api/v1/products", json={
        "name": "Sona Masoori Rice 1kg",
        "category": "Grains",
        "selling_price": 65.0,
        "purchase_price": 50.0,
        "current_stock": 30,
        "unit": "kg"
    }, headers=headers).json()

    return {
        "headers": headers,
        "shop_id": shop_id,
        "salt_id": p_salt["id"],
        "parle_id": p_parle["id"],
        "rice_id": p_rice["id"],
    }

def test_e2e_english_voice_to_bill_sales_and_inventory_deduction():
    """
    End-to-End Test: English Voice Input -> Voice Processing -> Sales Creation -> Stock Deduction
    """
    setup = setup_shop_with_catalog("e2e_en@example.com")
    headers = setup["headers"]
    salt_id = setup["salt_id"]
    parle_id = setup["parle_id"]

    # STEP 1: Process Voice Simulation
    voice_payload = {
        "simulation_text": "3 Tata Salt 1kg and 5 Parle-G",
        "language_code": "en-IN"
    }
    voice_resp = client.post("/api/v1/voice/process", json=voice_payload, headers=headers)
    assert voice_resp.status_code == 200
    voice_data = voice_resp.json()

    assert len(voice_data["matched_items"]) == 2
    matched_names = {item["name"]: item for item in voice_data["matched_items"]}
    assert "Tata Salt 1kg" in matched_names
    assert "Parle-G" in matched_names

    salt_item = matched_names["Tata Salt 1kg"]
    assert salt_item["quantity"] == 3
    assert salt_item["unit_price"] == 28.0
    assert salt_item["total_price"] == 84.0
    assert salt_item["is_insufficient_stock"] is False

    parle_item = matched_names["Parle-G"]
    assert parle_item["quantity"] == 5
    assert parle_item["unit_price"] == 10.0
    assert parle_item["total_price"] == 50.0

    expected_total = 84.0 + 50.0  # 134.0
    assert voice_data["subtotal"] == expected_total
    assert voice_data["total"] == expected_total

    # STEP 2: Submit Sales record directly using matched items from voice
    sales_payload = {
        "items": [
            {
                "product_id": item["product_id"],
                "quantity": item["quantity"],
                "unit_price": item["unit_price"]
            }
            for item in voice_data["matched_items"]
        ],
        "payment_method": "upi"
    }
    sale_resp = client.post("/api/v1/sales", json=sales_payload, headers=headers)
    assert sale_resp.status_code == 201
    sale_data = sale_resp.json()
    assert sale_data["total_amount"] == 134.0
    assert sale_data["payment_method"] == "upi"
    assert len(sale_data["items"]) == 2

    # STEP 3: Verify Inventory Deduction in the Database
    # Salt: was 50, sold 3 -> must be 47
    salt_prod = client.get(f"/api/v1/products/{salt_id}", headers=headers).json()
    assert salt_prod["current_stock"] == 47

    # Parle-G: was 100, sold 5 -> must be 95
    parle_prod = client.get(f"/api/v1/products/{parle_id}", headers=headers).json()
    assert parle_prod["current_stock"] == 95

def test_e2e_telugu_voice_to_bill_sales_and_inventory_deduction():
    """
    End-to-End Test: Telugu Spoken Input -> Voice Processing -> Sales Creation -> Stock Deduction
    'రెండు కిలోల బియ్యం' (2 kg Rice)
    """
    setup = setup_shop_with_catalog("e2e_te@example.com")
    headers = setup["headers"]
    rice_id = setup["rice_id"]

    # STEP 1: Process Telugu Voice Input
    voice_payload = {
        "simulation_text": "రెండు కిలోల బియ్యం",
        "language_code": "te-IN"
    }
    voice_resp = client.post("/api/v1/voice/process", json=voice_payload, headers=headers)
    assert voice_resp.status_code == 200
    voice_data = voice_resp.json()

    assert len(voice_data["matched_items"]) == 1
    matched = voice_data["matched_items"][0]
    assert matched["name"] == "Sona Masoori Rice 1kg"
    assert matched["quantity"] == 2
    assert matched["unit_price"] == 65.0
    assert matched["total_price"] == 130.0

    # STEP 2: Checkout / Complete Sale
    sales_payload = {
        "items": [
            {
                "product_id": matched["product_id"],
                "quantity": matched["quantity"],
                "unit_price": matched["unit_price"]
            }
        ],
        "payment_method": "cash"
    }
    sale_resp = client.post("/api/v1/sales", json=sales_payload, headers=headers)
    assert sale_resp.status_code == 201
    assert sale_resp.json()["total_amount"] == 130.0

    # STEP 3: Verify Inventory Deduction
    # Rice: was 30, sold 2 -> must be 28
    rice_prod = client.get(f"/api/v1/products/{rice_id}", headers=headers).json()
    assert rice_prod["current_stock"] == 28

def test_e2e_hindi_voice_to_bill_sales_and_inventory_deduction():
    """
    End-to-End Test: Hindi Spoken Input -> Voice Processing -> Sales Creation -> Stock Deduction
    'दो टाटा नमक' (2 Tata Salt)
    """
    setup = setup_shop_with_catalog("e2e_hi@example.com")
    headers = setup["headers"]
    salt_id = setup["salt_id"]

    # STEP 1: Process Hindi Voice Input
    voice_payload = {
        "simulation_text": "दो टाटा नमक",
        "language_code": "hi-IN"
    }
    voice_resp = client.post("/api/v1/voice/process", json=voice_payload, headers=headers)
    assert voice_resp.status_code == 200
    voice_data = voice_resp.json()

    assert len(voice_data["matched_items"]) == 1
    matched = voice_data["matched_items"][0]
    assert matched["name"] == "Tata Salt 1kg"
    assert matched["quantity"] == 2
    assert matched["unit_price"] == 28.0
    assert matched["total_price"] == 56.0

    # STEP 2: Complete Sale
    sales_payload = {
        "items": [
            {
                "product_id": matched["product_id"],
                "quantity": matched["quantity"],
                "unit_price": matched["unit_price"]
            }
        ],
        "payment_method": "cash"
    }
    sale_resp = client.post("/api/v1/sales", json=sales_payload, headers=headers)
    assert sale_resp.status_code == 201
    assert sale_resp.json()["total_amount"] == 56.0

    # STEP 3: Verify Inventory Deduction
    # Salt: was 50, sold 2 -> must be 48
    salt_prod = client.get(f"/api/v1/products/{salt_id}", headers=headers).json()
    assert salt_prod["current_stock"] == 48

def test_e2e_insufficient_stock_safeguard():
    """
    Verify that Voice Billing detects insufficient stock and Sales creation protects against overselling.
    """
    setup = setup_shop_with_catalog("e2e_oversell@example.com")
    headers = setup["headers"]
    rice_id = setup["rice_id"]

    # Initial Rice stock is 30. User asks for 35 units via voice.
    voice_payload = {
        "simulation_text": "35 Sona Masoori Rice",
        "language_code": "en-IN"
    }
    voice_resp = client.post("/api/v1/voice/process", json=voice_payload, headers=headers)
    assert voice_resp.status_code == 200
    voice_data = voice_resp.json()

    assert len(voice_data["matched_items"]) == 1
    matched = voice_data["matched_items"][0]
    assert matched["quantity"] == 35
    assert matched["is_insufficient_stock"] is True
    assert matched["available_stock"] == 30

    # Attempting to post sales with 35 units must be rejected with HTTP 400
    sales_payload = {
        "items": [
            {
                "product_id": matched["product_id"],
                "quantity": 35,
                "unit_price": matched["unit_price"]
            }
        ],
        "payment_method": "cash"
    }
    sale_resp = client.post("/api/v1/sales", json=sales_payload, headers=headers)
    assert sale_resp.status_code == 400
    assert "Insufficient stock" in sale_resp.json()["detail"]

    # Confirm stock was NOT changed (remains 30)
    rice_prod = client.get(f"/api/v1/products/{rice_id}", headers=headers).json()
    assert rice_prod["current_stock"] == 30
