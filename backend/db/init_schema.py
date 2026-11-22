"""
Explicit database schema initialization (Stage 5.1). Nothing in this module runs at import time.

Before Stage 5.1 ``main.py`` called ``init_db_schema()`` at module level, so merely importing the
application (a test, a script, ``python -c "import main"``) created tables, added columns and indexes in
whatever database the settings pointed at - the default being ``backend/shoppulse.db``.

Now schema initialization happens only when it is asked for:

- at application startup (FastAPI lifespan in ``main.py``), via ``initialize_database_on_startup()``;
  disabled with ``SHOPPULSE_DB_INIT=off``;
- by the explicit development command ``python -m db.init_schema --confirm``;
- by test setup, on the isolated test database only (``tests/conftest.py``).

Rules applied in every case:

- A database managed by Alembic (it has an ``alembic_version`` table) is never changed here: its schema
  belongs exclusively to the approved migration process. Not even missing tables are created.
- On an unmanaged (development / legacy) database the changes are additive only: missing tables are
  created, a few known nullable legacy columns and query indexes are added. Nothing is dropped, rewritten
  or seeded, and existing rows are untouched.
- Every change made is returned and logged; no change is silent.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import warnings
from dataclasses import dataclass, field
from typing import List, Optional

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Additive, nullable columns applied in place to existing (unmanaged) databases. Existing rows are
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
        "processing_status": "VARCHAR",
        "review_status": "VARCHAR",
    },
    "purchase_items": {
        "line_amount": "FLOAT",
        "mrp": "FLOAT",
        "mrp_source": "VARCHAR",
    },
}

# High-traffic query indexes ensured on unmanaged databases
QUERY_INDEXES = [
    ("ix_sale_items_sale_id", "sale_items", "sale_id"),
    ("ix_sale_items_product_id", "sale_items", "product_id"),
    ("ix_sales_shop_id_created_at", "sales", "shop_id, created_at"),
]

DB_INIT_ENV = "SHOPPULSE_DB_INIT"


@dataclass
class SchemaInitResult:
    """What an initialization did (empty lists when nothing changed)."""
    managed_by_alembic: bool = False
    created_tables: List[str] = field(default_factory=list)
    added_columns: List[str] = field(default_factory=list)
    ensured_indexes: List[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.created_tables or self.added_columns or self.ensured_indexes)


def is_alembic_managed(bind: Engine) -> bool:
    """True when the database's schema is owned by Alembic migrations (read-only check)."""
    with bind.connect() as conn:
        return "alembic_version" in set(inspect(conn).get_table_names())


def init_db_schema(bind: Optional[Engine] = None) -> SchemaInitResult:
    """Create the schema of an unmanaged development / test database (additive only).

    Alembic-managed databases are left completely unchanged. Call this explicitly; it is never run on
    import. ``bind`` defaults to the application engine (the database selected by the settings)."""
    if bind is None:
        from db.session import engine as bind  # the configured database, resolved only when called
    import db.models  # noqa: F401  (register every model on Base.metadata)
    from db.session import Base

    result = SchemaInitResult()
    if is_alembic_managed(bind):
        result.managed_by_alembic = True
        logger.info("Database schema is managed by Alembic: no schema changes at initialization "
                    "(apply approved migrations instead).")
        return result

    with bind.connect() as conn:
        before = set(inspect(conn).get_table_names())
    Base.metadata.create_all(bind=bind)
    with bind.connect() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        result.created_tables = sorted(tables - before)

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
                    result.added_columns.append(f"{table}.{name}")
                except Exception as exc:
                    conn.rollback()
                    logger.error("Schema initialization failed for %s.%s: %s", table, name, exc)
                    raise

        with warnings.catch_warnings():
            # Expression indexes (e.g. uq_purchases_invoice_identity) cannot be reflected; irrelevant here
            warnings.filterwarnings("ignore", message="Skipped unsupported reflection of expression-based index")
            existing_indexes = {ix["name"] for t in tables for ix in inspector.get_indexes(t)}
        for idx_name, table, cols in QUERY_INDEXES:
            if table not in tables or idx_name in existing_indexes:
                continue
            try:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({cols})"))
                conn.commit()
                result.ensured_indexes.append(idx_name)
            except Exception as exc:
                logger.debug("Index creation %s skipped: %s", idx_name, exc)

    if result.changed:
        logger.warning("Database schema initialized (unmanaged database): tables created %s, columns added %s, "
                       "indexes created %s", result.created_tables, result.added_columns, result.ensured_indexes)
    return result


def startup_init_enabled(environ=None) -> bool:
    """Schema initialization at application startup; set SHOPPULSE_DB_INIT=off to disable it."""
    value = (environ if environ is not None else os.environ).get(DB_INIT_ENV, "auto").strip().lower()
    return value not in ("off", "0", "false", "no", "disabled")


def initialize_database_on_startup(bind: Optional[Engine] = None) -> Optional[SchemaInitResult]:
    """Controlled startup step (FastAPI lifespan): initialize an unmanaged database unless disabled."""
    if not startup_init_enabled():
        logger.info("%s=off: database schema initialization skipped at startup.", DB_INIT_ENV)
        return None
    return init_db_schema(bind)


def main(argv: Optional[List[str]] = None) -> int:
    """Explicit development command: ``python -m db.init_schema --confirm``."""
    parser = argparse.ArgumentParser(
        prog="python -m db.init_schema",
        description="Create the schema of an UNMANAGED development database (additive only). Alembic-managed "
                    "databases are never changed; use migrations for those.")
    parser.add_argument("--confirm", action="store_true", help="actually apply the changes (required)")
    args = parser.parse_args(argv)
    from core.config import settings
    print(f"Target database: {settings.SQLALCHEMY_DATABASE_URI}")
    if not args.confirm:
        print("Nothing done. Re-run with --confirm to initialize this database.")
        return 2
    result = init_db_schema()
    if result.managed_by_alembic:
        print("Alembic-managed database: no changes made. Apply approved migrations instead.")
    else:
        print(f"Tables created: {result.created_tables or 'none'}")
        print(f"Columns added: {result.added_columns or 'none'}")
        print(f"Indexes created: {result.ensured_indexes or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
