"""add spy_reports and pg_trgm

Revision ID: 2257c7bc9693
Revises: 4a86b89df967
Create Date: 2026-04-16 00:56:56.300065

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '2257c7bc9693'
down_revision: Union[str, Sequence[str], None] = '4a86b89df967'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        'spy_reports',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('report_date', sa.Date, nullable=False, unique=True),
        sa.Column('total_ads_scanned', sa.Integer, nullable=False, server_default='0'),
        sa.Column('new_ads_count', sa.Integer, nullable=False, server_default='0'),
        sa.Column('competitors_scanned', sa.Integer, nullable=False, server_default='0'),
        sa.Column('keywords_scanned', sa.Integer, nullable=False, server_default='0'),
        sa.Column('top_scraped_ad_ids', postgresql.ARRAY(sa.String), nullable=False, server_default='{}'),
        sa.Column('score_details', postgresql.JSONB, nullable=False, server_default='{}'),
        sa.Column('summary_markdown', sa.Text, nullable=False, server_default=''),
        sa.Column('telegram_chat_id', sa.String, nullable=True),
        sa.Column('telegram_message_id', sa.String, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_spy_reports_report_date', 'spy_reports', ['report_date'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_spy_reports_report_date', table_name='spy_reports')
    op.drop_table('spy_reports')
    # Leave pg_trgm installed — other features may use it
