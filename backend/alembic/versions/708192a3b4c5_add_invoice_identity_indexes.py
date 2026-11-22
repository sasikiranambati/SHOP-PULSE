"""Case-insensitive, NULL-safe invoice identity and supplier name uniqueness (Stage 4C.1 verification)

Revision ID: 708192a3b4c5
Revises: 6f708192a3b4
Create Date: 2026-11-22 18:00:00.000000

The existing constraint uq_purchases_shop_supplier_invoice (shop_id, supplier_id, invoice_number) does not
stop duplicates when the supplier is missing (NULLs are distinct in a unique constraint) or when the
invoice number differs only in letter case or surrounding spaces, so two concurrent confirmations of the
same invoice could both add stock. This migration adds two unique indexes:

- uq_purchases_invoice_identity: (shop_id, COALESCE(supplier_id, ''), lower(trim(invoice_number))) for
  purchases that have an invoice number (manual purchases without one are not restricted);
- uq_suppliers_shop_name_ci: (shop_id, lower(trim(supplier_name))), so two concurrent confirmations that
  name the same new supplier cannot create two suppliers (and so two invoice identities).

Additive and reversible: nothing is rewritten. If existing rows already conflict, the upgrade stops before
creating anything and reports the conflicting groups for review; historical records are never changed.
The existing constraint is kept.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text

revision: str = '708192a3b4c5'
down_revision: Union[str, None] = '6f708192a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PURCHASE_INDEX = "uq_purchases_invoice_identity"
SUPPLIER_INDEX = "uq_suppliers_shop_name_ci"
_HAS_NUMBER = "invoice_number IS NOT NULL AND trim(invoice_number) <> ''"

PURCHASE_CONFLICTS = f"""
    SELECT shop_id, COALESCE(CAST(supplier_id AS VARCHAR), '') AS supplier, lower(trim(invoice_number)) AS invoice,
           count(*) AS n
    FROM purchases WHERE {_HAS_NUMBER}
    GROUP BY shop_id, COALESCE(CAST(supplier_id AS VARCHAR), ''), lower(trim(invoice_number))
    HAVING count(*) > 1
"""
SUPPLIER_CONFLICTS = """
    SELECT shop_id, lower(trim(supplier_name)) AS name, count(*) AS n
    FROM suppliers GROUP BY shop_id, lower(trim(supplier_name)) HAVING count(*) > 1
"""


class ExistingDuplicatesError(RuntimeError):
    """Existing rows conflict with the new identity rules; they must be reviewed (never rewritten here)."""


def _has_columns(bind, table, columns):
    insp = inspect(bind)
    if table not in insp.get_table_names():
        return False
    return set(columns) <= {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # Only tables that have the identity columns (databases built from older schemas may lack them)
    purchases = _has_columns(bind, "purchases", ("shop_id", "supplier_id", "invoice_number"))
    suppliers = _has_columns(bind, "suppliers", ("shop_id", "supplier_name"))
    problems = []
    if purchases:
        rows = bind.execute(text(PURCHASE_CONFLICTS)).fetchall()
        if rows:
            problems.append(f"{len(rows)} purchase invoice identities occur more than once "
                            f"(shop, supplier, invoice): {[tuple(r) for r in rows[:20]]}")
    if suppliers:
        rows = bind.execute(text(SUPPLIER_CONFLICTS)).fetchall()
        if rows:
            problems.append(f"{len(rows)} supplier names occur more than once in a shop "
                            f"(ignoring case): {[tuple(r) for r in rows[:20]]}")
    if problems:
        raise ExistingDuplicatesError(
            "Migration 708192a3b4c5 stopped before changing anything: " + "; ".join(problems)
            + ". Review these records (they are not modified automatically) and run the upgrade again.")

    # IF NOT EXISTS: re-runnable (the inspector does not report expression indexes on SQLite)
    if purchases:
        op.execute(text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS {PURCHASE_INDEX} ON purchases "
            f"(shop_id, COALESCE(CAST(supplier_id AS VARCHAR), ''), lower(trim(invoice_number))) WHERE {_HAS_NUMBER}"))
    if suppliers:
        op.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {SUPPLIER_INDEX} ON suppliers (shop_id, lower(trim(supplier_name)))"))


def downgrade() -> None:
    op.execute(text(f"DROP INDEX IF EXISTS {SUPPLIER_INDEX}"))
    op.execute(text(f"DROP INDEX IF EXISTS {PURCHASE_INDEX}"))
