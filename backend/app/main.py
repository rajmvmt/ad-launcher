"""
MVMT Printer - Backend API v1.2

Created by Jason Akatiff
iSCALE.com | A4D.com
Telegram: @jasonakatiff
Email: jason@jasonakatiff.com
"""

import os
import re
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.core.rate_limit import limiter

app = FastAPI(
    title="Facebook Ad Automation API",
    version="1.0.0",
    openapi_url="/api/v1/openapi.json",
    docs_url="/api/v1/docs",
)

# Register rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Security headers middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # Cache headers for static files (uploads, images)
    path = request.url.path
    if path.startswith("/uploads/"):
        response.headers["Cache-Control"] = "public, max-age=2592000"  # 30 days
    return response

# Trust proxy headers (Railway uses reverse proxy)
# In production, consider restricting to specific CIDR ranges
trusted_proxies = os.getenv("TRUSTED_PROXIES", "127.0.0.1")
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=[trusted_proxies] if trusted_proxies != "*" else ["*"])

# CORS origins from env var or defaults
default_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5180",
    "http://localhost:3000",
]
extra_origins = os.getenv("ALLOWED_ORIGINS", "").split(",")
allowed_origins = default_origins + [o.strip() for o in extra_origins if o.strip()]

# CORS Middleware - explicit methods and headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
    expose_headers=["X-Total-Count"],
    max_age=600,
)

