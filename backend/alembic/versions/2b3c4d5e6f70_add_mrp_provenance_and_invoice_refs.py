"""Add MRP provenance, purchase invoice references and line amounts

Revision ID: 2b3c4d5e6f70
Revises: 1a2b3c4d5e6f
Create Date: 2026-10-10 12:00:00.000000

All columns are nullable and added in place; existing rows keep their data.
The same columns are applied at startup by main.init_db_schema() for databases
that are not managed with Alembic.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '2b3c4d5e6f70'
down_revision: Union[str, None] = '1a2b3c4d5e6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_COLUMNS = {
    'products': [
        ('mrp_source', sa.String()),
        ('mrp_updated_at', sa.DateTime(timezone=True)),
    ],
    'purchases': [
        ('invoice_number', sa.String()),
        ('invoice_date', sa.String()),
    ],
    'purchase_items': [
        ('line_amount', sa.Float()),
        ('mrp', sa.Float()),
        ('mrp_source', sa.String()),
    ],
}


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table, columns in NEW_COLUMNS.items():
        if table not in tables:
            continue
        existing = {c['name'] for c in inspector.get_columns(table)}
        for name, col_type in columns:
            if name not in existing:
                op.add_column(table, sa.Column(name, col_type, nullable=True))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table, columns in NEW_COLUMNS.items():
        if table not in tables:
            continue
        existing = {c['name'] for c in inspector.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            for name, _ in columns:
                if name in existing:
                    batch.drop_column(name)
