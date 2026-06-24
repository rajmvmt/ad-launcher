"""add_brand_id_and_files_to_prompts

Revision ID: 3bacabd348e1
Revises: 8f60c85c125b
Create Date: 2026-02-16 23:09:25.000638

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '3bacabd348e1'
down_revision: Union[str, Sequence[str], None] = '8f60c85c125b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('prompts', sa.Column('brand_id', sa.String(), nullable=True))
    op.add_column('prompts', sa.Column('files', sa.JSON(), nullable=True))
    op.create_foreign_key('fk_prompts_brand_id', 'prompts', 'brands', ['brand_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_prompts_brand_id', 'prompts', type_='foreignkey')
    op.drop_column('prompts', 'files')
    op.drop_column('prompts', 'brand_id')
