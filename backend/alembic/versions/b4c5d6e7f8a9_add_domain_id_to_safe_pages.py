"""add_domain_id_and_deployed_to_safe_pages

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-03-10 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4c5d6e7f8a9'
down_revision: Union[str, Sequence[str], None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('safe_pages', sa.Column('domain_id', sa.String(), nullable=True))
    op.add_column('safe_pages', sa.Column('deployed', sa.Boolean(), server_default='false', nullable=True))
    op.create_index('ix_safe_pages_domain_id', 'safe_pages', ['domain_id'])
    op.create_foreign_key('fk_safe_pages_domain_id', 'safe_pages', 'domains', ['domain_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_safe_pages_domain_id', 'safe_pages', type_='foreignkey')
    op.drop_index('ix_safe_pages_domain_id', 'safe_pages')
    op.drop_column('safe_pages', 'deployed')
    op.drop_column('safe_pages', 'domain_id')