@app.get("/")
async def root():
    return {"message": "Welcome to the Facebook Ad Automation API"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Database Connection Validation
@app.on_event("startup")
async def startup_event():
    """Validate PostgreSQL connection and ensure tables exist on startup"""
    from app.database import engine, Base
    from sqlalchemy import text
    import app.models  # noqa: F401 — ensure all models are imported

    import asyncio as _asyncio
    max_retries, retry_delay = 5, 5
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                result = conn.execute(text("SELECT version()"))
                version = result.scalar()
                print(f"✅ Connected to PostgreSQL")
                print(f"   Version: {version}")
            break
        except Exception as e:
            sanitized_url = re.sub(r'://[^:]+:[^@]+@', '://***:***@', settings.DATABASE_URL)
            if attempt < max_retries:
                print(f"⏳ DB connection attempt {attempt}/{max_retries} failed: {e}. Retrying in {retry_delay}s...")
                await _asyncio.sleep(retry_delay)
            else:
                print(f"❌ Failed to connect to database after {max_retries} attempts: {e}")
                print(f"   DATABASE_URL: {sanitized_url}")
                raise RuntimeError(f"Database connection failed: {e}")

    # Create any new tables (safe — skips existing tables)
    Base.metadata.create_all(bind=engine)
    print("✅ Database tables synced")

    # Add missing columns to existing tables (create_all won't ALTER)
    with engine.connect() as conn:
        # Add connection_id to facebook_campaigns if missing
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'facebook_campaigns' AND column_name = 'connection_id'
        """))
        if not result.fetchone():
            conn.execute(text("""
                ALTER TABLE facebook_campaigns
                ADD COLUMN connection_id VARCHAR REFERENCES facebook_connections(id) ON DELETE SET NULL
            """))
            conn.commit()
            print("✅ Added connection_id column to facebook_campaigns")

        # Add brand_id to facebook_campaigns if missing
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'facebook_campaigns' AND column_name = 'brand_id'
        """))
        if not result.fetchone():
            conn.execute(text("""
                ALTER TABLE facebook_campaigns
                ADD COLUMN brand_id VARCHAR REFERENCES brands(id) ON DELETE SET NULL
            """))
            conn.commit()
            print("✅ Added brand_id column to facebook_campaigns")

        # Add style_guide JSON to brands if missing
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'brands' AND column_name = 'style_guide'
        """))
        if not result.fetchone():
            conn.execute(text("""
                ALTER TABLE brands ADD COLUMN style_guide JSON
            """))
            conn.commit()
            print("✅ Added style_guide column to brands")

        # Add deep_analysis to swipe_files if missing
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'swipe_files' AND column_name = 'deep_analysis'
        """))
        if not result.fetchone():
            conn.execute(text("ALTER TABLE swipe_files ADD COLUMN deep_analysis JSON"))
            conn.commit()
            print("✅ Added deep_analysis column to swipe_files")

        # Add brand_id to personas if missing
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'personas' AND column_name = 'brand_id'
        """))
        if not result.fetchone():
            conn.execute(text("""
                ALTER TABLE personas
                ADD COLUMN brand_id VARCHAR REFERENCES brands(id) ON DELETE CASCADE
            """))
            conn.commit()
            print("✅ Added brand_id column to personas")

        # Add weight tracking + offer columns to personas
        # NOTE: col_name/col_def are hardcoded below — safe for DDL interpolation
        for col_name, col_def in [
            ("current_weight_claim", "INTEGER"),
            ("max_weight_claim", "INTEGER"),
            ("weight_claim_last_updated", "TIMESTAMP WITH TIME ZONE"),
            ("offer", "VARCHAR DEFAULT 'akemi'"),
            ("reference_image_url", "VARCHAR"),
            ("fb_ad_account_id", "VARCHAR"),
        ]:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = :table AND column_name = :col
            """), {"table": "personas", "col": col_name})
            if not result.fetchone():
                conn.execute(text(f"ALTER TABLE personas ADD COLUMN {col_name} {col_def}"))
                conn.commit()
                print(f"✅ Added {col_name} column to personas")

        # Add photo_type and engagement_count to persona_posts
        # NOTE: col_name/col_def are hardcoded below — safe for DDL interpolation
        for col_name, col_def in [
            ("photo_type", "VARCHAR"),
            ("headline", "VARCHAR"),
            ("engagement_count", "INTEGER DEFAULT 0"),
        ]:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = :table AND column_name = :col
            """), {"table": "persona_posts", "col": col_name})
            if not result.fetchone():
                conn.execute(text(f"ALTER TABLE persona_posts ADD COLUMN {col_name} {col_def}"))
                conn.commit()
                print(f"✅ Added {col_name} column to persona_posts")

        # Add deployment columns to persona_comments
        # NOTE: col_name/col_def are hardcoded below — safe for DDL interpolation
        for col_name, col_def in [
            ("post_id", "VARCHAR REFERENCES persona_posts(id) ON DELETE SET NULL"),
            ("commenter_persona_id", "VARCHAR REFERENCES personas(id) ON DELETE SET NULL"),
            ("delay_minutes", "INTEGER"),
            ("affiliate_url", "VARCHAR"),
            ("fb_comment_id", "VARCHAR"),
            ("scheduled_at", "TIMESTAMP WITH TIME ZONE"),
            ("posted_at", "TIMESTAMP WITH TIME ZONE"),
        ]:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = :table AND column_name = :col
            """), {"table": "persona_comments", "col": col_name})
            if not result.fetchone():
                conn.execute(text(f"ALTER TABLE persona_comments ADD COLUMN {col_name} {col_def}"))
                conn.commit()
                print(f"✅ Added {col_name} column to persona_comments")

        # Add updated_at to persona tables if missing
        # NOTE: table names are hardcoded below — safe for DDL interpolation
        for table in ['persona_posts', 'persona_comments', 'persona_image_prompts']:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = :table AND column_name = :col
            """), {"table": table, "col": "updated_at"})
            if not result.fetchone():
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW()"))
                conn.commit()
                print(f"✅ Added updated_at column to {table}")

        # Add created_at to persona_rotation_log if missing
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'persona_rotation_log' AND column_name = 'created_at'
        """))
        if not result.fetchone():
            conn.execute(text("ALTER TABLE persona_rotation_log ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW()"))
            conn.commit()
            print("✅ Added created_at column to persona_rotation_log")

        # Create hosting_accounts table if missing
        result = conn.execute(text("""
            SELECT table_name FROM information_schema.tables
            WHERE table_name = 'hosting_accounts'
        """))
        if not result.fetchone():
            conn.execute(text("""
                CREATE TABLE hosting_accounts (
                    id VARCHAR PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    ftp_host VARCHAR NOT NULL,
                    ftp_port INTEGER DEFAULT 21,
                    ftp_username VARCHAR NOT NULL,
                    ftp_password_encrypted TEXT NOT NULL,
                    ftp_protocol VARCHAR DEFAULT 'ftp',
                    primary_domain VARCHAR,
                    base_path VARCHAR DEFAULT 'public_html',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Created hosting_accounts table")

        # Add cPanel columns to hosting_accounts if missing
        for col_name, col_def in [
            ("cpanel_host", "VARCHAR"),
            ("cpanel_username", "VARCHAR"),
            ("cpanel_api_token", "TEXT"),
        ]:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = :table AND column_name = :col
            """), {"table": "hosting_accounts", "col": col_name})
            if not result.fetchone():
                conn.execute(text(f"ALTER TABLE hosting_accounts ADD COLUMN {col_name} {col_def}"))
                conn.commit()
                print(f"✅ Added {col_name} column to hosting_accounts")

        # Add hosting_account_id to domains if missing
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'domains' AND column_name = 'hosting_account_id'
        """))
        if not result.fetchone():
            conn.execute(text("ALTER TABLE domains ADD COLUMN hosting_account_id VARCHAR REFERENCES hosting_accounts(id) ON DELETE SET NULL"))
            conn.commit()
            print("✅ Added hosting_account_id column to domains")

        # Add last_post_at to tracked_pages if missing
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'tracked_pages' AND column_name = 'last_post_at'
        """))
        if not result.fetchone():
            conn.execute(text("ALTER TABLE tracked_pages ADD COLUMN last_post_at TIMESTAMPTZ"))
            conn.commit()
            print("✅ Added last_post_at column to tracked_pages")

        # Auto-start Telegram bot if token is configured (env var OR DB)
        telegram_token = os.environ.get("TELEGRAM_BOT_TOKEN")
        if not telegram_token:
            try:
                db_token = conn.execute(text("SELECT value FROM app_settings WHERE key = 'telegram_bot_token'")).fetchone()
                if db_token:
                    telegram_token = db_token[0]
                    os.environ["TELEGRAM_BOT_TOKEN"] = telegram_token
                    print("✅ Telegram bot token loaded from DB")
                else:
                    print("⚠️  No telegram_bot_token in DB")
            except Exception as e:
                print(f"⚠️  Failed to load telegram token from DB: {e}")
        if telegram_token:
            async def _delayed_bot_start(token, retries=6, delay=20):
                """Start Telegram bot with retries — handles polling conflicts from prior instances."""
                from app.services.telegram_bot import start_bot as _start_tg, stop_bot as _stop_tg, HAS_TELEGRAM
                if not HAS_TELEGRAM:
                    print("⚠️  TELEGRAM_BOT_TOKEN set but python-telegram-bot not installed")
                    return
                # Initial delay to let any prior polling session expire
                await asyncio.sleep(5)
                for attempt in range(retries):
                    try:
                        await _start_tg(token)
                        print("✅ Telegram bot auto-started")
                        return
                    except Exception as e:
                        if "Conflict" in str(e) and attempt < retries - 1:
                            print(f"⚠️  Telegram bot conflict (attempt {attempt+1}/{retries}), retrying in {delay}s...")
                            # Stop the failed bot instance so _running resets
                            try:
                                await _stop_tg()
                            except Exception:
                                pass
                            await asyncio.sleep(delay)
                        else:
                            print(f"⚠️  Telegram bot auto-start failed after {attempt+1} attempts: {e}")
                            try:
                                await _stop_tg()
                            except Exception:
                                pass

            # Only auto-start bot if not running locally (avoid conflicts with Railway production)
            import asyncio
            asyncio.create_task(_delayed_bot_start(telegram_token))

        # ── Auto-sync FB Pages every 24h ──────────────────────────────────
        async def _auto_sync_pages(interval_hours=24):
            """Background task: sync FB pages on startup, then every interval_hours."""
            import asyncio as _aio
            from app.database import SessionLocal as _SL
            from app.models import FacebookConnection, TrackedPage
            from app.services.facebook_service import FacebookService

            await _aio.sleep(15)  # Let startup finish

            while True:
                _db = _SL()
                try:
                    connections = _db.query(FacebookConnection).filter(
                        FacebookConnection.is_active == True
                    ).all()
                    synced = 0
                    for c in connections:
                        try:
                            svc = FacebookService(connection=c)
                            fb_pages = svc.get_pages()
                            for page in fb_pages:
                                fb_page_id = page.get("id")
                                if not fb_page_id:
                                    continue
                                name = page.get("name", "")
                                access_token = page.get("access_token", "")
                                picture_url = page.get("picture", {}).get("data", {}).get("url", "")
                                existing = _db.query(TrackedPage).filter(
                                    TrackedPage.fb_page_id == fb_page_id
                                ).first()
                                if existing:
                                    existing.name = name
                                    existing.access_token = access_token
                                    existing.picture_url = picture_url
                                    if not existing.connection_id:
                                        existing.connection_id = c.id
                                else:
                                    _db.add(TrackedPage(
                                        fb_page_id=fb_page_id,
                                        name=name,
                                        access_token=access_token,
                                        picture_url=picture_url,
                                        connection_id=c.id,
                                    ))
                                synced += 1
                        except Exception as _e:
                            print(f"⚠️  FB Pages sync error for connection {c.id}: {_e}")
                    _db.commit()
                    if synced:
                        print(f"✅ Auto-synced {synced} FB pages")
                except Exception as _e:
                    print(f"⚠️  FB Pages auto-sync failed: {_e}")
                finally:
                    _db.close()

                await _aio.sleep(interval_hours * 3600)

        import asyncio
        asyncio.create_task(_auto_sync_pages())

        # ── Auto-sync Domains → Persona Farm ─────────────────────────────
        # When domains exist without a persona, auto-create a placeholder persona
        # so the Persona Farm always reflects all active domains
        try:
            from app.models import Domain as _Domain, Persona as _Persona
            from sqlalchemy import text as _text

            unlinked_domains = conn.execute(_text("""
                SELECT d.id, d.name, d.ad_account_id, d.brand_id
                FROM domains d
                LEFT JOIN personas p ON p.domain_id = d.id
                WHERE p.id IS NULL AND d.status IN ('active', 'registered', 'pending')
            """)).fetchall()

            if unlinked_domains:
                print(f"🔗 Found {len(unlinked_domains)} domains without personas — linking...")
                for dom_id, dom_name, dom_ad_account, dom_brand_id in unlinked_domains:
                    import uuid as _uuid2
                    # Create a placeholder persona named after the domain
                    short_name = dom_name.replace('.com', '').replace('.', ' ').title()
                    conn.execute(_text("""
                        INSERT INTO personas (id, name, gender, age, location_city, location_state, occupation, domain_id, brand_id, offer, is_active)
                        VALUES (:id, :name, 'female', 30, 'New York', 'NY', 'Blogger', :domain_id, :brand_id, 'akemi', true)
                        ON CONFLICT DO NOTHING
                    """), {
                        "id": str(_uuid2.uuid4()),
                        "name": f"{short_name} (auto)",
                        "domain_id": dom_id,
                        "brand_id": dom_brand_id,
                    })
                conn.commit()
                print(f"✅ Auto-created {len(unlinked_domains)} placeholder personas for unlinked domains")
        except Exception as _e:
            print(f"⚠️  Domain→Persona auto-sync skipped: {_e}")

        # Auto-create default connection from env vars if none exist
        result = conn.execute(text("SELECT COUNT(*) FROM facebook_connections"))
        count = result.scalar()
        if count == 0:
            import os as _os
            env_token = _os.getenv("FACEBOOK_ACCESS_TOKEN") or _os.getenv("VITE_FACEBOOK_ACCESS_TOKEN")
            if env_token:
                env_app_id = _os.getenv("FACEBOOK_APP_ID") or _os.getenv("VITE_FACEBOOK_APP_ID")
                env_app_secret = _os.getenv("FACEBOOK_APP_SECRET") or _os.getenv("VITE_FACEBOOK_APP_SECRET")
                env_ad_account = _os.getenv("FACEBOOK_AD_ACCOUNT_ID") or _os.getenv("VITE_FACEBOOK_AD_ACCOUNT_ID")
                import uuid as _uuid
                conn.execute(text("""
                    INSERT INTO facebook_connections (id, name, access_token, app_id, app_secret, ad_account_id, is_default, is_active)
                    VALUES (:id, :name, :token, :app_id, :app_secret, :ad_account, true, true)
                """), {
                    "id": str(_uuid.uuid4()),
                    "name": "Default (from env)",
                    "token": env_token,
                    "app_id": env_app_id,
                    "app_secret": env_app_secret,
                    "ad_account": env_ad_account
                })
                conn.commit()
                print("✅ Auto-created default Facebook connection from env vars")

    # ── Auto-resume orphaned publish batches ───────────────────────────
    # If the container was restarted (deploy, crash, OOM) while a batch
    # was processing, the background worker thread died but the DB row
    # is still status='in_progress'. The frontend polls /publish-batches
    # /active and sees progress stuck at completed_ads/total_ads forever.
    # Re-attach a worker to each such batch on startup.
    try:
        from app.models import PublishBatch as _PublishBatch, FacebookConnection as _FacebookConnection
        from app.database import SessionLocal as _SessionLocal
        from app.services.facebook_service import FacebookService as _FacebookService
        from app.api.v1.facebook import _process_batch_worker, _active_batch_workers, _active_batch_workers_lock
        import threading as _threading

        _db = _SessionLocal()
        try:
            stuck = _db.query(_PublishBatch).filter(_PublishBatch.status == 'in_progress').all()
            resumed = 0
            for _batch in stuck:
                with _active_batch_workers_lock:
                    if _batch.id in _active_batch_workers:
                        continue  # Already being processed (shouldn't happen at startup, but guard anyway)
                _conn = None
                if _batch.connection_id:
                    _conn = _db.query(_FacebookConnection).filter(
                        _FacebookConnection.id == _batch.connection_id,
                        _FacebookConnection.is_active == True,
                    ).first()
                if not _conn:
                    _conn = _db.query(_FacebookConnection).filter(
                        _FacebookConnection.is_default == True,
                        _FacebookConnection.is_active == True,
                    ).first()
                _service = _FacebookService(connection=_conn) if _conn else _FacebookService()
                if not _service.api:
                    _service.initialize()
                _thread = _threading.Thread(
                    target=_process_batch_worker,
                    args=(_batch.id, _service),
                    daemon=True,
                )
                _thread.start()
                resumed += 1
                print(f"🔄 Auto-resumed publish batch {_batch.id} ({_batch.completed_ads or 0}/{_batch.total_ads or 0} ads)")
            if resumed:
                print(f"🔄 Auto-resumed {resumed} orphaned publish batch(es)")
        finally:
            _db.close()
    except Exception as _e:
        print(f"⚠️  Publish batch auto-resume failed: {_e}")


