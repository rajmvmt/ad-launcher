from sqlalchemy import Column, String, Integer, Float, ForeignKey, DateTime, Text, JSON, Table, Boolean, UniqueConstraint, Date
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid

def generate_uuid():
    return str(uuid.uuid4())

# Many-to-Many relationship table for User <-> Role
user_roles = Table(
    'user_roles',
    Base.metadata,
    Column('user_id', String, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    Column('role_id', String, ForeignKey('roles.id', ondelete='CASCADE'), primary_key=True),
    Column('created_at', DateTime(timezone=True), server_default=func.now())
)

# Many-to-Many relationship table for Role <-> Permission
role_permissions = Table(
    'role_permissions',
    Base.metadata,
    Column('role_id', String, ForeignKey('roles.id', ondelete='CASCADE'), primary_key=True),
    Column('permission_id', String, ForeignKey('permissions.id', ondelete='CASCADE'), primary_key=True),
    Column('created_at', DateTime(timezone=True), server_default=func.now())
)

# Many-to-Many relationship table for Brand <-> CustomerProfile
brand_profiles = Table(
    'brand_profiles',
    Base.metadata,
    Column('brand_id', String, ForeignKey('brands.id', ondelete='CASCADE'), primary_key=True),
    Column('profile_id', String, ForeignKey('customer_profiles.id', ondelete='CASCADE'), primary_key=True),
    Column('created_at', DateTime(timezone=True), server_default=func.now())
)

# Many-to-Many relationship table for Ad Account <-> Brand
account_brands = Table(
    'account_brands',
    Base.metadata,
    Column('ad_account_id', String, primary_key=True),
    Column('brand_id', String, ForeignKey('brands.id', ondelete='CASCADE'), primary_key=True),
    Column('created_at', DateTime(timezone=True), server_default=func.now())
)

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    roles = relationship("Role", secondary=user_roles, back_populates="users")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")

    def has_permission(self, permission_name: str) -> bool:
        """Check if user has a specific permission through any of their roles"""
        if self.is_superuser:
            return True
        for role in self.roles:
            for permission in role.permissions:
                if permission.name == permission_name:
                    return True
        return False

    def has_role(self, role_name: str) -> bool:
        """Check if user has a specific role"""
        if self.is_superuser:
            return True
        return any(role.name == role_name for role in self.roles)

class Role(Base):
    __tablename__ = "roles"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", secondary=user_roles, back_populates="roles")
    permissions = relationship("Permission", secondary=role_permissions, back_populates="roles")

class Permission(Base):
    __tablename__ = "permissions"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, unique=True, nullable=False)  # e.g., "brands:create", "ads:delete"
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    roles = relationship("Role", secondary=role_permissions, back_populates="permissions")

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="refresh_tokens")

class Brand(Base):
    __tablename__ = "brands"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    logo = Column(String, nullable=True)
    primary_color = Column(String, default='#3B82F6')
    secondary_color = Column(String, default='#10B981')
    highlight_color = Column(String, default='#F59E0B')
    voice = Column(Text, nullable=True)
    style_guide = Column(JSON, nullable=True, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    products = relationship("Product", back_populates="brand", cascade="all, delete-orphan")
    profiles = relationship("CustomerProfile", secondary=brand_profiles, back_populates="brands")
    generated_ads = relationship("GeneratedAd", back_populates="brand")

    @property
    def colors(self):
        return {
            "primary": self.primary_color,
            "secondary": self.secondary_color,
            "highlight": self.highlight_color
        }
    
    @property
    def profileIds(self):
        return [p.id for p in self.profiles]

class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    product_shots = Column(JSON, nullable=True)
    default_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    brand = relationship("Brand", back_populates="products")

class CustomerProfile(Base):
    __tablename__ = "customer_profiles"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    demographics = Column(Text, nullable=True)
    pain_points = Column(Text, nullable=True)
    goals = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    brands = relationship("Brand", secondary=brand_profiles, back_populates="profiles")

class FacebookConnection(Base):
    __tablename__ = "facebook_connections"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    access_token = Column(String, nullable=False)
    app_id = Column(String, nullable=True)
    app_secret = Column(String, nullable=True)
    ad_account_id = Column(String, nullable=True)  # Optional default ad account
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FacebookCampaign(Base):
    __tablename__ = "facebook_campaigns"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    objective = Column(String, nullable=False)
    budget_type = Column(String, nullable=False)
    daily_budget = Column(Integer, nullable=True)
    bid_strategy = Column(String, nullable=True)
    status = Column(String, default='ACTIVE')
    fb_campaign_id = Column(String, nullable=True, index=True)
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="SET NULL"), nullable=True, index=True)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    adsets = relationship("FacebookAdSet", back_populates="campaign", cascade="all, delete-orphan")
    brand = relationship("Brand")

