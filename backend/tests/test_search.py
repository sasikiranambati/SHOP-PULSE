"""
Global search: partial, case-insensitive matching over products, purchase invoices and sales,
always limited to the caller's own shop, with LIKE wildcards in user input treated literally.
"""
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import pytest

from main import app
from db.session import Base
import db.models  # noqa: F401
from api.deps import get_db

engine = create_engine(
    "sqlite:///:memory:",
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


def auth_headers(email: str) -> dict:
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    token = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/v1/shops", json={
        "shop_name": "Search Test Shop", "owner_name": "Owner",
        "business_type": "Grocery/Kirana", "location": "Main Road",
    }, headers=headers)
    return headers


def add_product(headers, name, sku=None, category="Groceries", stock=50, price=30.0):
    res = client.post("/api/v1/products", json={
        "name": name, "category": category, "selling_price": price, "purchase_price": price - 5,
        "current_stock": stock, "reorder_level": 5, "unit": "pcs", "sku": sku,
    }, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def search(headers, q, **params):
    return client.get("/api/v1/search", params={"q": q, **params}, headers=headers)


def test_search_requires_authentication():
    assert client.get("/api/v1/search", params={"q": "milk"}).status_code == 401


def test_products_match_partially_and_case_insensitively():
    h = auth_headers("search_products@example.com")
    add_product(h, "Amul Toned Milk 500ml", sku="8901262010016", category="Dairy")
    add_product(h, "Tata Salt 1kg", sku="TATA-SALT")
    add_product(h, "Milky Mist Paneer", category="Dairy")

    data = search(h, "MILK").json()
    names = [p["name"] for p in data["products"]]
    assert set(names) == {"Amul Toned Milk 500ml", "Milky Mist Paneer"}
    # Names starting with the query are listed first
    assert names[0] == "Milky Mist Paneer"
    assert data["totals"]["products"] == 2

    assert [p["name"] for p in search(h, "tata-s").json()["products"]] == ["Tata Salt 1kg"]   # SKU
    assert {p["name"] for p in search(h, "dairy").json()["products"]} == {"Amul Toned Milk 500ml", "Milky Mist Paneer"}


def test_short_and_unmatched_queries_return_empty_results():
    h = auth_headers("search_empty@example.com")
    add_product(h, "Parle-G Biscuits")
    short = search(h, "p").json()
    assert short["products"] == [] and short["purchases"] == [] and short["sales"] == []
    none = search(h, "zzzz-not-here").json()
    assert none["products"] == [] and none["totals"] == {"products": 0, "purchases": 0, "sales": 0}


def test_like_wildcards_in_the_query_are_literal():
    h = auth_headers("search_wildcards@example.com")
    add_product(h, "Surf Excel 1kg")
    add_product(h, "Discount 50% Pack")
    assert [p["name"] for p in search(h, "%%").json()["products"]] == []
    assert [p["name"] for p in search(h, "50%").json()["products"]] == ["Discount 50% Pack"]
    assert search(h, "__").json()["products"] == []


def test_results_never_include_another_shops_records():
    owner = auth_headers("search_owner@example.com")
    other = auth_headers("search_other@example.com")
    add_product(owner, "Owner Basmati Rice")
    add_product(other, "Other Basmati Rice")
    assert [p["name"] for p in search(owner, "basmati").json()["products"]] == ["Owner Basmati Rice"]
    assert [p["name"] for p in search(other, "basmati").json()["products"]] == ["Other Basmati Rice"]


def test_purchase_invoices_match_by_number_supplier_and_product():
    h = auth_headers("search_purchases@example.com")
    res = client.post("/api/v1/invoices/confirm", json={
        "supplier_name": "Sri Balaji Wholesale Traders",
        "invoice_number": "SBW-1021",
        "invoice_date": "05/10/2026",
        "items": [{"name": "Fortune Sunflower Oil 1L", "quantity": 12, "unit": "pcs",
                   "purchase_price": 140, "selling_price": 155, "line_amount": 1680}],
    }, headers=h)
    assert res.status_code == 201, res.text
    purchase_id = res.json()["purchase_id"]

    by_number = search(h, "sbw-10").json()["purchases"]
    assert [p["invoice_number"] for p in by_number] == ["SBW-1021"]
    assert by_number[0]["supplier_name"] == "Sri Balaji Wholesale Traders"
    assert by_number[0]["item_count"] == 1
    assert by_number[0]["total_amount"] == pytest.approx(1680)

    assert [p["id"] for p in search(h, "balaji").json()["purchases"]] == [purchase_id]
    by_product = search(h, "sunflower").json()["purchases"]
    assert [p["id"] for p in by_product] == [purchase_id]
    assert by_product[0]["matched_product"] == "Fortune Sunflower Oil 1L"

    # The purchase record can be opened with names and printed amounts for review/printing
    detail = client.get(f"/api/v1/purchases/{purchase_id}", headers=h).json()
    assert detail["invoice_number"] == "SBW-1021"
    assert detail["supplier_name"] == "Sri Balaji Wholesale Traders"
    assert detail["items"][0]["product_name"] == "Fortune Sunflower Oil 1L"
    assert detail["items"][0]["line_amount"] == pytest.approx(1680)


def test_sales_match_by_bill_number_and_product_sold():
    h = auth_headers("search_sales@example.com")
    milk = add_product(h, "Amul Gold Milk 1L", stock=20, price=68)
    sale = client.post("/api/v1/sales", json={
        "items": [{"product_id": milk["id"], "quantity": 2}], "payment_method": "upi",
    }, headers=h)
    assert sale.status_code == 201, sale.text
    sale_id = sale.json()["id"]
    bill_number = "SP-" + sale_id[:8].upper()

    by_bill = search(h, bill_number.lower()).json()["sales"]
    assert [s["bill_number"] for s in by_bill] == [bill_number]
    assert by_bill[0]["matched_product"] is None
    assert by_bill[0]["item_count"] == 2
    assert by_bill[0]["payment_method"] == "upi"

    # Bill number without the prefix, and a partial prefix
    assert [s["id"] for s in search(h, sale_id[:6]).json()["sales"]] == [sale_id]

    by_product = search(h, "gold milk").json()["sales"]
    assert [s["id"] for s in by_product] == [sale_id]
    assert by_product[0]["matched_product"] == "Amul Gold Milk 1L"


def test_limit_caps_each_group_but_totals_count_everything():
    h = auth_headers("search_limit@example.com")
    for i in range(7):
        add_product(h, f"Maggi Noodles Pack {i}")
    data = search(h, "maggi", limit=3).json()
    assert len(data["products"]) == 3
    assert data["totals"]["products"] == 7
    assert search(h, "maggi", limit=50).status_code == 422
