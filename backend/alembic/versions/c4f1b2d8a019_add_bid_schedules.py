"""add bid_schedules table

Revision ID: c4f1b2d8a019
Revises: 2257c7bc9693
Create Date: 2026-05-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4f1b2d8a019'
down_revision: Union[str, Sequence[str], None] = '2257c7bc9693'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bid_schedules',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('fb_object_id', sa.String(), nullable=False),
        sa.Column('object_type', sa.String(), nullable=True, server_default='adset'),
        sa.Column('ad_account_id', sa.String(), nullable=False),
        sa.Column('connection_id', sa.String(), nullable=False),
        sa.Column('hour', sa.Integer(), nullable=False),
        sa.Column('minute', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('active_days', sa.JSON(), nullable=True),
        sa.Column('timezone', sa.String(), nullable=True, server_default='America/New_York'),
        sa.Column('bid_amount_cents', sa.Integer(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column('last_applied_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_applied_bid_cents', sa.Integer(), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('label', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['connection_id'], ['facebook_connections.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_bid_schedules_fb_object_id', 'bid_schedules', ['fb_object_id'])
    op.create_index('ix_bid_schedules_connection_id', 'bid_schedules', ['connection_id'])


def downgrade() -> None:
    op.drop_index('ix_bid_schedules_connection_id', table_name='bid_schedules')
    op.drop_index('ix_bid_schedules_fb_object_id', table_name='bid_schedules')
    op.drop_table('bid_schedules')
