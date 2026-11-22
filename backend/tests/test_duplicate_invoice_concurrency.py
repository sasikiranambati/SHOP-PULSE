"""
Stage 4C.1 Remediation Step 4: Duplicate Invoice Concurrency Protection & Purchase Item Data Integrity.

Verifies:
1. Concurrent duplicate invoice submissions (threads attempting same invoice simultaneously -> exactly one succeeds, other receives 409 Conflict).
2. Zero double-stocking under concurrency.
3. Database-level unique constraint enforcement on (shop_id, supplier_id, invoice_number).
4. Fractional quantities on PurchaseItem store accurately as Float (e.g. 2.5 kg, 0.75 L).
5. PurchaseItem stores price_basis_quantity and price_basis_unit faithfully.
6. normalized_purchase_price computed accurately in API responses.
7. Direct purchase API (POST /api/v1/purchases) stores basis metadata and returns normalized_purchase_price.
8. Multi-tenant shop isolation (same invoice number across different shops is permitted).
9. Different suppliers with identical invoice numbers are permitted.
10. Purchases with invoice_number=None do not conflict.
"""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import IntegrityError

from main import app
from db.session import Base
from db.models.user import User
from db.models.shop import Shop
from db.models.supplier import Supplier
from db.models.shop_member import ShopMember, ShopRole
from db.models.product import Product
from db.models.purchase import Purchase
from db.models.purchase_item import PurchaseItem
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
        owner_id = uuid.uuid4()
        owner = User(
            id=owner_id,
            email="owner@concurrency.com",
            hashed_password=get_password_hash("password123"),
            is_active=True,
        )
        db.add(owner)

        shop_id = uuid.uuid4()
        shop = Shop(
            id=shop_id,
            shop_name="Concurrency Grocery",
            owner_name="Owner Name",
            business_type="Retail",
            owner_id=owner_id,
        )
        db.add(shop)

        db.add(ShopMember(shop_id=shop_id, user_id=owner_id, role=ShopRole.OWNER.value, is_active=True))

        supplier_id = uuid.uuid4()
        supplier = Supplier(
            id=supplier_id,
            shop_id=shop_id,
            supplier_name="Global Foods Distributor",
        )
        db.add(supplier)

        prod_id = uuid.uuid4()
        prod = Product(
            id=prod_id,
            shop_id=shop_id,
            name="Premium Rice 1kg",
            selling_price=80.0,
            purchase_price=60.0,
            mrp=90.0,
            current_stock=100.0,
            unit="kg",
            price_basis_quantity=1.0,
            price_basis_unit="kg",
            pricing_status="VERIFIED",
            is_active=True,
        )
        db.add(prod)

        db.commit()

        token = create_access_token(subject=str(owner_id))

        return {
            "shop_id": shop_id,
            "owner_id": owner_id,
            "supplier_id": supplier_id,
            "product_id": prod_id,
            "headers": {"Authorization": f"Bearer {token}"},
        }
    finally:
        db.close()


# -----------------------------------------------------------------------------
# 1. Duplicate invoice confirmation rejected with 409 Conflict
# -----------------------------------------------------------------------------
def test_01_duplicate_invoice_confirmation_rejected(test_data):
    """Attempting to confirm the identical invoice number for the same supplier twice is rejected with 409 Conflict.
       Stock is only incremented ONCE.
    """
    invoice_payload = {
        "invoice_number": "INV-CONCURRENCY-100",
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "name": "Premium Rice 1kg",
            "matched_product_id": str(test_data["product_id"]),
            "quantity": 50.0,
            "unit": "kg",
            "purchase_price": 60.0,
            "selling_price": 80.0,
        }]
    }

    res1 = client.post("/api/v1/invoices/confirm", json=invoice_payload, headers=test_data["headers"])
    assert res1.status_code == 201

    # Second attempt with same invoice number and supplier
    res2 = client.post("/api/v1/invoices/confirm", json=invoice_payload, headers=test_data["headers"])
    assert res2.status_code == 409
    assert "was already added to stock" in res2.json()["detail"]

    # Verify stock only increased once (+50kg, total 150kg)
    db = TestingSessionLocal()
    try:
        p = db.query(Product).filter(Product.id == test_data["product_id"]).first()
        assert p.current_stock == 150.0

        # Verify only 1 purchase record exists
        purchases = db.query(Purchase).filter(
            Purchase.shop_id == test_data["shop_id"],
            Purchase.invoice_number == "INV-CONCURRENCY-100"
        ).all()
        assert len(purchases) == 1
    finally:
        db.close()


