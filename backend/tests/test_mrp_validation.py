"""
Stage 4C.1 Remediation Step 3: Universal MRP Validation and Price Integrity Tests.

Verifies all 20 required MRP validation scenarios:
1. Selling price below MRP (Allowed)
2. Selling price equal to MRP (Allowed)
3. Selling price above MRP (Rejected)
4. Package MRP compared with per-unit selling price (10kg pack MRP ₹1000 vs ₹95/kg SP)
5. Kilogram and gram conversions (500g vs 1kg MRP)
6. Litre and millilitre conversions (250ml vs 1L MRP)
7. Package-size normalization
8. Missing MRP (Allowed for un-packaged / loose goods)
9. Missing MRP basis (Defaults safely to price basis)
10. Incompatible unit families (kg vs L rejected)
11. MRP reduction below existing selling price (Rejected)
12. Product creation validation (Rejects SP > MRP)
13. Product update validation (Rejects SP > MRP)
14. Invoice confirmation validation (Rejects SP > MRP on restock and new products)
15. Manager selling-price override validation (Manager cannot override SP above MRP)
16. Cashier attempting to bypass MRP (Rejected)
17. Manual POS checkout validation (Rejects checkout if SP exceeds MRP)
18. Voice-to-Bill checkout validation (Rejects spoken price exceeding MRP)
19. Client-supplied MRP manipulation (Client cannot lower or forge MRP)
20. Transaction rollback on validation failure (Zero database mutations on error)
"""

from decimal import Decimal
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from db.session import Base
from db.models.user import User
from db.models.shop import Shop
from db.models.shop_member import ShopMember, ShopRole
from db.models.product import Product
from db.models.purchase import Purchase
from db.models.pricing_audit_log import PricingAuditLog
from api.deps import get_db
from core.security import get_password_hash, create_access_token

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


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    # Set per test (other modules install their own override at import; the last import would win)
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    if previous is None:
        app.dependency_overrides.pop(get_db, None)
    else:
        app.dependency_overrides[get_db] = previous


@pytest.fixture
def test_data():
    db = TestingSessionLocal()
    try:
        # 1. Create Owner User
        owner_id = uuid.uuid4()
        owner = User(
            id=owner_id,
            email="owner@test.com",
            hashed_password=get_password_hash("password123"),
            is_active=True,
        )
        db.add(owner)

        # 2. Create Manager User
        manager_id = uuid.uuid4()
        manager = User(
            id=manager_id,
            email="manager@test.com",
            hashed_password=get_password_hash("password123"),
            is_active=True,
        )
        db.add(manager)

        # 3. Create Cashier User
        cashier_id = uuid.uuid4()
        cashier = User(
            id=cashier_id,
            email="cashier@test.com",
            hashed_password=get_password_hash("password123"),
            is_active=True,
        )
        db.add(cashier)

        # 4. Create Shop
        shop_id = uuid.uuid4()
        shop = Shop(
            id=shop_id,
            shop_name="MRP Test Grocery",
            owner_name="Test Owner",
            business_type="Retail",
            owner_id=owner_id,
        )
        db.add(shop)

        # 5. Memberships
        db.add(ShopMember(shop_id=shop_id, user_id=owner_id, role=ShopRole.OWNER.value, is_active=True))
        db.add(ShopMember(shop_id=shop_id, user_id=manager_id, role=ShopRole.MANAGER.value, is_active=True))
        db.add(ShopMember(shop_id=shop_id, user_id=cashier_id, role=ShopRole.CASHIER.value, is_active=True))

        db.commit()

        owner_token = create_access_token(subject=str(owner_id))
        manager_token = create_access_token(subject=str(manager_id))
        cashier_token = create_access_token(subject=str(cashier_id))

        return {
            "shop_id": shop_id,
            "owner": owner,
            "manager": manager,
            "cashier": cashier,
            "owner_headers": {"Authorization": f"Bearer {owner_token}"},
            "manager_headers": {"Authorization": f"Bearer {manager_token}"},
            "cashier_headers": {"Authorization": f"Bearer {cashier_token}"},
        }
    finally:
        db.close()


