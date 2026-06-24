"""add_consent_prompt_to_cloaker_campaigns

Revision ID: a3b4c5d6e7f8
Revises: 936b45763d4f
Create Date: 2026-03-10 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, Sequence[str], None] = '936b45763d4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cloaker_campaigns', sa.Column('consent_prompt', sa.Boolean(), server_default='false', nullable=True))


def downgrade() -> None:
    op.drop_column('cloaker_campaigns', 'consent_prompt')