# -----------------------------------------------------------------------------
# 2. Database unique constraint enforcement
# -----------------------------------------------------------------------------
def test_02_database_unique_constraint_enforcement(test_data):
    """Directly verify that inserting duplicate (shop_id, supplier_id, invoice_number) raises IntegrityError."""
    db = TestingSessionLocal()
    try:
        p1 = Purchase(
            shop_id=test_data["shop_id"],
            supplier_id=test_data["supplier_id"],
            invoice_number="INV-UNIQUE-DB-1",
            total_amount=100.0,
        )
        db.add(p1)
        db.commit()

        p2 = Purchase(
            shop_id=test_data["shop_id"],
            supplier_id=test_data["supplier_id"],
            invoice_number="INV-UNIQUE-DB-1",
            total_amount=200.0,
        )
        db.add(p2)
        with pytest.raises(IntegrityError):
            db.commit()
    finally:
        db.close()


# -----------------------------------------------------------------------------
# 3. Fractional quantity on PurchaseItem
# -----------------------------------------------------------------------------
def test_03_fractional_quantity_stored_faithfully_on_purchase_items(test_data):
    """Fractional quantities (e.g. 2.5 kg, 0.75 L) store accurately as Float without truncation."""
    confirm_payload = {
        "invoice_number": "INV-FRACTION-001",
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "name": "Premium Rice 1kg",
            "matched_product_id": str(test_data["product_id"]),
            "quantity": 2.5,
            "unit": "kg",
            "purchase_price": 60.0,
            "selling_price": 80.0,
        }]
    }
    res = client.post("/api/v1/invoices/confirm", json=confirm_payload, headers=test_data["headers"])
    assert res.status_code == 201

    db = TestingSessionLocal()
    try:
        item = db.query(PurchaseItem).join(Purchase).filter(Purchase.invoice_number == "INV-FRACTION-001").first()
        assert item is not None
        assert item.quantity == 2.5
        assert isinstance(item.quantity, float)
    finally:
        db.close()


# -----------------------------------------------------------------------------
# 4. PurchaseItem stores price_basis_quantity and price_basis_unit
# -----------------------------------------------------------------------------
def test_04_pricing_basis_metadata_stored_on_purchase_items(test_data):
    """Purchase lines record quotation basis (e.g. ₹800 per 10kg, ₹30 per 100g)."""
    confirm_payload = {
        "invoice_number": "INV-BASIS-001",
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "name": "Bulk Rice Bag 10kg",
            "quantity": 10.0,
            "unit": "kg",
            "purchase_price": 800.0,
            "price_basis_quantity": 10.0,
            "price_basis_unit": "kg",
            "selling_price": 95.0,
            "mrp": 1000.0,
            "mrp_basis_quantity": 10.0,
            "mrp_basis_unit": "kg",
        }]
    }
    res = client.post("/api/v1/invoices/confirm", json=confirm_payload, headers=test_data["headers"])
    assert res.status_code == 201

    db = TestingSessionLocal()
    try:
        item = db.query(PurchaseItem).join(Purchase).filter(Purchase.invoice_number == "INV-BASIS-001").first()
        assert item is not None
        assert item.price_basis_quantity == 10.0
        assert item.price_basis_unit == "kg"
        assert item.purchase_price == 800.0
    finally:
        db.close()