# -----------------------------------------------------------------------------
# 1. Selling price below MRP (Allowed)
# -----------------------------------------------------------------------------
def test_01_selling_price_below_mrp_allowed(test_data):
    """Selling price ₹95/kg, MRP ₹100/kg -> Allowed."""
    payload = {
        "name": "Basmati Rice 1kg",
        "selling_price": 95.0,
        "mrp": 100.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "mrp_basis_quantity": 1.0,
        "mrp_basis_unit": "kg",
        "unit": "kg",
        "current_stock": 50.0,
    }
    res = client.post("/api/v1/products", json=payload, headers=test_data["manager_headers"])
    assert res.status_code == 201
    data = res.json()
    assert data["selling_price"] == 95.0
    assert data["mrp"] == 100.0


# -----------------------------------------------------------------------------
# 2. Selling price equal to MRP (Allowed)
# -----------------------------------------------------------------------------
def test_02_selling_price_equal_to_mrp_allowed(test_data):
    """Selling price ₹100/kg, MRP ₹100/kg -> Allowed."""
    payload = {
        "name": "Sona Masoori Rice 1kg",
        "selling_price": 100.0,
        "mrp": 100.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "unit": "kg",
        "current_stock": 30.0,
    }
    res = client.post("/api/v1/products", json=payload, headers=test_data["manager_headers"])
    assert res.status_code == 201
    assert res.json()["selling_price"] == 100.0


# -----------------------------------------------------------------------------
# 3. Selling price above MRP (Rejected)
# -----------------------------------------------------------------------------
def test_03_selling_price_above_mrp_rejected(test_data):
    """Selling price ₹110/kg, MRP ₹100/kg -> Rejected (400 Bad Request)."""
    payload = {
        "name": "Overpriced Sugar",
        "selling_price": 110.0,
        "mrp": 100.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "unit": "kg",
        "current_stock": 20.0,
    }
    res = client.post("/api/v1/products", json=payload, headers=test_data["manager_headers"])
    assert res.status_code == 400
    assert "exceeds statutory MRP ceiling" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 4. Package MRP compared with per-unit selling price (10kg pack MRP ₹1000 vs ₹95/kg SP)
# -----------------------------------------------------------------------------
def test_04_package_mrp_compared_with_per_unit_selling_price(test_data):
    """10kg pack MRP ₹1000:
       - Selling price ₹95/kg (₹950 for 10kg) -> Allowed.
       - Selling price ₹105/kg (₹1050 for 10kg) -> Rejected.
    """
    # Allowed
    payload_ok = {
        "name": "10kg Rice Bag - Fair",
        "selling_price": 95.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "mrp": 1000.0,
        "mrp_basis_quantity": 10.0,
        "mrp_basis_unit": "kg",
        "unit": "kg",
        "current_stock": 100.0,
    }
    res_ok = client.post("/api/v1/products", json=payload_ok, headers=test_data["manager_headers"])
    assert res_ok.status_code == 201

    # Rejected
    payload_bad = {
        "name": "10kg Rice Bag - Excessive",
        "selling_price": 105.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "mrp": 1000.0,
        "mrp_basis_quantity": 10.0,
        "mrp_basis_unit": "kg",
        "unit": "kg",
        "current_stock": 100.0,
    }
    res_bad = client.post("/api/v1/products", json=payload_bad, headers=test_data["manager_headers"])
    assert res_bad.status_code == 400
    assert "exceeds statutory MRP ceiling" in res_bad.json()["detail"]


# -----------------------------------------------------------------------------
# 5. Kilogram and gram conversions (500g vs 1kg MRP)
# -----------------------------------------------------------------------------
def test_05_kilogram_and_gram_conversions(test_data):
    """MRP ₹100 for 1kg:
       - SP ₹45 for 500g (effective ₹90/kg) -> Allowed.
       - SP ₹55 for 500g (effective ₹110/kg) -> Rejected.
    """
    # Allowed
    res_ok = client.post("/api/v1/products", json={
        "name": "Garam Masala 500g - Fair",
        "selling_price": 45.0,
        "price_basis_quantity": 500.0,
        "price_basis_unit": "g",
        "mrp": 100.0,
        "mrp_basis_quantity": 1.0,
        "mrp_basis_unit": "kg",
        "unit": "g",
        "current_stock": 5000.0,
    }, headers=test_data["manager_headers"])
    assert res_ok.status_code == 201

    # Rejected
    res_bad = client.post("/api/v1/products", json={
        "name": "Garam Masala 500g - Over",
        "selling_price": 55.0,
        "price_basis_quantity": 500.0,
        "price_basis_unit": "g",
        "mrp": 100.0,
        "mrp_basis_quantity": 1.0,
        "mrp_basis_unit": "kg",
        "unit": "g",
        "current_stock": 5000.0,
    }, headers=test_data["manager_headers"])
    assert res_bad.status_code == 400
    assert "exceeds statutory MRP ceiling" in res_bad.json()["detail"]


