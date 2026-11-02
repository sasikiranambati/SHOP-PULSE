import sys
from pathlib import Path

# Ensure backend root directory is in sys.path for direct script execution
_backend_dir = Path(__file__).resolve().parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from api.main import api_router
from db.session import Base, engine
import db.models  # noqa
from core.categories import CATEGORY_METADATA, normalize_product_category

import logging
from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# Additive, nullable columns applied in place to existing databases. Existing rows are
# preserved (new columns start as NULL/defaults); nothing is dropped or recreated.
INCREMENTAL_COLUMNS = {
    "products": {
        "mrp": "FLOAT",
        "mrp_source": "VARCHAR",
        "mrp_updated_at": "DATETIME",
        "standardized_category": "VARCHAR",
        "raw_category": "VARCHAR",
        "needs_category_review": "BOOLEAN DEFAULT 0",
        "last_stockout_at": "DATETIME",
        "is_active": "BOOLEAN DEFAULT 1",
    },
    "sales": {
        "status": "VARCHAR DEFAULT 'COMPLETED'",
        "cancelled_at": "DATETIME",
        "cancellation_reason": "VARCHAR",
    },
    "sale_items": {
        "cost_price_at_sale": "FLOAT",
    },
    "purchases": {
        "invoice_number": "VARCHAR",
        "invoice_date": "VARCHAR",
    },
    "purchase_items": {
        "line_amount": "FLOAT",
        "mrp": "FLOAT",
        "mrp_source": "VARCHAR",
    },
}


def init_db_schema(bind=None):
    bind = bind or engine
    Base.metadata.create_all(bind=bind)
    with bind.connect() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        for table, columns in INCREMENTAL_COLUMNS.items():
            if table not in tables:
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name in existing:
                    continue
                try:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                    conn.commit()
                    logger.info("Schema migration: added %s.%s", table, name)
                except Exception as exc:
                    conn.rollback()
                    logger.error("Schema migration failed for %s.%s: %s", table, name, exc)
                    raise

        # Refresh inspector and table names after adding columns
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())

        # Seed product_categories if empty
        if "product_categories" in tables:
            try:
                cat_count = conn.execute(text("SELECT COUNT(*) FROM product_categories")).scalar()
                if cat_count == 0:
                    for cat in CATEGORY_METADATA:
                        conn.execute(
                            text(
                                "INSERT INTO product_categories (code, name, description, display_order, is_active) "
                                "VALUES (:code, :name, :description, :display_order, 1)"
                            ),
                            cat
                        )
                    conn.commit()
                    logger.info("Seeded %d categories into product_categories", len(CATEGORY_METADATA))
            except Exception as exc:
                conn.rollback()
                logger.warning("Category master seeding skipped/failed: %s", exc)

        # Non-destructive legacy product category normalization
        if "products" in tables:
            try:
                existing_cols = {c["name"] for c in inspector.get_columns("products")}
                if "standardized_category" in existing_cols and "raw_category" in existing_cols:
                    prods = conn.execute(
                        text("SELECT id, name, category, raw_category, standardized_category, needs_category_review FROM products")
                    ).mappings().all()
                    for p in prods:
                        # If already has standardized_category and user reviewed, keep it
                        if p["standardized_category"] is not None and not p["needs_category_review"]:
                            continue

                        raw_cat = p["raw_category"] if p["raw_category"] is not None else p["category"]
                        std_cat, needs_rev = normalize_product_category(raw_cat, p["name"])
                        conn.execute(
                            text(
                                "UPDATE products SET "
                                "raw_category = :raw_cat, "
                                "standardized_category = :std_cat, "
                                "needs_category_review = :needs_rev, "
                                "is_active = COALESCE(is_active, 1) "
                                "WHERE id = :id"
                            ),
                            {"id": p["id"], "raw_cat": raw_cat, "std_cat": std_cat, "needs_rev": int(needs_rev)}
                        )
                    conn.commit()
            except Exception as exc:
                conn.rollback()
                logger.warning("Product normalization backfill skipped/failed: %s", exc)

        # Update sales status default if null
        if "sales" in tables:
            try:
                existing_cols = {c["name"] for c in inspector.get_columns("sales")}
                if "status" in existing_cols:
                    conn.execute(text("UPDATE sales SET status = 'COMPLETED' WHERE status IS NULL"))
                    conn.commit()
            except Exception as exc:
                conn.rollback()
                logger.warning("Sales status default update skipped/failed: %s", exc)

init_db_schema()

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs"
)

# Set all CORS enabled origins
origins = [str(origin) for origin in settings.BACKEND_CORS_ORIGINS] if settings.BACKEND_CORS_ORIGINS else []
if "http://127.0.0.1:5173" not in origins:
    origins.append("http://127.0.0.1:5173")
if "http://localhost:5173" not in origins:
    origins.append("http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    # ShopPulse API root health entry
    return {"message": "Welcome to ShopPulse API"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=settings.PORT, reload=True)

