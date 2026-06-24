"""add_type_column_to_prompts

Revision ID: 8f60c85c125b
Revises: add_page_fields_001
Create Date: 2026-02-16 22:42:03.937244

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '8f60c85c125b'
down_revision: Union[str, Sequence[str], None] = 'add_page_fields_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('prompts', sa.Column('type', sa.String(), server_default='prompt', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('prompts', 'type')