# Include Routers
from app.api.v1 import brands, products, generated_ads, templates, facebook, uploads, dashboard, copy_generation, profiles, ad_remix, prompts, ad_styles, auth, users, video_analysis, higgsfield, headlines, facebook_connections, campaign_templates, landers, competitors, conversions, ad_library, telegram_bot, research, domains, pages, traffic_armor, hosting_accounts, comment_farm, google_ads, claude_brief, reporting_sync, optimizer, headline_presets, spy, airtable_launch

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(brands.router, prefix="/api/v1/brands", tags=["brands"])
app.include_router(products.router, prefix="/api/v1/products", tags=["products"])
app.include_router(generated_ads.router, prefix="/api/v1/generated-ads", tags=["generated-ads"])
app.include_router(templates.router, prefix="/api/v1/templates", tags=["templates"])
app.include_router(facebook.router, prefix="/api/v1/facebook", tags=["facebook"])
app.include_router(uploads.router, prefix="/api/v1/uploads", tags=["uploads"])
app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["dashboard"])
app.include_router(copy_generation.router, prefix="/api/v1/copy-generation", tags=["copy-generation"])
app.include_router(profiles.router, prefix="/api/v1/profiles", tags=["profiles"])
app.include_router(ad_remix.router, prefix="/api/v1/ad-remix", tags=["ad-remix"])
app.include_router(prompts.router, prefix="/api/v1/prompts", tags=["prompts"])
app.include_router(ad_styles.router, prefix="/api/v1/ad-styles", tags=["ad-styles"])
app.include_router(video_analysis.router, prefix="/api/v1/video-analysis", tags=["video-analysis"])
app.include_router(higgsfield.router, prefix="/api/v1/higgsfield", tags=["higgsfield"])
app.include_router(headlines.router, prefix="/api/v1/headlines", tags=["headlines"])
app.include_router(facebook_connections.router, prefix="/api/v1/facebook-connections", tags=["facebook-connections"])
app.include_router(campaign_templates.router, prefix="/api/v1/campaign-templates", tags=["campaign-templates"])
app.include_router(landers.router, prefix="/api/v1/landers", tags=["landers"])
app.include_router(competitors.router, prefix="/api/v1/competitors", tags=["competitors"])
app.include_router(conversions.router, prefix="/api/v1/conversions", tags=["conversions"])
app.include_router(ad_library.router, prefix="/api/v1/ad-library", tags=["ad-library"])
app.include_router(telegram_bot.router, prefix="/api/v1/telegram-bot", tags=["telegram-bot"])
app.include_router(research.router, prefix="/api/v1/research", tags=["research"])
app.include_router(domains.router, prefix="/api/v1/domains", tags=["domains"])
app.include_router(pages.router, prefix="/api/v1/tracked-pages", tags=["tracked-pages"])
app.include_router(traffic_armor.router, prefix="/api/v1/traffic-armor", tags=["traffic-armor"])
app.include_router(hosting_accounts.router, prefix="/api/v1/hosting-accounts", tags=["hosting-accounts"])
app.include_router(comment_farm.router, prefix="/api/v1/comment-farm", tags=["comment-farm"])
app.include_router(google_ads.router, prefix="/api/v1/google-ads", tags=["google-ads"])
app.include_router(claude_brief.router, prefix="/api/v1", tags=["claude-brief"])
app.include_router(reporting_sync.router, prefix="/api/v1/reporting", tags=["reporting-sync"])
app.include_router(headline_presets.router, prefix="/api/v1/headline-presets", tags=["headline-presets"])
app.include_router(optimizer.router, prefix="/api/v1/optimizer", tags=["optimizer"])
app.include_router(spy.router, prefix="/api/v1/spy", tags=["spy"])
app.include_router(airtable_launch.router, prefix="/api/v1/airtable", tags=["airtable"])

