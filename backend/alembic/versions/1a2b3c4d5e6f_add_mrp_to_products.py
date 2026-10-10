"""Add mrp column to products

Revision ID: 1a2b3c4d5e6f
Revises: 0bdf0ba4cc18
Create Date: 2026-10-09 11:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = '1a2b3c4d5e6f'
down_revision: Union[str, None] = '0bdf0ba4cc18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Safely check if 'mrp' already exists before adding
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [c['name'] for c in inspector.get_columns('products')]
    if 'mrp' not in columns:
        op.add_column('products', sa.Column('mrp', sa.Float(), nullable=True))


def downgrade() -> None:
    # SQLite has limited DROP COLUMN support depending on version; handle safely
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [c['name'] for c in inspector.get_columns('products')]
    if 'mrp' in columns:
        try:
            op.drop_column('products', 'mrp')
        except Exception:
            pass