class FacebookAdSet(Base):
    __tablename__ = "facebook_adsets"

    id = Column(String, primary_key=True, default=generate_uuid)
    campaign_id = Column(String, ForeignKey("facebook_campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    optimization_goal = Column(String, nullable=False)
    daily_budget = Column(Integer, nullable=True)
    bid_strategy = Column(String, nullable=True)
    bid_amount = Column(Integer, nullable=True)
    targeting = Column(JSON, nullable=True)
    pixel_id = Column(String, nullable=True)
    conversion_event = Column(String, nullable=True)
    status = Column(String, default='ACTIVE')
    fb_adset_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    campaign = relationship("FacebookCampaign", back_populates="adsets")
    ads = relationship("FacebookAd", back_populates="adset", cascade="all, delete-orphan")

class FacebookAd(Base):
    __tablename__ = "facebook_ads"

    id = Column(String, primary_key=True, default=generate_uuid)
    adset_id = Column(String, ForeignKey("facebook_adsets.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    creative_name = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    # Video support fields
    media_type = Column(String, default='image')  # 'image' or 'video'
    video_url = Column(String, nullable=True)
    video_id = Column(String, nullable=True)  # Facebook video ID
    thumbnail_url = Column(String, nullable=True)
    bodies = Column(JSON, nullable=True)
    headlines = Column(JSON, nullable=True)
    description = Column(Text, nullable=True)
    cta = Column(String, nullable=True)
    website_url = Column(String, nullable=True)
    status = Column(String, default='ACTIVE')
    fb_ad_id = Column(String, nullable=True, index=True)
    fb_creative_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    adset = relationship("FacebookAdSet", back_populates="ads")


class FBSyncStatus(Base):
    """Track last sync time per ad account."""
    __tablename__ = "fb_sync_status"

    id = Column(String, primary_key=True, default=generate_uuid)
    ad_account_id = Column(String, nullable=False, unique=True, index=True)
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="CASCADE"), nullable=False)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_duration_ms = Column(Integer, nullable=True)
    last_sync_error = Column(Text, nullable=True)
    campaigns_count = Column(Integer, default=0)
    adsets_count = Column(Integer, default=0)
    ads_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FBSyncCampaign(Base):
    """Locally cached Facebook campaign data + insights."""
    __tablename__ = "fb_sync_campaigns"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_campaign_id = Column(String, nullable=False, index=True)
    ad_account_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String)
    effective_status = Column(String)
    objective = Column(String)
    daily_budget = Column(String, nullable=True)
    lifetime_budget = Column(String, nullable=True)
    bid_strategy = Column(String, nullable=True)
    buying_type = Column(String, nullable=True)
    special_ad_categories = Column(JSON, nullable=True)
    start_time = Column(String, nullable=True)
    stop_time = Column(String, nullable=True)
    insights_since = Column(String, nullable=True)
    insights_until = Column(String, nullable=True)
    impressions = Column(String, default='0')
    clicks = Column(String, default='0')
    spend = Column(String, default='0.00')
    ctr = Column(String, default='0')
    cpc = Column(String, default='0')
    cpm = Column(String, default='0')
    reach = Column(String, default='0')
    results = Column(Integer, default=0)
    purchase_revenue = Column(Float, default=0.0)
    actions = Column(JSON, nullable=True)
    cost_per_action_type = Column(JSON, nullable=True)
    action_values = Column(JSON, nullable=True)
    # Today-only stats (updated each sync cycle with time_range=today)
    today_date = Column(String, nullable=True)
    today_spend = Column(String, default='0.00')
    today_impressions = Column(String, default='0')
    today_clicks = Column(String, default='0')
    today_ctr = Column(String, default='0')
    today_cpc = Column(String, default='0')
    today_cpm = Column(String, default='0')
    today_results = Column(Integer, default=0)
    today_purchase_revenue = Column(Float, default=0.0)
    today_actions = Column(JSON, nullable=True)
    today_action_values = Column(JSON, nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('fb_campaign_id', 'ad_account_id', name='uq_sync_campaign'),
    )


class FBSyncAdSet(Base):
    """Locally cached Facebook ad set data + insights."""
    __tablename__ = "fb_sync_adsets"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_adset_id = Column(String, nullable=False, index=True)
    fb_campaign_id = Column(String, nullable=False, index=True)
    ad_account_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String)
    effective_status = Column(String)
    daily_budget = Column(String, nullable=True)
    lifetime_budget = Column(String, nullable=True)
    targeting = Column(JSON, nullable=True)
    optimization_goal = Column(String, nullable=True)
    bid_amount = Column(String, nullable=True)
    bid_strategy = Column(String, nullable=True)
    billing_event = Column(String, nullable=True)
    start_time = Column(String, nullable=True)
    end_time = Column(String, nullable=True)
    insights_since = Column(String, nullable=True)
    insights_until = Column(String, nullable=True)
    impressions = Column(String, default='0')
    clicks = Column(String, default='0')
    spend = Column(String, default='0.00')
    ctr = Column(String, default='0')
    cpc = Column(String, default='0')
    cpm = Column(String, default='0')
    reach = Column(String, default='0')
    results = Column(Integer, default=0)
    purchase_revenue = Column(Float, default=0.0)
    actions = Column(JSON, nullable=True)
    cost_per_action_type = Column(JSON, nullable=True)
    action_values = Column(JSON, nullable=True)
    # Today-only stats (updated each sync cycle with time_range=today)
    today_date = Column(String, nullable=True)
    today_spend = Column(String, default='0.00')
    today_impressions = Column(String, default='0')
    today_clicks = Column(String, default='0')
    today_ctr = Column(String, default='0')
    today_cpc = Column(String, default='0')
    today_cpm = Column(String, default='0')
    today_results = Column(Integer, default=0)
    today_purchase_revenue = Column(Float, default=0.0)
    today_actions = Column(JSON, nullable=True)
    today_action_values = Column(JSON, nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('fb_adset_id', 'ad_account_id', name='uq_sync_adset'),
    )


class FBSyncAd(Base):
    """Locally cached Facebook ad data + insights + creative."""
    __tablename__ = "fb_sync_ads"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_ad_id = Column(String, nullable=False, index=True)
    fb_adset_id = Column(String, nullable=False, index=True)
    fb_campaign_id = Column(String, nullable=False, index=True)
    ad_account_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String)
    effective_status = Column(String)
    creative_id = Column(String, nullable=True)
    creative_data = Column(JSON, nullable=True)
    insights_since = Column(String, nullable=True)
    insights_until = Column(String, nullable=True)
    impressions = Column(String, default='0')
    clicks = Column(String, default='0')
    spend = Column(String, default='0.00')
    ctr = Column(String, default='0')
    cpc = Column(String, default='0')
    cpm = Column(String, default='0')
    reach = Column(String, default='0')
    results = Column(Integer, default=0)
    purchase_revenue = Column(Float, default=0.0)
    actions = Column(JSON, nullable=True)
    cost_per_action_type = Column(JSON, nullable=True)
    action_values = Column(JSON, nullable=True)
    # Today-only stats (updated each sync cycle with time_range=today)
    today_date = Column(String, nullable=True)
    today_spend = Column(String, default='0.00')
    today_impressions = Column(String, default='0')
    today_clicks = Column(String, default='0')
    today_ctr = Column(String, default='0')
    today_cpc = Column(String, default='0')
    today_cpm = Column(String, default='0')
    today_results = Column(Integer, default=0)
    today_purchase_revenue = Column(Float, default=0.0)
    today_actions = Column(JSON, nullable=True)
    today_action_values = Column(JSON, nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('fb_ad_id', 'ad_account_id', name='uq_sync_ad'),
    )