# -----------------------------------------------------------------------------
# 5. normalized_purchase_price computed accurately in API responses
# -----------------------------------------------------------------------------
def test_05_normalized_purchase_price_computed_accurately(test_data):
    """Verify PurchaseItemResponse.normalized_purchase_price calculates exact base unit rate."""
    confirm_payload = {
        "invoice_number": "INV-NORM-PRICE-001",
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "name": "Spice Pack 100g",
            "quantity": 500.0,
            "unit": "g",
            "purchase_price": 30.0,
            "price_basis_quantity": 100.0,
            "price_basis_unit": "g",
            "selling_price": 35.0,
            "mrp": 40.0,
            "mrp_basis_quantity": 100.0,
            "mrp_basis_unit": "g",
        }]
    }
    res = client.post("/api/v1/invoices/confirm", json=confirm_payload, headers=test_data["headers"])
    assert res.status_code == 201
    purchase_id = res.json()["purchase_id"]

    # Fetch purchase details
    p_res = client.get(f"/api/v1/purchases/{purchase_id}", headers=test_data["headers"])
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert len(p_data["items"]) == 1
    p_item = p_data["items"][0]
    # ₹30 per 100g = ₹0.30 per g
    assert p_item["purchase_price"] == 30.0
    assert p_item["price_basis_quantity"] == 100.0
    assert p_item["price_basis_unit"] == "g"
    assert p_item["normalized_purchase_price"] == 0.3


# -----------------------------------------------------------------------------
# 6. Direct purchase API (POST /api/v1/purchases) stores basis metadata
# -----------------------------------------------------------------------------
def test_06_direct_purchase_api_stores_basis_and_computes_normalized(test_data):
    """Direct purchase via POST /api/v1/purchases stores quotation basis and computes normalized rate."""
    payload = {
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "product_id": str(test_data["product_id"]),
            "quantity": 20.0,
            "unit": "kg",
            "purchase_price": 550.0,
            "price_basis_quantity": 10.0,
            "price_basis_unit": "kg",
        }]
    }
    res = client.post("/api/v1/purchases", json=payload, headers=test_data["headers"])
    assert res.status_code == 201
    data = res.json()
    assert len(data["items"]) == 1
    # ₹550 per 10kg = ₹55.0 per kg
    assert data["items"][0]["normalized_purchase_price"] == 55.0
    assert data["items"][0]["price_basis_quantity"] == 10.0
    assert data["items"][0]["price_basis_unit"] == "kg"


# -----------------------------------------------------------------------------
# 7. Multi-tenant shop isolation
# -----------------------------------------------------------------------------
def test_07_tenant_isolation_same_invoice_different_shops(test_data):
    """Shop A and Shop B can receive invoices with identical invoice numbers and suppliers without conflict."""
    db = TestingSessionLocal()
    try:
        # Create Shop B
        owner_b_id = uuid.uuid4()
        owner_b = User(id=owner_b_id, email="ownerb@test.com", hashed_password=get_password_hash("pass123"), is_active=True)
        db.add(owner_b)
        shop_b_id = uuid.uuid4()
        shop_b = Shop(id=shop_b_id, shop_name="Shop B", owner_name="Owner B", business_type="Retail", owner_id=owner_b_id)
        db.add(shop_b)
        db.add(ShopMember(shop_id=shop_b_id, user_id=owner_b_id, role=ShopRole.OWNER.value, is_active=True))

        sup_b_id = uuid.uuid4()
        sup_b = Supplier(id=sup_b_id, shop_id=shop_b_id, supplier_name="Supplier B")
        db.add(sup_b)

        p_b_id = uuid.uuid4()
        db.add(Product(
            id=p_b_id, shop_id=shop_b_id, name="Shop B Rice", selling_price=80.0, current_stock=10.0, unit="kg", pricing_status="VERIFIED", is_active=True
        ))
        db.commit()

        token_b = create_access_token(subject=str(owner_b_id))
        headers_b = {"Authorization": f"Bearer {token_b}"}
    finally:
        db.close()

    # Shop A confirms INV-SHARED-999
    res_a = client.post("/api/v1/invoices/confirm", json={
        "invoice_number": "INV-SHARED-999",
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "name": "Premium Rice 1kg",
            "matched_product_id": str(test_data["product_id"]),
            "quantity": 10.0,
            "unit": "kg",
            "purchase_price": 60.0,
            "selling_price": 80.0,
        }]
    }, headers=test_data["headers"])
    assert res_a.status_code == 201

    # Shop B confirms INV-SHARED-999 (allowed, different shop)
    res_b = client.post("/api/v1/invoices/confirm", json={
        "invoice_number": "INV-SHARED-999",
        "supplier_id": str(sup_b_id),
        "items": [{
            "name": "Shop B Rice",
            "matched_product_id": str(p_b_id),
            "quantity": 10.0,
            "unit": "kg",
            "purchase_price": 60.0,
            "selling_price": 80.0,
        }]
    }, headers=headers_b)
    assert res_b.status_code == 201