# -----------------------------------------------------------------------------
# 6. Litre and millilitre conversions (250ml vs 1L MRP)
# -----------------------------------------------------------------------------
def test_06_litre_and_millilitre_conversions(test_data):
    """MRP ₹130 for 1L:
       - SP ₹30 for 250ml (effective ₹120/L) -> Allowed.
       - SP ₹40 for 250ml (effective ₹160/L) -> Rejected.
    """
    # Allowed
    res_ok = client.post("/api/v1/products", json={
        "name": "Mustard Oil 250ml - Fair",
        "selling_price": 30.0,
        "price_basis_quantity": 250.0,
        "price_basis_unit": "ml",
        "mrp": 130.0,
        "mrp_basis_quantity": 1.0,
        "mrp_basis_unit": "L",
        "unit": "ml",
        "current_stock": 2500.0,
    }, headers=test_data["manager_headers"])
    assert res_ok.status_code == 201

    # Rejected
    res_bad = client.post("/api/v1/products", json={
        "name": "Mustard Oil 250ml - Over",
        "selling_price": 40.0,
        "price_basis_quantity": 250.0,
        "price_basis_unit": "ml",
        "mrp": 130.0,
        "mrp_basis_quantity": 1.0,
        "mrp_basis_unit": "L",
        "unit": "ml",
        "current_stock": 2500.0,
    }, headers=test_data["manager_headers"])
    assert res_bad.status_code == 400
    assert "exceeds statutory MRP ceiling" in res_bad.json()["detail"]


# -----------------------------------------------------------------------------
# 7. Package-size normalization
# -----------------------------------------------------------------------------
def test_07_package_size_normalization(test_data):
    """2kg container MRP ₹200 (₹100/kg):
       - SP ₹98 for 1kg -> Allowed.
       - SP ₹102 for 1kg -> Rejected.
    """
    res_ok = client.post("/api/v1/products", json={
        "name": "Ghee 1kg - Fair",
        "selling_price": 98.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "mrp": 200.0,
        "mrp_basis_quantity": 2.0,
        "mrp_basis_unit": "kg",
        "unit": "kg",
        "current_stock": 20.0,
    }, headers=test_data["manager_headers"])
    assert res_ok.status_code == 201

    res_bad = client.post("/api/v1/products", json={
        "name": "Ghee 1kg - Over",
        "selling_price": 102.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "mrp": 200.0,
        "mrp_basis_quantity": 2.0,
        "mrp_basis_unit": "kg",
        "unit": "kg",
        "current_stock": 20.0,
    }, headers=test_data["manager_headers"])
    assert res_bad.status_code == 400


# -----------------------------------------------------------------------------
# 8. Missing MRP (Allowed for un-packaged / loose goods)
# -----------------------------------------------------------------------------
def test_08_missing_mrp_allowed_for_loose_goods(test_data):
    """Un-packaged loose commodity with no statutory MRP: Allowed."""
    res = client.post("/api/v1/products", json={
        "name": "Loose Potatoes",
        "selling_price": 25.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "mrp": None,
        "unit": "kg",
        "current_stock": 100.0,
    }, headers=test_data["manager_headers"])
    assert res.status_code == 201
    assert res.json()["mrp"] is None


# -----------------------------------------------------------------------------
# 9. Missing MRP basis (Defaults safely to price basis)
# -----------------------------------------------------------------------------
def test_09_missing_mrp_basis_defaults_safely(test_data):
    """When mrp_basis_quantity / mrp_basis_unit are omitted, defaults to price basis."""
    res = client.post("/api/v1/products", json={
        "name": "Atta 5kg",
        "selling_price": 220.0,
        "price_basis_quantity": 5.0,
        "price_basis_unit": "kg",
        "mrp": 250.0,
        "mrp_basis_quantity": None,
        "mrp_basis_unit": None,
        "unit": "kg",
        "current_stock": 50.0,
    }, headers=test_data["manager_headers"])
    assert res.status_code == 201
    data = res.json()
    assert data["mrp_basis_quantity"] == 5.0
    assert data["mrp_basis_unit"] == "kg"


