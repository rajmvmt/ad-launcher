"""Add indexes on foreign key columns for query performance

Revision ID: a1b2c3d4e5f6
Revises: f5ab4db34975
Create Date: 2026-02-28 00:00:00.000000
"""
from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = 'b7c8d9e0f1a2'
down_revision = 'f5ab4db34975'
branch_labels = None
depends_on = None

# (table_name, column_name) pairs for all FK columns missing indexes
FK_INDEXES = [
    ("refresh_tokens", "user_id"),
    ("products", "brand_id"),
    ("facebook_campaigns", "connection_id"),
    ("facebook_campaigns", "brand_id"),
    ("facebook_adsets", "campaign_id"),
    ("facebook_ads", "adset_id"),
    ("publish_batches", "connection_id"),
    ("campaign_templates", "user_id"),
    ("generated_ads", "brand_id"),
    ("generated_ads", "product_id"),
    ("generated_ads", "template_id"),
    ("facebook_pages", "vertical_id"),
    ("saved_searches", "vertical_id"),
    ("search_logs", "vertical_id"),
    ("scraped_ads", "search_id"),
    ("scraped_ads", "facebook_page_id"),
    ("prompts", "brand_id"),
    ("brand_scraped_ads", "brand_scrape_id"),
    ("ad_library_items", "brand_id"),
    ("ad_library_items", "folder_id"),
    ("ad_library_folders", "brand_id"),
    ("headlines", "brand_id"),
    ("headlines", "product_id"),
    ("landers", "brand_id"),
    ("swipe_files", "brand_id"),
    ("personas", "brand_id"),
    ("persona_posts", "persona_id"),
    ("persona_comments", "persona_id"),
    ("persona_comments", "post_id"),
    ("persona_comments", "commenter_persona_id"),
    ("persona_rotation_log", "persona_id"),
    ("persona_rotation_log", "target_persona_id"),
    ("persona_rotation_log", "target_post_id"),
    ("persona_image_prompts", "persona_id"),
    ("scheduled_budget_changes", "connection_id"),
    ("auto_safe_log", "connection_id"),
]


def upgrade():
    conn = op.get_bind()
    for table, column in FK_INDEXES:
        idx_name = f"ix_{table}_{column}"
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({column})"))


def downgrade():
    conn = op.get_bind()
    for table, column in reversed(FK_INDEXES):
        idx_name = f"ix_{table}_{column}"
        conn.execute(text(f"DROP INDEX IF EXISTS {idx_name}"))