class PublishBatch(Base):
    __tablename__ = "publish_batches"

    id = Column(String, primary_key=True, default=generate_uuid)
    status = Column(String, nullable=False, default='in_progress')  # in_progress, completed, partial, discarded
    fb_campaign_id = Column(String, nullable=True)
    fb_adset_id = Column(String, nullable=True)
    campaign_data = Column(JSON, nullable=True)
    adset_data = Column(JSON, nullable=True)
    creative_data = Column(JSON, nullable=True)
    ads_data = Column(JSON, nullable=True)  # Per-ad status tracking
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="SET NULL"), nullable=True, index=True)
    ad_account_id = Column(String, nullable=True)
    total_ads = Column(Integer, default=0)
    completed_ads = Column(Integer, default=0)
    failed_ads = Column(Integer, default=0)
    error_log = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CampaignTemplate(Base):
    __tablename__ = "campaign_templates"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    campaign_config = Column(JSON, nullable=False)
    adset_config = Column(JSON, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WinningAd(Base):
    __tablename__ = "winning_ads"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    image_url = Column(String, nullable=False)
    notes = Column(Text, nullable=True)
    tags = Column(Text, nullable=True)
    analysis = Column(Text, nullable=True)
    recreation_prompt = Column(Text, nullable=True)
    topic = Column(String, nullable=True)
    mood = Column(String, nullable=True)
    subject_matter = Column(String, nullable=True)
    copy_analysis = Column(Text, nullable=True)
    product_name = Column(String, nullable=True)
    category = Column(String, nullable=True)
    design_style = Column(String, nullable=True)
    filename = Column(String, nullable=True)
    structural_analysis = Column(Text, nullable=True)
    layering = Column(Text, nullable=True)
    template_structure = Column(JSON, nullable=True)
    color_palette = Column(JSON, nullable=True)
    typography_system = Column(JSON, nullable=True)
    copy_patterns = Column(JSON, nullable=True)
    visual_elements = Column(JSON, nullable=True)
    template_category = Column(String, nullable=True)
    
    # Ad Remix Engine fields
    blueprint_json = Column(JSON, nullable=True)  # Stores the deconstructed blueprint
    blueprint_analyzed_at = Column(DateTime(timezone=True), nullable=True)  # When blueprint was created
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    generated_ads = relationship("GeneratedAd", back_populates="template")

class GeneratedAd(Base):
    __tablename__ = "generated_ads"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    product_id = Column(String, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    template_id = Column(String, ForeignKey("winning_ads.id", ondelete="SET NULL"), nullable=True, index=True)
    image_url = Column(String, nullable=True)  # Changed to nullable for video ads
    headline = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    cta = Column(String, nullable=True)
    size_name = Column(String, nullable=True)
    dimensions = Column(String, nullable=True)
    prompt = Column(Text, nullable=True)
    ad_bundle_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Video support fields
    media_type = Column(String, default='image')  # 'image' or 'video'
    video_url = Column(String, nullable=True)
    video_id = Column(String, nullable=True)  # Facebook video ID
    thumbnail_url = Column(String, nullable=True)

    brand = relationship("Brand", back_populates="generated_ads")
    template = relationship("WinningAd", back_populates="generated_ads")

class Vertical(Base):
    __tablename__ = "verticals"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False, unique=True, index=True)  # e.g., "Legal", "Fitness", "E-commerce"
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    saved_searches = relationship("SavedSearch", back_populates="vertical")


class FacebookPage(Base):
    __tablename__ = "facebook_pages"

    id = Column(String, primary_key=True, default=generate_uuid)
    page_name = Column(String, nullable=False, unique=True, index=True)
    page_url = Column(String, nullable=True)
    vertical_id = Column(String, ForeignKey('verticals.id', ondelete='SET NULL'), nullable=True, index=True)
    total_ads = Column(Integer, default=0)  # Cached count of ads from this page
    first_seen = Column(DateTime(timezone=True), server_default=func.now())
    last_seen = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    vertical = relationship("Vertical")
    ads = relationship("ScrapedAd", back_populates="facebook_page")


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id = Column(String, primary_key=True, default=generate_uuid)
    query = Column(String, nullable=False)
    country = Column(String, nullable=True)
    negative_keywords = Column(JSON, nullable=True)  # List of negative keywords
    vertical_id = Column(String, ForeignKey('verticals.id', ondelete='SET NULL'), nullable=True, index=True)
    search_type = Column(String, default='one_time')  # 'one_time', 'scheduled_daily', 'scheduled_weekly'
    schedule_config = Column(JSON, nullable=True)  # Cron schedule config for scheduled searches
    is_active = Column(Boolean, default=True)  # For scheduled searches
    last_run = Column(DateTime(timezone=True), nullable=True)
    ads_requested = Column(Integer, nullable=True)  # How many ads were requested (limit)
    ads_returned = Column(Integer, nullable=True)  # How many ads API returned
    ads_new = Column(Integer, nullable=True)  # How many new ads (not duplicates)
    ads_duplicate = Column(Integer, nullable=True)  # How many duplicate ads
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    vertical = relationship("Vertical", back_populates="saved_searches")
    ads = relationship("ScrapedAd", back_populates="saved_search", cascade="all, delete-orphan")


class ApiUsageLog(Base):
    __tablename__ = "api_usage_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    endpoint = Column(String, nullable=False)  # "facebook_ads_library"
    api_calls = Column(Integer, nullable=False)  # Number of API calls made
    ads_returned = Column(Integer, nullable=False)  # Ads returned from API
    ads_saved = Column(Integer, nullable=False)  # Ads saved after filtering
    query = Column(String, nullable=True)  # Search query
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD for daily grouping


class PageBlacklist(Base):
    __tablename__ = "page_blacklist"

    id = Column(String, primary_key=True, default=generate_uuid)
    page_name = Column(String, nullable=False, unique=True, index=True)  # Facebook page name
    reason = Column(String, nullable=True)  # Optional reason for blacklisting
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class KeywordBlacklist(Base):
    __tablename__ = "keyword_blacklist"

    id = Column(String, primary_key=True, default=generate_uuid)
    keyword = Column(String, nullable=False, unique=True, index=True)  # Keyword to filter
    reason = Column(String, nullable=True)  # Optional reason for blacklisting
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class SearchLog(Base):
    __tablename__ = "search_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    search_query = Column(String, nullable=False)
    country = Column(String, nullable=True)
    negative_keywords = Column(JSON, nullable=True)  # List of keywords excluded
    vertical_id = Column(String, ForeignKey('verticals.id', ondelete='SET NULL'), nullable=True, index=True)

    # Metrics
    total_ads_found = Column(Integer, default=0)  # Total ads returned from API
    filtered_by_page_blacklist = Column(Integer, default=0)  # Ads filtered by page blacklist
    filtered_by_keyword_blacklist = Column(Integer, default=0)  # Ads filtered by keyword blacklist
    final_ads_saved = Column(Integer, default=0)  # Final count after all filtering

    # New pages discovered
    new_pages_blacklisted = Column(JSON, nullable=True)  # List of page names added to blacklist during/after search

    # Execution details
    api_calls_made = Column(Integer, default=0)
    search_type = Column(String, nullable=True)  # 'one_time', 'scheduled_daily', 'scheduled_weekly'
    execution_time_seconds = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD for daily grouping

    vertical = relationship("Vertical")


class ScrapedAd(Base):
    __tablename__ = "scraped_ads"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_name = Column(String, nullable=True)  # DEPRECATED: Use facebook_page relationship instead
    headline = Column(String, nullable=True)  # Ad headline
    ad_copy = Column(Text, nullable=True)  # Ad body text
    cta_text = Column(String, nullable=True)
    platform = Column(String, default='facebook')
    external_id = Column(String, nullable=True, unique=True, index=True)  # ID from platform
    content_hash = Column(String, nullable=True, unique=True, index=True)  # Hash of ad content for deduplication
    ad_link = Column(String, nullable=False)  # Link to original ad on FB Ads Library
    platforms = Column(JSON, nullable=True)  # ['facebook', 'instagram'] etc
    start_date = Column(String, nullable=True)  # When ad started running
    media_type = Column(String, nullable=True)  # 'image', 'video', or 'carousel'
    first_seen = Column(DateTime(timezone=True), server_default=func.now())  # First time ad was scraped
    last_seen = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())  # Last time ad was seen
    seen_count = Column(Integer, default=1)  # Number of times this ad has been encountered in scrapes
    search_id = Column(String, ForeignKey('saved_searches.id', ondelete='CASCADE'), nullable=True, index=True)  # Link to search
    facebook_page_id = Column(String, ForeignKey('facebook_pages.id', ondelete='SET NULL'), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    saved_search = relationship("SavedSearch", back_populates="ads")
    facebook_page = relationship("FacebookPage", back_populates="ads")

class Prompt(Base):
    __tablename__ = "prompts"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    type = Column(String, nullable=False, server_default='prompt')  # 'prompt', 'doc', or 'research'
    description = Column(Text, nullable=True)
    variables = Column(JSON, nullable=True)  # List of variable names
    template = Column(Text, nullable=False)  # The actual prompt template / doc content
    notes = Column(Text, nullable=True)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    files = Column(JSON, nullable=True)  # List of {name, url, size, type} objects
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class AdStyle(Base):
    __tablename__ = "ad_styles"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    best_for = Column(JSON, nullable=True)  # List of industries
    visual_layout = Column(String, nullable=True)
    psychology = Column(Text, nullable=True)
    mood = Column(String, nullable=True)
    lighting = Column(String, nullable=True)
    composition = Column(String, nullable=True)
    design_style = Column(String, nullable=True)
    prompt = Column(Text, nullable=True)  # Image generation prompt
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class BrandScrape(Base):
    """Tracks scraping sessions for a specific Facebook page/brand."""
    __tablename__ = "brand_scrapes"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_name = Column(String, nullable=False, index=True)  # User-defined name, also R2 folder name
    page_id = Column(String, nullable=False)  # FB page ID from URL
    page_name = Column(String, nullable=True)  # Actual FB page name (discovered during scrape)
    page_url = Column(String, nullable=False)  # Original FB Ads Library URL
    total_ads = Column(Integer, default=0)  # Total ads found
    media_downloaded = Column(Integer, default=0)  # Successfully downloaded media count
    status = Column(String, default='pending')  # pending, scraping, completed, failed
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    ads = relationship("BrandScrapedAd", back_populates="brand_scrape", cascade="all, delete-orphan")


class BrandScrapedAd(Base):
    """Individual ad scraped from a brand's Facebook page with media stored on R2."""
    __tablename__ = "brand_scraped_ads"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_scrape_id = Column(String, ForeignKey('brand_scrapes.id', ondelete='CASCADE'), nullable=False, index=True)
    external_id = Column(String, nullable=False, index=True)  # FB ad library ID
    page_name = Column(String, nullable=True)  # Facebook page name
    page_link = Column(String, nullable=True)  # Link to page's ads in library
    headline = Column(String, nullable=True)
    ad_copy = Column(Text, nullable=True)
    cta_text = Column(String, nullable=True)
    media_type = Column(String, nullable=True)  # image, video, carousel
    media_urls = Column(JSON, nullable=True)  # R2 URLs for downloaded media
    original_media_urls = Column(JSON, nullable=True)  # Original FB media URLs
    platforms = Column(JSON, nullable=True)  # ['facebook', 'instagram']
    start_date = Column(String, nullable=True)
    ad_link = Column(String, nullable=True)  # FB Ads Library link
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    brand_scrape = relationship("BrandScrape", back_populates="ads")


class AdLibraryItem(Base):
    __tablename__ = "ad_library_items"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String, nullable=True)
    media_type = Column(String, nullable=False, default="image")  # 'image' or 'video'
    aspect_ratio = Column(String, nullable=True)  # '1:1', '9:16', etc.
    media_url = Column(String, nullable=False)
    thumbnail_url = Column(String, nullable=True)
    variants = Column(JSON, nullable=True)  # {"1:1": "url_square", "9:16": "url_story"}
    file_size = Column(Integer, nullable=True)
    headline = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    cta = Column(String, nullable=True)
    tags = Column(JSON, nullable=True)  # ["testimonial", "Q1"]
    funnel_stage = Column(String, nullable=True)  # tofu, mofu, bofu
    ad_format = Column(String, nullable=True)  # single_image, carousel, story, reel, ugc, testimonial
    status = Column(String, nullable=False, default="draft")  # draft, ready, active, archived
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    file_hash = Column(String, nullable=True)  # SHA-256 hash for dedup
    folder_id = Column(String, ForeignKey("ad_library_folders.id", ondelete="SET NULL"), nullable=True, index=True)

    brand = relationship("Brand")
    folder = relationship("AdLibraryFolder", back_populates="items")