# -----------------------------------------------------------------------------
# 10. Incompatible unit families (kg vs L rejected)
# -----------------------------------------------------------------------------
def test_10_incompatible_unit_families_rejected(test_data):
    """Attempting to define selling price in kg and MRP in Litres -> Rejected (400)."""
    res = client.post("/api/v1/products", json={
        "name": "Cross Family Mixup",
        "selling_price": 100.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "mrp": 120.0,
        "mrp_basis_quantity": 1.0,
        "mrp_basis_unit": "L",
        "unit": "kg",
        "current_stock": 10.0,
    }, headers=test_data["manager_headers"])
    assert res.status_code == 400
    assert "Incompatible unit families" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 11. MRP reduction below existing selling price (Rejected)
# -----------------------------------------------------------------------------
def test_11_mrp_reduction_below_existing_selling_price_rejected(test_data):
    """Existing product has SP ₹95/kg, MRP ₹100/kg.
       Updating MRP to ₹90/kg without changing SP -> Rejected (400).
       Updating both SP to ₹85/kg and MRP to ₹90/kg -> Allowed (200).
    """
    # Create product
    create_res = client.post("/api/v1/products", json={
        "name": "Toor Dal Premium",
        "selling_price": 95.0,
        "mrp": 100.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "unit": "kg",
        "current_stock": 40.0,
    }, headers=test_data["manager_headers"])
    prod_id = create_res.json()["id"]

    # Reject lowering MRP below current selling price
    update_res = client.put(f"/api/v1/products/{prod_id}", json={
        "mrp": 90.0,
    }, headers=test_data["manager_headers"])
    assert update_res.status_code == 400
    assert "MRP reduction to ₹90" in update_res.json()["detail"]

    # Allowed when both SP and MRP are updated together
    update_res_ok = client.put(f"/api/v1/products/{prod_id}", json={
        "selling_price": 85.0,
        "mrp": 90.0,
    }, headers=test_data["manager_headers"])
    assert update_res_ok.status_code == 200
    assert update_res_ok.json()["selling_price"] == 85.0
    assert update_res_ok.json()["mrp"] == 90.0


# -----------------------------------------------------------------------------
# 12. Product creation validation (Rejects SP > MRP)
# -----------------------------------------------------------------------------
def test_12_product_creation_validation_rejects_sp_exceeding_mrp(test_data):
    """Direct product creation with SP ₹500 and MRP ₹450 is rejected."""
    res = client.post("/api/v1/products", json={
        "name": "Illegal Olive Oil",
        "selling_price": 500.0,
        "mrp": 450.0,
        "unit": "L",
        "current_stock": 10.0,
    }, headers=test_data["manager_headers"])
    assert res.status_code == 400
    assert "exceeds statutory MRP ceiling" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 13. Product update validation (Rejects SP > MRP)
# -----------------------------------------------------------------------------
def test_13_product_update_validation_rejects_sp_exceeding_mrp(test_data):
    """Existing product with MRP ₹150. Updating SP to ₹160 is rejected."""
    create_res = client.post("/api/v1/products", json={
        "name": "Sunflower Oil 1L",
        "selling_price": 140.0,
        "mrp": 150.0,
        "unit": "L",
        "current_stock": 25.0,
    }, headers=test_data["manager_headers"])
    prod_id = create_res.json()["id"]

    res = client.put(f"/api/v1/products/{prod_id}", json={
        "selling_price": 160.0,
    }, headers=test_data["manager_headers"])
    assert res.status_code == 400
    assert "exceeds statutory MRP ceiling" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 14. Invoice confirmation validation (Rejects SP > MRP on restock and new products)
# -----------------------------------------------------------------------------
def test_14_invoice_confirmation_validation_rejects_sp_exceeding_mrp(test_data):
    """Invoice confirmation cannot create new product or restock with SP > MRP."""
    # 1. New product in invoice exceeding MRP
    confirm_new = {
        "items": [{
            "name": "New Invoice Product Over MRP",
            "quantity": 10.0,
            "unit": "pcs",
            "purchase_price": 80.0,
            "selling_price": 110.0,
            "mrp": 100.0,
        }]
    }
    res = client.post("/api/v1/invoices/confirm", json=confirm_new, headers=test_data["manager_headers"])
    assert res.status_code == 400
    assert "exceeds statutory MRP ceiling" in res.json()["detail"]

    # 2. Restock existing product where invoice MRP is lower than current SP
    prod = client.post("/api/v1/products", json={
        "name": "Salt 1kg",
        "selling_price": 28.0,
        "mrp": 30.0,
        "unit": "kg",
        "current_stock": 50.0,
    }, headers=test_data["manager_headers"]).json()

    confirm_restock_lower_mrp = {
        "items": [{
            "name": "Salt 1kg",
            "matched_product_id": prod["id"],
            "quantity": 20.0,
            "unit": "kg",
            "purchase_price": 20.0,
            "mrp": 25.0,  # Lower than current SP ₹28.0!
        }]
    }
    res_restock = client.post("/api/v1/invoices/confirm", json=confirm_restock_lower_mrp, headers=test_data["manager_headers"])
    assert res_restock.status_code == 400
    assert "Invoice MRP ₹25.0 is lower than existing retail selling price" in res_restock.json()["detail"]


