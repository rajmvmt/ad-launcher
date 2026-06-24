"""add competitors table

Revision ID: f5ab4db34975
Revises: 3bacabd348e1
Create Date: 2026-02-19 17:14:22.255001

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f5ab4db34975'
down_revision: Union[str, Sequence[str], None] = '3bacabd348e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('competitors',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('fb_page_id', sa.String(), nullable=False),
        sa.Column('fb_ads_library_url', sa.String(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('fb_page_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('competitors')