class AdLibraryFolder(Base):
    __tablename__ = "ad_library_folders"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    media_type = Column(String, nullable=False, default="image")  # 'image' or 'video'
    aspect_ratio = Column(String, nullable=True)  # '1:1', '9:16', etc.
    name = Column(String, nullable=False)
    position = Column(Integer, nullable=True, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    brand = relationship("Brand")
    items = relationship("AdLibraryItem", back_populates="folder")

    __table_args__ = (
        UniqueConstraint('brand_id', 'media_type', 'aspect_ratio', 'name', name='uq_folder_brand_media_ar_name'),
    )


class Headline(Base):
    __tablename__ = "headlines"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    text = Column(Text, nullable=False)
    category = Column(String, nullable=True)  # curiosity, urgency, benefit, social_proof, fomo
    source = Column(String, default="ai")     # ai or manual
    research_doc_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    brand = relationship("Brand")
    product = relationship("Product")


class Lander(Base):
    __tablename__ = "landers"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    url = Column(String, nullable=False)
    title = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)
    screenshot_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    brand = relationship("Brand")


class Competitor(Base):
    __tablename__ = "competitors"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    fb_page_id = Column(String, nullable=False, unique=True)
    fb_ads_library_url = Column(String, nullable=True)
    group_name = Column(String, nullable=True)  # Folder/group (e.g. "Rejuvacare", "Lulutox")
    notes = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Conversion(Base):
    __tablename__ = "conversions"

    id = Column(String, primary_key=True, default=generate_uuid)
    click_id = Column(String, nullable=True, index=True)
    fb_campaign_id = Column(String, nullable=True, index=True)
    fb_adset_id = Column(String, nullable=True, index=True)
    fb_ad_id = Column(String, nullable=True, index=True)
    payout = Column(Float, nullable=True, default=0)
    revenue = Column(Float, nullable=True, default=0)
    status = Column(String, default='approved')
    source = Column(String, default='everflow')
    offer_id = Column(String, nullable=True)
    transaction_id = Column(String, nullable=True, unique=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class HostingAccount(Base):
    __tablename__ = "hosting_accounts"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)  # e.g. "Namecheap - advicealchemy"
    ftp_host = Column(String, nullable=False)  # e.g. "ftp.advicealchemy.com"
    ftp_port = Column(Integer, default=21)  # FTP=21, SFTP=21098
    ftp_username = Column(String, nullable=False)
    ftp_password_encrypted = Column(Text, nullable=False)  # Fernet-encrypted
    ftp_protocol = Column(String, default="ftp")  # "ftp" or "sftp"
    primary_domain = Column(String, nullable=True)  # files go to public_html/ for this domain
    base_path = Column(String, default="public_html")  # root path on server
    cpanel_host = Column(String, nullable=True)  # e.g. "premium52.web-hosting.com"
    cpanel_username = Column(String, nullable=True)  # e.g. "advidchf"
    cpanel_api_token = Column(Text, nullable=True)  # cPanel API token (stored encrypted)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    domains = relationship("Domain", back_populates="hosting_account")