# -----------------------------------------------------------------------------
# 15. Manager selling-price override validation (Manager cannot override SP above MRP)
# -----------------------------------------------------------------------------
def test_15_manager_selling_price_override_cannot_exceed_mrp(test_data):
    """Manager with update_selling_price=True cannot override selling price above MRP."""
    prod = client.post("/api/v1/products", json={
        "name": "Coffee Jar 200g",
        "selling_price": 280.0,
        "mrp": 300.0,
        "unit": "pcs",
        "current_stock": 10.0,
        "pricing_status": "VERIFIED",
    }, headers=test_data["manager_headers"]).json()

    override_payload = {
        "items": [{
            "name": "Coffee Jar 200g",
            "matched_product_id": prod["id"],
            "quantity": 5.0,
            "unit": "pcs",
            "purchase_price": 240.0,
            "selling_price": 320.0,  # Exceeds MRP 300!
            "update_selling_price": True,
        }]
    }
    res = client.post("/api/v1/invoices/confirm", json=override_payload, headers=test_data["manager_headers"])
    assert res.status_code == 400
    assert "exceeds statutory MRP ceiling" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 16. Cashier attempting to bypass MRP (Rejected)
# -----------------------------------------------------------------------------
def test_16_cashier_attempting_to_bypass_mrp(test_data):
    """Cashier attempting to update product above MRP is rejected."""
    prod = client.post("/api/v1/products", json={
        "name": "Cashier Test Item",
        "selling_price": 50.0,
        "mrp": 60.0,
        "unit": "pcs",
        "current_stock": 10.0,
    }, headers=test_data["manager_headers"]).json()

    # Cashier attempts update exceeding MRP
    res = client.put(f"/api/v1/products/{prod['id']}", json={
        "selling_price": 70.0,
    }, headers=test_data["cashier_headers"])
    assert res.status_code == 400
    assert "exceeds statutory MRP ceiling" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 17. Manual POS checkout validation (Rejects checkout if SP exceeds MRP)
# -----------------------------------------------------------------------------
def test_17_manual_pos_checkout_rejects_if_sp_exceeds_mrp(test_data):
    """POST /api/v1/sales rejects checkout if product selling price exceeds MRP."""
    db = TestingSessionLocal()
    try:
        # Directly insert an inconsistent product (simulating legacy data)
        p_id = uuid.uuid4()
        prod = Product(
            id=p_id,
            shop_id=test_data["shop_id"],
            name="Inconsistent Legacy Product",
            selling_price=120.0,
            mrp=100.0,
            price_basis_quantity=1.0,
            price_basis_unit="pcs",
            mrp_basis_quantity=1.0,
            mrp_basis_unit="pcs",
            current_stock=20,
            unit="pcs",
            pricing_status="VERIFIED",
            is_active=True,
        )
        db.add(prod)
        db.commit()

        # POS sale attempt
        sale_payload = {
            "payment_method": "cash",
            "items": [{
                "product_id": str(p_id),
                "quantity": 1.0,
                "unit": "pcs",
            }]
        }
        res = client.post("/api/v1/sales", json=sale_payload, headers=test_data["cashier_headers"])
        assert res.status_code == 400
        assert "exceeds statutory Maximum Retail Price" in res.json()["detail"]
    finally:
        db.close()