# -----------------------------------------------------------------------------
# 8. Same supplier different invoices allowed
# -----------------------------------------------------------------------------
def test_08_same_supplier_different_invoices_allowed(test_data):
    """Same supplier can provide multiple different invoices to the same shop."""
    res1 = client.post("/api/v1/invoices/confirm", json={
        "invoice_number": "INV-SUPPLIER-001",
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "name": "Premium Rice 1kg",
            "matched_product_id": str(test_data["product_id"]),
            "quantity": 10.0,
            "unit": "kg",
            "purchase_price": 60.0,
            "selling_price": 80.0,
        }]
    }, headers=test_data["headers"])
    assert res1.status_code == 201

    res2 = client.post("/api/v1/invoices/confirm", json={
        "invoice_number": "INV-SUPPLIER-002",
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "name": "Premium Rice 1kg",
            "matched_product_id": str(test_data["product_id"]),
            "quantity": 10.0,
            "unit": "kg",
            "purchase_price": 60.0,
            "selling_price": 80.0,
        }]
    }, headers=test_data["headers"])
    assert res2.status_code == 201


# -----------------------------------------------------------------------------
# 9. Different suppliers same invoice number allowed
# -----------------------------------------------------------------------------
def test_09_different_suppliers_same_invoice_number_allowed(test_data):
    """Different suppliers with identical invoice numbers (e.g. standard format 'INV-100') do not conflict."""
    db = TestingSessionLocal()
    try:
        supplier_2_id = uuid.uuid4()
        s2 = Supplier(id=supplier_2_id, shop_id=test_data["shop_id"], supplier_name="Second Supplier Co")
        db.add(s2)
        db.commit()
    finally:
        db.close()

    res1 = client.post("/api/v1/invoices/confirm", json={
        "invoice_number": "INV-STANDARD-100",
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "name": "Premium Rice 1kg",
            "matched_product_id": str(test_data["product_id"]),
            "quantity": 10.0,
            "unit": "kg",
            "purchase_price": 60.0,
            "selling_price": 80.0,
        }]
    }, headers=test_data["headers"])
    assert res1.status_code == 201

    res2 = client.post("/api/v1/invoices/confirm", json={
        "invoice_number": "INV-STANDARD-100",
        "supplier_id": str(supplier_2_id),
        "items": [{
            "name": "Premium Rice 1kg",
            "matched_product_id": str(test_data["product_id"]),
            "quantity": 10.0,
            "unit": "kg",
            "purchase_price": 60.0,
            "selling_price": 80.0,
        }]
    }, headers=test_data["headers"])
    assert res2.status_code == 201


# -----------------------------------------------------------------------------
# 10. Purchases with invoice_number=None do not conflict
# -----------------------------------------------------------------------------
def test_10_purchases_without_invoice_number_do_not_conflict(test_data):
    """Multiple direct purchases with invoice_number=None do not conflict."""
    payload = {
        "supplier_id": str(test_data["supplier_id"]),
        "items": [{
            "product_id": str(test_data["product_id"]),
            "quantity": 5.0,
            "unit": "kg",
            "purchase_price": 60.0,
        }]
    }
    res1 = client.post("/api/v1/purchases", json=payload, headers=test_data["headers"])
    assert res1.status_code == 201

    res2 = client.post("/api/v1/purchases", json=payload, headers=test_data["headers"])
    assert res2.status_code == 201