class Domain(Base):
    __tablename__ = "domains"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False, unique=True, index=True)
    brand_id = Column(String, ForeignKey('brands.id', ondelete='SET NULL'), nullable=True, index=True)
    ad_account_id = Column(String, nullable=True, unique=True)  # 1:1 — one ad account per domain
    hosting_account_id = Column(String, ForeignKey('hosting_accounts.id', ondelete='SET NULL'), nullable=True, index=True)
    registrar = Column(String, default='namecheap')
    status = Column(String, default='pending')  # pending, registered, active, expired, failed
    namecheap_order_id = Column(String, nullable=True)
    cloudflare_zone_id = Column(String, nullable=True)
    cloudflare_nameservers = Column(JSON, nullable=True)
    dns_configured = Column(Boolean, default=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    hosting_account = relationship("HostingAccount", back_populates="domains")
    dns_records = relationship("DomainDnsRecord", back_populates="domain", cascade="all, delete-orphan")


class DomainDnsRecord(Base):
    __tablename__ = "domain_dns_records"

    id = Column(String, primary_key=True, default=generate_uuid)
    domain_id = Column(String, ForeignKey('domains.id', ondelete='CASCADE'), nullable=False, index=True)
    record_type = Column(String, nullable=False)  # A, CNAME, TXT, MX
    name = Column(String, nullable=False)  # e.g. "clicks"
    value = Column(String, nullable=False)  # e.g. "cname.flareclickhero.com"
    proxied = Column(Boolean, default=True)
    cf_record_id = Column(String, nullable=True)  # Cloudflare record ID
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    domain = relationship("Domain", back_populates="dns_records")


class CloakerCampaign(Base):
    """Links a domain to a Traffic Armor cloaking campaign."""
    __tablename__ = "cloaker_campaigns"

    id = Column(String, primary_key=True, default=generate_uuid)
    domain_id = Column(String, ForeignKey('domains.id', ondelete='CASCADE'), nullable=False, index=True)
    ad_account_id = Column(String, nullable=True)  # FB ad account (e.g. act_123)
    persona_id = Column(String, ForeignKey('personas.id', ondelete='SET NULL'), nullable=True, index=True)
    fb_page_id = Column(String, nullable=True)  # FB page ID from tracked_pages
    ta_campaign_number = Column(Integer, nullable=True)  # Traffic Armor campaign number
    ta_campaign_id = Column(String, nullable=True)  # Traffic Armor c8_key / cloak_link_id
    name = Column(String, nullable=False)
    safe_page_id = Column(String, ForeignKey('safe_pages.id', ondelete='SET NULL'), nullable=True, index=True)
    safe_page_url = Column(String, nullable=True)  # Cloudflare Worker URL or custom
    money_page_url = Column(String, nullable=True)  # ClickFlare campaign URL
    safe_page_content = Column(Text, nullable=True)  # HTML content for the safe page
    status = Column(String, default='draft')  # draft, active, paused, archived
    # Cloaking rules (full TA config stored as JSON)
    ta_rules = Column(JSON, nullable=True)  # All Traffic Armor rules (location, ISP, devices, etc.)
    deadbolt = Column(Boolean, default=False)  # Force ALL traffic to safe page (testing mode)
    consent_prompt = Column(Boolean, default=False)  # Cookie consent modal (cloaking layer)
    delivery_method = Column(String(20), default="iframe")  # iframe | custom_js | paste_html
    ta_integration_code = Column(Text, nullable=True)  # TA integration script (paste from TA dashboard)
    # Worker deployment
    worker_deployed = Column(Boolean, default=False)
    worker_route = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    domain = relationship("Domain")
    safe_page = relationship("SafePage")


class SwipeFile(Base):
    __tablename__ = "swipe_files"

    id = Column(String, primary_key=True, default=generate_uuid)
    # Ad content
    headline = Column(String, nullable=True)
    primary_text = Column(Text, nullable=True)
    cta_text = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    image_url = Column(String, nullable=True)
    video_url = Column(String, nullable=True)
    thumbnail_url = Column(String, nullable=True)
    landing_page_url = Column(String, nullable=True)
    # Source info
    platform = Column(String, nullable=True, index=True)  # facebook, instagram, tiktok, youtube
    source_url = Column(String, nullable=True, index=True)  # original post/ad link
    source_type = Column(String, default="manual")  # ad_library, tiktok_creative_center, telegram, manual, ig_sync, url_drop
    advertiser_name = Column(String, nullable=True)
    advertiser_page_url = Column(String, nullable=True)
    ad_library_id = Column(String, nullable=True, unique=True)  # dedup key
    # Intelligence
    first_seen = Column(DateTime(timezone=True), nullable=True)
    last_seen = Column(DateTime(timezone=True), nullable=True)
    days_running = Column(Integer, nullable=True)
    ai_analysis = Column(JSON, nullable=True)  # hook type, copy framework, creative style, offer
    deep_analysis = Column(JSON, nullable=True)  # rich "Why It Works" analysis from AI Analyzer
    niche = Column(String, nullable=True, index=True)
    category = Column(String, nullable=True)  # specific sub-category (e.g. neuropathy patches, detox tea, GLP-1 telehealth)
    creative_type = Column(String, nullable=True)  # ugc, static, carousel, video
    # Organization
    tags = Column(JSON, nullable=True)
    collection = Column(String, nullable=True, index=True)  # folder/group name
    is_starred = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    brand = relationship("Brand")


class NativeAdConnection(Base):
    __tablename__ = "native_ad_connections"

    id = Column(String, primary_key=True, default=generate_uuid)
    platform = Column(String, nullable=False)  # "taboola", "outbrain", "newsbreak"
    name = Column(String, nullable=False)
    client_id = Column(String, nullable=True)
    client_secret = Column(String, nullable=True)
    api_token = Column(String, nullable=True)
    account_id = Column(String, nullable=True)
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    last_verified = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AppSetting(Base):
    """Simple key-value store for app settings that need to survive deploys."""
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─── Persona Farm Models ─────────────────────────────────────────────────────

class Persona(Base):
    __tablename__ = "personas"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False, unique=True)
    gender = Column(String, nullable=False)  # poster's gender
    age = Column(Integer, nullable=False)  # poster's age
    subject_gender = Column(String, nullable=True)  # who the story is about (for male posters about wife)
    subject_age = Column(Integer, nullable=True)
    posting_about = Column(String, nullable=True)  # e.g. "wife Tammy", null if self
    location_city = Column(String, nullable=False)
    location_state = Column(String, nullable=False)
    occupation = Column(String, nullable=False)
    family_details = Column(JSON, nullable=True)  # {spouse, kids, grandkids}
    weight_loss_backstory = Column(Text, nullable=True)
    personality_voice = Column(Text, nullable=True)
    story_angle = Column(Text, nullable=True)
    body_type_description = Column(Text, nullable=True)  # legacy
    # Weight stats
    before_weight = Column(Integer, nullable=True)  # lbs
    after_weight = Column(Integer, nullable=True)
    total_lost = Column(Integer, nullable=True)
    timeline_months = Column(Integer, nullable=True)
    start_month = Column(String, nullable=True)
    # Body type for AI images
    body_type_before = Column(Text, nullable=True)  # 2-3 sentences, heavy description
    body_type_after = Column(Text, nullable=True)  # 2-3 sentences, slim description
    # Physical description (face matching across images)
    hair = Column(String, nullable=True)
    ethnicity = Column(String, nullable=True)
    distinguishing_features = Column(String, nullable=True)
    # Story elements
    shame_moment = Column(Text, nullable=True)
    authority_figure = Column(Text, nullable=True)
    # Assignments
    fb_page_id = Column(String, nullable=True, unique=True)  # 1:1 — one persona per FB page
    fb_page_access_token = Column(String, nullable=True)
    fb_ad_account_id = Column(String, nullable=True)  # FB ad account (e.g. act_123)
    domain_id = Column(String, ForeignKey("domains.id", ondelete="SET NULL"), nullable=True, index=True, unique=True)  # 1:1 — one persona per domain
    profile_photo_set = Column(JSON, nullable=True)
    before_after_photo_sets = Column(JSON, nullable=True)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    offer = Column(String, default='akemi', index=True)
    reference_image_url = Column(String, nullable=True)
    current_weight_claim = Column(Integer, nullable=True)
    max_weight_claim = Column(Integer, nullable=True)
    weight_claim_last_updated = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True, index=True)
    # Winner tracking
    is_winner = Column(Boolean, default=False, index=True)
    winner_notes = Column(Text, nullable=True)
    winner_proven_offers = Column(JSON, nullable=True)  # ["akemi", "patch", "slim"]
    winner_promoted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    posts = relationship("PersonaPost", back_populates="persona", cascade="all, delete-orphan")
    comments = relationship("PersonaComment", back_populates="persona", cascade="all, delete-orphan",
                           foreign_keys="PersonaComment.persona_id")
    image_prompts = relationship("PersonaImagePrompt", back_populates="persona", cascade="all, delete-orphan")
    images = relationship("PersonaImage", back_populates="persona", cascade="all, delete-orphan")
    brand = relationship("Brand")
    domain = relationship("Domain")

    __table_args__ = (
        UniqueConstraint('location_city', 'location_state', name='uq_persona_location'),
    )