# -----------------------------------------------------------------------------
# 18. Voice-to-Bill checkout validation (Rejects spoken price exceeding MRP)
# -----------------------------------------------------------------------------
def test_18_voice_to_bill_checkout_rejects_spoken_price_exceeding_mrp(test_data):
    """Voice processing rejects a spoken price that exceeds statutory MRP."""
    client.post("/api/v1/products", json={
        "name": "Amul Butter 500g",
        "selling_price": 270.0,
        "mrp": 285.0,
        "price_basis_quantity": 500.0,
        "price_basis_unit": "g",
        "mrp_basis_quantity": 500.0,
        "mrp_basis_unit": "g",
        "unit": "g",
        "current_stock": 5000.0,
        "pricing_status": "VERIFIED",
    }, headers=test_data["manager_headers"])

    # Spoken price ₹300 for 500g exceeds MRP ₹285!
    voice_payload = {
        "simulation_text": "500 g Amul Butter for 300 rupees",
    }
    res = client.post("/api/v1/voice/process", json=voice_payload, headers=test_data["cashier_headers"])
    assert res.status_code == 200
    data = res.json()
    # It must NOT be in matched_items; it must be in unmatched_items with MRP reason
    assert len(data["matched_items"]) == 0
    assert len(data["unmatched_items"]) >= 1
    assert any("exceeds statutory MRP" in item["reason"] for item in data["unmatched_items"])


# -----------------------------------------------------------------------------
# 19. Client-supplied MRP manipulation (Client cannot lower or forge MRP)
# -----------------------------------------------------------------------------
def test_19_client_supplied_mrp_manipulation(test_data):
    """Client attempting to bypass MRP ceiling by submitting false MRP or basis is rejected."""
    # 1. Cashier cannot verify product with invalid MRP
    res_cashier = client.post("/api/v1/products", json={
        "name": "Tampered Product",
        "selling_price": 100.0,
        "mrp": 80.0,
        "unit": "pcs",
        "pricing_status": "VERIFIED",
    }, headers=test_data["cashier_headers"])
    # Rejects immediately at creation because SP > MRP
    assert res_cashier.status_code == 400

    # 2. Incompatible unit manipulation
    res_tamper = client.post("/api/v1/products", json={
        "name": "Tampered Unit Product",
        "selling_price": 100.0,
        "price_basis_quantity": 1.0,
        "price_basis_unit": "kg",
        "mrp": 80.0,
        "mrp_basis_quantity": 1000.0,
        "mrp_basis_unit": "ml",  # Incompatible unit
        "unit": "kg",
    }, headers=test_data["manager_headers"])
    assert res_tamper.status_code == 400
    assert "Incompatible unit families" in res_tamper.json()["detail"]


# -----------------------------------------------------------------------------
# 20. Transaction rollback on validation failure (Zero database mutations on error)
# -----------------------------------------------------------------------------
def test_20_transaction_rollback_on_validation_failure(test_data):
    """When an invoice confirmation fails due to MRP violation on any item,
       zero stock is added, no purchase record is created, and zero new products are saved."""
    db = TestingSessionLocal()
    try:
        # Create an existing product with known stock
        initial_prod = Product(
            id=uuid.uuid4(),
            shop_id=test_data["shop_id"],
            name="Existing Rice 1kg",
            selling_price=50.0,
            mrp=60.0,
            price_basis_quantity=1.0,
            price_basis_unit="kg",
            current_stock=100.0,
            unit="kg",
            pricing_status="VERIFIED",
            is_active=True,
        )
        db.add(initial_prod)
        db.commit()

        # Multi-item invoice where the 2nd item violates MRP
        confirm_batch = {
            "items": [
                {
                    "name": "Existing Rice 1kg",
                    "matched_product_id": str(initial_prod.id),
                    "quantity": 50.0,
                    "unit": "kg",
                    "purchase_price": 40.0,
                    "selling_price": 50.0,
                },
                {
                    "name": "Bad MRP Item in Batch",
                    "quantity": 10.0,
                    "unit": "kg",
                    "purchase_price": 90.0,
                    "selling_price": 120.0,
                    "mrp": 100.0,  # SP exceeds MRP!
                }
            ]
        }
        res = client.post("/api/v1/invoices/confirm", json=confirm_batch, headers=test_data["manager_headers"])
        assert res.status_code == 400
        assert "exceeds statutory MRP ceiling" in res.json()["detail"]

        # Verify atomic rollback:
        # 1. Existing product stock remains exactly 100.0
        db.refresh(initial_prod)
        assert initial_prod.current_stock == 100.0

        # 2. No purchase header exists
        purchases = db.query(Purchase).filter(Purchase.shop_id == test_data["shop_id"]).all()
        assert len(purchases) == 0

        # 3. 'Bad MRP Item in Batch' was never inserted into products table
        bad_item = db.query(Product).filter(Product.name == "Bad MRP Item in Batch").first()
        assert bad_item is None
    finally:
        db.close()