# Mount static files for uploads
import os
uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


# ── Background: daily R2 multipart orphan sweep ──────────────────────
# Aborts incomplete multipart uploads older than 24h so dead browser tabs
# don't leak storage. Runs in a thread on every uvicorn worker, but uses
# a pg advisory lock so only one worker per cluster actually executes.
@app.on_event("startup")
def _start_r2_orphan_sweeper():
    if not settings.r2_enabled:
        return
    import threading
    import time as _t
    import hashlib as _h
    from sqlalchemy import text as _text
    from app.database import SessionLocal as _SL

    SWEEP_LOCK_KEY = int(_h.md5(b"r2-orphan-sweep").hexdigest()[:15], 16) % (2**31)

    def _sweep_loop():
        # Stagger start to avoid all workers stampeding the same query.
        _t.sleep(60)
        while True:
            db = _SL()
            got_lock = False
            try:
                got_lock = db.execute(_text("SELECT pg_try_advisory_lock(:k)"), {"k": SWEEP_LOCK_KEY}).scalar()
                if got_lock:
                    try:
                        from app.services.r2_cleanup import sweep_orphans
                        result = sweep_orphans(hours=24, dry_run=False)
                        print(f"[r2_sweeper] aborted={result['aborted']} skipped={result['skipped']}")
                    except Exception as e:
                        print(f"[r2_sweeper] cleanup failed: {e}")
                    finally:
                        try: db.execute(_text("SELECT pg_advisory_unlock(:k)"), {"k": SWEEP_LOCK_KEY})
                        except Exception: pass
            except Exception as e:
                print(f"[r2_sweeper] lock acquire failed: {e}")
            finally:
                db.close()
            _t.sleep(24 * 60 * 60)  # 24h

    threading.Thread(target=_sweep_loop, daemon=True, name="r2-orphan-sweeper").start()
    print("✅ R2 orphan sweeper scheduled (24h interval)")