class PersonaImage(Base):
    __tablename__ = "persona_images"

    id = Column(String, primary_key=True, default=generate_uuid)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String, nullable=False)  # before, after, before_after, old_clothes, profile, lifestyle
    url = Column(String, nullable=False)
    filename = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    persona = relationship("Persona", back_populates="images")


class PersonaPost(Base):
    __tablename__ = "persona_posts"

    id = Column(String, primary_key=True, default=generate_uuid)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), nullable=False, index=True)
    post_type = Column(String, nullable=False)
    headline = Column(String, nullable=True)
    body_text = Column(Text, nullable=False)
    photo_type = Column(String, nullable=True)
    photo_set_index = Column(Integer, nullable=True)
    fb_post_id = Column(String, nullable=True)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default='draft', index=True)
    engagement_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    persona = relationship("Persona", back_populates="posts")
    comments = relationship("PersonaComment", back_populates="post", cascade="all, delete-orphan",
                           foreign_keys="PersonaComment.post_id")


class PersonaComment(Base):
    __tablename__ = "persona_comments"

    id = Column(String, primary_key=True, default=generate_uuid)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), nullable=False, index=True)
    post_id = Column(String, ForeignKey("persona_posts.id", ondelete="SET NULL"), nullable=True, index=True)
    commenter_persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True, index=True)
    comment_type = Column(String, nullable=False)
    body_text = Column(Text, nullable=False)
    photo_path = Column(String, nullable=True)
    affiliate_url = Column(String, nullable=True)
    delay_minutes = Column(Integer, nullable=True)
    fb_comment_id = Column(String, nullable=True)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default='draft', index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    persona = relationship("Persona", back_populates="comments", foreign_keys=[persona_id])
    post = relationship("PersonaPost", back_populates="comments", foreign_keys=[post_id])
    commenter = relationship("Persona", foreign_keys=[commenter_persona_id])


