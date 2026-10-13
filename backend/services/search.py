"""
Global search across the records a shop owns: products, purchases (supplier invoices) and sales.

Matching is partial and case-insensitive. User input is escaped before it is used in LIKE
patterns, every query is restricted to the caller's shop, and only a few rows per group are
returned so the browser never has to load whole tables.
"""
import re
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import String, and_, case, cast, exists, func, or_
from sqlalchemy.orm import Session

from db.models.product import Product
from db.models.purchase import Purchase
from db.models.purchase_item import PurchaseItem
from db.models.sale import Sale
from db.models.sale_item import SaleItem
from db.models.supplier import Supplier
from schemas.search import (
    ProductSearchHit,
    PurchaseSearchHit,
    SaleSearchHit,
    SearchResponse,
    SearchTotals,
)

MIN_QUERY_LENGTH = 2
LIKE_ESCAPE = "\\"
# Sales have no stored bill number; the UI shows "SP-" + the first 8 hex digits of the id.
BILL_PREFIX = "SP-"
_HEX = re.compile(r"^[0-9a-f]+$")


def bill_number_for(sale_id: UUID) -> str:
    return f"{BILL_PREFIX}{str(sale_id)[:8].upper()}"


def _escape_like(text: str) -> str:
    return (
        text.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", LIKE_ESCAPE + "%")
        .replace("_", LIKE_ESCAPE + "_")
    )


def _contains(column, text: str):
    return func.lower(column).like(f"%{_escape_like(text.lower())}%", escape=LIKE_ESCAPE)


def _bill_id_prefix(query: str) -> Optional[str]:
    """Hex prefix of a sale id when the query looks like a bill number (e.g. 'SP-1A2B' or '1a2b3c4d')."""
    text = query.strip().lower()
    if text.startswith(BILL_PREFIX.lower()):
        text = text[len(BILL_PREFIX):]
    text = text[:8]
    if len(text) >= 4 and _HEX.match(text):
        return text
    return None


def _search_products(db: Session, shop_id: UUID, q: str, limit: int) -> Tuple[List[ProductSearchHit], int]:
    condition = and_(
        Product.shop_id == shop_id,
        or_(_contains(Product.name, q), _contains(Product.sku, q), _contains(Product.category, q)),
    )
    total = db.query(func.count(Product.id)).filter(condition).scalar() or 0
    starts_with = func.lower(Product.name).like(f"{_escape_like(q.lower())}%", escape=LIKE_ESCAPE)
    rows = (
        db.query(Product)
        .filter(condition)
        .order_by(case((starts_with, 0), else_=1), func.lower(Product.name))
        .limit(limit)
        .all()
    )
    return [ProductSearchHit.model_validate(p) for p in rows], total


def _search_purchases(db: Session, shop_id: UUID, q: str, limit: int) -> Tuple[List[PurchaseSearchHit], int]:
    product_match = exists().where(
        and_(
            PurchaseItem.purchase_id == Purchase.id,
            PurchaseItem.product_id == Product.id,
            Product.shop_id == shop_id,
            _contains(Product.name, q),
        )
    )
    condition = and_(
        Purchase.shop_id == shop_id,
        or_(_contains(Purchase.invoice_number, q), _contains(Supplier.supplier_name, q), product_match),
    )
    base = db.query(Purchase).outerjoin(Supplier, Supplier.id == Purchase.supplier_id).filter(condition)
    total = base.with_entities(func.count(Purchase.id)).scalar() or 0
    rows = base.order_by(Purchase.created_at.desc()).limit(limit).all()

    hits: List[PurchaseSearchHit] = []
    for purchase in rows:
        matched = None
        header_match = (purchase.invoice_number and q.lower() in purchase.invoice_number.lower()) or (
            purchase.supplier and q.lower() in (purchase.supplier.supplier_name or "").lower()
        )
        if not header_match:
            matched = next(
                (it.product.name for it in purchase.items if it.product and q.lower() in it.product.name.lower()),
                None,
            )
        hits.append(
            PurchaseSearchHit(
                id=purchase.id,
                invoice_number=purchase.invoice_number,
                invoice_date=purchase.invoice_date,
                supplier_name=purchase.supplier.supplier_name if purchase.supplier else None,
                total_amount=purchase.total_amount or 0.0,
                item_count=len(purchase.items),
                created_at=purchase.created_at,
                matched_product=matched,
            )
        )
    return hits, total


def _search_sales(db: Session, shop_id: UUID, q: str, limit: int) -> Tuple[List[SaleSearchHit], int]:
    product_match = exists().where(
        and_(
            SaleItem.sale_id == Sale.id,
            SaleItem.product_id == Product.id,
            Product.shop_id == shop_id,
            _contains(Product.name, q),
        )
    )
    clauses = [product_match]
    id_prefix = _bill_id_prefix(q)
    if id_prefix:
        # Works for UUIDs stored as 32 hex characters (SQLite) and as text with dashes (PostgreSQL):
        # the first 8 characters are the same hex digits in both forms.
        clauses.append(func.lower(cast(Sale.id, String)).like(f"{id_prefix}%"))
    condition = and_(Sale.shop_id == shop_id, or_(*clauses))

    total = db.query(func.count(Sale.id)).filter(condition).scalar() or 0
    rows = db.query(Sale).filter(condition).order_by(Sale.created_at.desc()).limit(limit).all()

    hits: List[SaleSearchHit] = []
    for sale in rows:
        bill = bill_number_for(sale.id)
        matched = None
        if not (id_prefix and bill.lower().startswith(f"{BILL_PREFIX.lower()}{id_prefix}")):
            matched = next(
                (it.product.name for it in sale.items if it.product and q.lower() in it.product.name.lower()),
                None,
            )
        hits.append(
            SaleSearchHit(
                id=sale.id,
                bill_number=bill,
                total_amount=sale.total_amount or 0.0,
                payment_method=sale.payment_method,
                item_count=sum(item.quantity for item in sale.items),
                created_at=sale.created_at,
                matched_product=matched,
            )
        )
    return hits, total


def search_shop_records(db: Session, shop_id: UUID, query: str, limit: int = 5) -> SearchResponse:
    q = (query or "").strip()
    if len(q) < MIN_QUERY_LENGTH:
        return SearchResponse(query=q)

    products, product_total = _search_products(db, shop_id, q, limit)
    purchases, purchase_total = _search_purchases(db, shop_id, q, limit)
    sales, sale_total = _search_sales(db, shop_id, q, limit)
    return SearchResponse(
        query=q,
        products=products,
        purchases=purchases,
        sales=sales,
        totals=SearchTotals(products=product_total, purchases=purchase_total, sales=sale_total),
    )
