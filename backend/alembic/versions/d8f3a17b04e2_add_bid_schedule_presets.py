"""add bid_schedule_presets table

Revision ID: d8f3a17b04e2
Revises: c4f1b2d8a019
Create Date: 2026-05-19 00:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8f3a17b04e2'
down_revision: Union[str, Sequence[str], None] = 'c4f1b2d8a019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bid_schedule_presets',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('rules', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('name', name='uq_bid_schedule_presets_name'),
    )


def downgrade() -> None:
    op.drop_table('bid_schedule_presets')