class PersonaRotationLog(Base):
    __tablename__ = "persona_rotation_log"

    id = Column(String, primary_key=True, default=generate_uuid)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), nullable=False, index=True)
    action_type = Column(String, nullable=False)
    target_persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True, index=True)
    target_post_id = Column(String, ForeignKey("persona_posts.id", ondelete="SET NULL"), nullable=True, index=True)
    executed_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AffiliateUrl(Base):
    __tablename__ = "affiliate_urls"

    id = Column(String, primary_key=True, default=generate_uuid)
    url = Column(String, nullable=False)
    domain = Column(String, nullable=False)
    offer = Column(String, nullable=False, default='akemi')
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PersonaImagePrompt(Base):
    __tablename__ = "persona_image_prompts"

    id = Column(String, primary_key=True, default=generate_uuid)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), nullable=False, index=True)
    prompt_type = Column(String, nullable=False)
    prompt_text = Column(Text, nullable=False)
    generated_image_path = Column(String, nullable=True)
    status = Column(String, default='pending', index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    persona = relationship("Persona", back_populates="image_prompts")


class ScheduledBudgetChange(Base):
    __tablename__ = "scheduled_budget_changes"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_object_id = Column(String, nullable=False)
    object_type = Column(String, nullable=False)  # 'campaign' or 'adset'
    new_daily_budget = Column(Integer, nullable=False)  # In cents
    scheduled_for = Column(DateTime(timezone=True), nullable=False)
    status = Column(String, default='pending', index=True)  # pending, applied, failed, cancelled
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    ad_account_id = Column(String, nullable=False)
    error_message = Column(Text, nullable=True)
    applied_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AutoSafeLog(Base):
    __tablename__ = "auto_safe_log"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_ad_id = Column(String, nullable=False, unique=True)
    fb_ad_name = Column(String, nullable=True)
    rejection_reasons = Column(JSON, nullable=True)
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    ad_account_id = Column(String, nullable=False)
    status = Column(String, default='safed')  # safed, failed
    error_message = Column(Text, nullable=True)
    safed_at = Column(DateTime(timezone=True), server_default=func.now())


class TrackedPage(Base):
    __tablename__ = "tracked_pages"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_page_id = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    picture_url = Column(String, nullable=True)
    brand_id = Column(String, ForeignKey('brands.id', ondelete='SET NULL'), nullable=True, index=True)
    ad_account_id = Column(String, nullable=True)
    domain_id = Column(String, ForeignKey('domains.id', ondelete='SET NULL'), nullable=True, index=True)
    connection_id = Column(String, ForeignKey('facebook_connections.id', ondelete='SET NULL'), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    last_post_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    brand = relationship("Brand")
    domain = relationship("Domain")


class SafePage(Base):
    __tablename__ = "safe_pages"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=True)
    generator_type = Column(String, nullable=False, default="blog")  # blog, wordpress, app_store, product_review
    theme = Column(String, nullable=True)  # health, finance, tech, lifestyle, etc.
    language = Column(String, default="en")
    keywords = Column(String, nullable=True)  # comma-separated
    domain_name = Column(String, nullable=True)
    domain_id = Column(String, ForeignKey('domains.id', ondelete='SET NULL'), nullable=True, index=True)
    num_pages = Column(Integer, default=1)
    deployed = Column(Boolean, default=False)  # True when deployed to domain via CF Worker

    # Additional settings
    page_title = Column(String, nullable=True)
    redirect_link = Column(String, nullable=True)
    button_redirect = Column(Boolean, default=False)
    form_redirect = Column(Boolean, default=False)
    index_filename = Column(String, default="index.html")

    # TOS & Privacy
    company_name = Column(String, nullable=True)
    tos_domain = Column(String, nullable=True)
    phone_number = Column(String, nullable=True)
    email = Column(String, nullable=True)

    # Code injection
    pixel_code = Column(Text, nullable=True)
    head_code = Column(Text, nullable=True)
    body_start_code = Column(Text, nullable=True)
    body_end_code = Column(Text, nullable=True)

    # Output
    status = Column(String, default="pending", index=True)  # pending, generating, completed, failed
    preview_html = Column(Text, nullable=True)
    zip_url = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    domain = relationship("Domain", foreign_keys=[domain_id])


class CodePreset(Base):
    __tablename__ = "code_presets"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    slot = Column(String, nullable=False)  # pixel, head, body_start, body_end
    code = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ─── Budget Surfing ───────────────────────────────────────────────────────────

class BudgetSurfConfig(Base):
    __tablename__ = "budget_surf_configs"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_object_id = Column(String, nullable=False, unique=True)
    object_type = Column(String, nullable=False)  # 'campaign' or 'adset'
    ad_account_id = Column(String, nullable=False)
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    base_budget_cents = Column(Integer, nullable=False)  # original daily budget in cents
    noon_multiplier = Column(Float, default=2.0)  # multiplier at noon for winners
    afternoon_multiplier = Column(Float, default=4.0)  # multiplier at 4pm for winners
    min_conversions = Column(Integer, default=10)  # threshold to be a "winner"
    enabled = Column(Boolean, default=True)
    paused_by_surf = Column(Boolean, default=False)  # True if surf paused this object
    current_phase = Column(String, default='base')  # base, noon, afternoon
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BudgetSurfLog(Base):
    __tablename__ = "budget_surf_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    surf_config_id = Column(String, ForeignKey("budget_surf_configs.id", ondelete="CASCADE"), nullable=False, index=True)
    fb_object_id = Column(String, nullable=False)
    action = Column(String, nullable=False)  # 'reset', 'doubled', 'paused', 'reactivated', 'quadrupled'
    old_budget_cents = Column(Integer, nullable=True)
    new_budget_cents = Column(Integer, nullable=True)
    conversions = Column(Integer, nullable=True)  # conversions at time of action
    phase = Column(String, nullable=True)  # 'midnight', 'noon', 'afternoon'
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BidSchedulePreset(Base):
    """Named templates of bid-cap rules — e.g. "FSP-USA peak/valley" stores
    [{08:30 $61}, {23:00 $50}] once, applies to any campaign/adset later."""
    __tablename__ = "bid_schedule_presets"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False, unique=True)
    # JSON array of {hour, minute, bid_amount_cents, active_days, timezone, label}
    rules = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BidSchedule(Base):
    """Recurring bid-cap changes. One row = "at HH:MM in <tz> on <days>, set bid to X".
    Bid persists until the next rule fires. Only applies to adsets/campaigns on
    capped strategies (LOWEST_COST_WITH_BID_CAP / COST_CAP / BID_CAP)."""
    __tablename__ = "bid_schedules"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_object_id = Column(String, nullable=False, index=True)
    object_type = Column(String, default="adset")  # 'adset' or 'campaign'
    ad_account_id = Column(String, nullable=False)
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    hour = Column(Integer, nullable=False)  # 0-23, local to `timezone`
    minute = Column(Integer, default=0)  # 0-59
    active_days = Column(JSON, default=[0, 1, 2, 3, 4, 5, 6])  # 0=Mon..6=Sun
    timezone = Column(String, default="America/New_York")
    bid_amount_cents = Column(Integer, nullable=False)  # account-currency cents
    enabled = Column(Boolean, default=True)
    last_applied_at = Column(DateTime(timezone=True), nullable=True)
    last_applied_bid_cents = Column(Integer, nullable=True)
    last_error = Column(Text, nullable=True)
    label = Column(String, nullable=True)  # optional human label ("peak", "valley", etc.)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DaypartSchedule(Base):
    __tablename__ = "daypart_schedules"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_adset_id = Column(String, nullable=False, unique=True)  # also used for campaign IDs
    object_type = Column(String, default="adset")  # 'adset' or 'campaign'
    ad_account_id = Column(String, nullable=False)
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    active_start_hour = Column(Integer, nullable=False)  # 0-23
    active_start_minute = Column(Integer, default=0)  # 0-59
    active_end_hour = Column(Integer, nullable=False)  # 0-23
    active_end_minute = Column(Integer, default=0)  # 0-59
    active_days = Column(JSON, default=[0, 1, 2, 3, 4, 5, 6])  # 0=Mon..6=Sun
    timezone = Column(String, default="America/New_York")
    enabled = Column(Boolean, default=True)
    last_action = Column(String, nullable=True)  # 'activated' or 'paused'
    last_action_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─── Comment Farm ─────────────────────────────────────────────────────────────

