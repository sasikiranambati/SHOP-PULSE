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

import logging
from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# Additive, nullable columns applied in place to existing databases. Existing rows are
# preserved (new columns start as NULL); nothing is dropped or recreated.
INCREMENTAL_COLUMNS = {
    "products": {
        "mrp": "FLOAT",
        "mrp_source": "VARCHAR",
        "mrp_updated_at": "DATETIME",
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