class CommentFarmJob(Base):
    __tablename__ = "comment_farm_jobs"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=True)  # optional label
    target_post_id = Column(String, nullable=False)  # FB post ID (pageId_postId)
    target_type = Column(String, nullable=False, default="persona_post")  # persona_post, ad, manual
    persona_post_id = Column(String, ForeignKey("persona_posts.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True, index=True)
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    affiliate_url = Column(String, nullable=True)  # link to drop in first comment
    original_post_text = Column(Text, nullable=True)  # cached post text for AI generation
    status = Column(String, default="draft")  # draft, in_progress, completed, failed
    total_entries = Column(Integer, default=0)
    posted_entries = Column(Integer, default=0)
    failed_entries = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    entries = relationship("CommentFarmEntry", back_populates="job", cascade="all, delete-orphan")
    reactions = relationship("CommentFarmReaction", back_populates="job", cascade="all, delete-orphan")
    owner_persona = relationship("Persona", foreign_keys=[owner_persona_id])
    connection = relationship("FacebookConnection")


class CommentFarmEntry(Base):
    __tablename__ = "comment_farm_entries"

    id = Column(String, primary_key=True, default=generate_uuid)
    job_id = Column(String, ForeignKey("comment_farm_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True, index=True)
    entry_type = Column(String, nullable=False)  # link_drop, testimonial, short_reaction, validation, question, reply, relateable
    message = Column(Text, nullable=False)
    image_url = Column(String, nullable=True)  # photo to attach (before/after etc)
    parent_entry_id = Column(String, ForeignKey("comment_farm_entries.id", ondelete="SET NULL"), nullable=True, index=True)
    delay_minutes = Column(Integer, default=0)  # staggered delay from job start
    sort_order = Column(Integer, default=0)
    fb_comment_id = Column(String, nullable=True)  # set after posting
    status = Column(String, default="pending")  # pending, posted, failed, skipped
    posted_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    job = relationship("CommentFarmJob", back_populates="entries")
    persona = relationship("Persona")
    parent_entry = relationship("CommentFarmEntry", remote_side="CommentFarmEntry.id")
    child_replies = relationship("CommentFarmEntry", foreign_keys=[parent_entry_id])


class CommentFarmReaction(Base):
    __tablename__ = "comment_farm_reactions"

    id = Column(String, primary_key=True, default=generate_uuid)
    job_id = Column(String, ForeignKey("comment_farm_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    entry_id = Column(String, ForeignKey("comment_farm_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True, index=True)
    reaction_type = Column(String, default="LIKE")  # LIKE, LOVE, WOW, HAHA
    delay_minutes = Column(Integer, default=0)
    status = Column(String, default="pending")  # pending, done, failed
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    job = relationship("CommentFarmJob", back_populates="reactions")
    entry = relationship("CommentFarmEntry")
    persona = relationship("Persona")


# ─── Hero Sync ────────────────────────────────────────────────────────────────

class HeroMap(Base):
    __tablename__ = "hero_maps"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String, nullable=False)  # e.g. "Weight Loss Advertorial"
    landing_page_url = Column(String, nullable=True)  # optional reference URL
    image_selector = Column(String, default="img")  # CSS selector for hero image
    param_name = Column(String, default="img")  # URL query param name
    base_image_url = Column(String, nullable=True)  # Doctor/base image for composites
    layout = Column(String, default="side_by_side")  # side_by_side, left_base, right_base
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    brand = relationship("Brand")
    entries = relationship("HeroMapEntry", back_populates="hero_map", cascade="all, delete-orphan",
                          order_by="HeroMapEntry.created_at")


class HeroMapEntry(Base):
    __tablename__ = "hero_map_entries"

    id = Column(String, primary_key=True, default=generate_uuid)
    hero_map_id = Column(String, ForeignKey("hero_maps.id", ondelete="CASCADE"), nullable=False, index=True)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True, index=True)
    key = Column(String, nullable=False)  # URL param value e.g. "jennifer"
    image_url = Column(String, nullable=False)  # R2 image URL
    label = Column(String, nullable=True)  # display label e.g. "Jennifer"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    hero_map = relationship("HeroMap", back_populates="entries")
    persona = relationship("Persona")


# ─── Google Ads ───────────────────────────────────────────────────────────────

class PersonaQueueItem(Base):
    __tablename__ = "persona_queue_items"

    id = Column(String, primary_key=True, default=generate_uuid)
    brand_id = Column(String, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    image_urls = Column(JSON, default=list)  # list of R2 URLs
    gender = Column(String, nullable=True)
    ethnicity = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending, uploading, processing, done, error
    result_name = Column(String, nullable=True)  # persona name once created
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class HeadlinePreset(Base):
    """Saved headline presets per offer for quick reuse in ad creation."""
    __tablename__ = "headline_presets"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)  # e.g. "Belly Fat Tea" or "Patch Standard"
    offer = Column(String, nullable=False, index=True)  # e.g. "akemi", "patch", "slim"
    headlines = Column(JSON, nullable=False)  # ["Too Much Belly Fat? Drink This", ...]
    primary_texts = Column(JSON, nullable=True)  # optional saved body texts
    description = Column(String, nullable=True)  # optional saved description
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FBSyncDailyStats(Base):
    """Per-day per-object performance stats — enables any date range query from DB."""
    __tablename__ = "fb_sync_daily_stats"

    id = Column(String, primary_key=True, default=generate_uuid)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    object_id = Column(String, nullable=False, index=True)  # campaign/adset/ad FB ID
    object_type = Column(String, nullable=False)  # 'campaign', 'adset', 'ad'
    ad_account_id = Column(String, nullable=False, index=True)
    campaign_id = Column(String, nullable=True, index=True)
    adset_id = Column(String, nullable=True)
    object_name = Column(String, nullable=True)
    impressions = Column(String, default='0')
    clicks = Column(String, default='0')
    spend = Column(String, default='0.00')
    ctr = Column(String, default='0')
    cpc = Column(String, default='0')
    cpm = Column(String, default='0')
    reach = Column(String, default='0')
    results = Column(Integer, default=0)
    purchase_revenue = Column(Float, default=0.0)
    actions = Column(JSON, nullable=True)
    action_values = Column(JSON, nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('date', 'object_id', 'object_type', 'ad_account_id', name='uq_daily_stats'),
    )


class CachedPixel(Base):
    """Locally cached Facebook pixel — rarely changes, avoids API calls."""
    __tablename__ = "cached_pixels"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_pixel_id = Column(String, nullable=False, index=True)
    ad_account_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('fb_pixel_id', 'ad_account_id', name='uq_cached_pixel'),
    )


class GoogleAdsConnection(Base):
    __tablename__ = "google_ads_connections"

    id = Column(String, primary_key=True, default=generate_uuid)
    refresh_token = Column(Text, nullable=False)
    customer_ids = Column(JSON, default=[])  # list of accessible customer IDs
    selected_customer_id = Column(String, nullable=True)  # currently active customer ID
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SpyReport(Base):
    """Daily /spy report — scanned counts, top scored ads, and rendered markdown."""

    __tablename__ = "spy_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_date = Column(Date, nullable=False, unique=True, index=True)
    total_ads_scanned = Column(Integer, nullable=False, default=0)
    new_ads_count = Column(Integer, nullable=False, default=0)
    competitors_scanned = Column(Integer, nullable=False, default=0)
    keywords_scanned = Column(Integer, nullable=False, default=0)
    top_scraped_ad_ids = Column(ARRAY(String), nullable=False, default=list)
    score_details = Column(JSONB, nullable=False, default=dict)
    summary_markdown = Column(Text, nullable=False, default="")
    telegram_chat_id = Column(String, nullable=True)
    telegram_message_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
