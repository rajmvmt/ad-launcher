import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env.local first (overrides), then .env as fallback
project_root = Path(__file__).parent.parent.parent.parent
load_dotenv(project_root / ".env.local")
load_dotenv(project_root / ".env")

class Settings:
    PROJECT_NAME: str = "ad_launcher"
    API_V1_STR: str = "/api/v1"
    
    # Database - PostgreSQL Required
    DATABASE_URL: str = os.getenv("DATABASE_URL")
    
    # Validate DATABASE_URL is set
    if not DATABASE_URL:
        raise ValueError(
            "DATABASE_URL environment variable is required. "
            "Please set it to your PostgreSQL connection string.\n"
            "Example: postgresql://user:password@localhost:5432/ad_launcher"
        )
    
    # Validate that it's PostgreSQL
    if not DATABASE_URL.startswith("postgresql://") and not DATABASE_URL.startswith("postgres://"):
        raise ValueError(
            "DATABASE_URL must be a PostgreSQL connection string. "
            f"Got: {DATABASE_URL.split(':')[0]}://...\n"
            "SQLite is no longer supported. Please use PostgreSQL."
        )
    
    # External APIs
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    KIE_AI_API_KEY: str = os.getenv("KIE_AI_API_KEY", "")
    FAL_KEY: str = os.getenv("FAL_KEY", "")
    FACEBOOK_ACCESS_TOKEN: str = os.getenv("FACEBOOK_ACCESS_TOKEN", "")

    # Traffic Armor (cloaker)
    TRAFFIC_ARMOR_API_KEY: str = os.getenv("TRAFFIC_ARMOR_API_KEY", "")
    TA_PHP_SERVICE_URL: str = os.getenv("TA_PHP_SERVICE_URL", "")  # Railway PHP cloaker internal URL
    TA_PHP_DEPLOY_KEY: str = os.getenv("TA_PHP_DEPLOY_KEY", "")  # Secret for safe page deploy

    # Cloudflare (DNS + Workers)
    CLOUDFLARE_API_TOKEN: str = os.getenv("CLOUDFLARE_API_TOKEN", "")
    CLOUDFLARE_ACCOUNT_ID: str = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")

    # Google Imagen 4 (image generation) - uses same GEMINI_API_KEY
    IMAGEN_MODEL: str = os.getenv("IMAGEN_MODEL", "imagen-4.0-generate-001")

    # Auth settings - SECRET_KEY is required
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")
    if not SECRET_KEY or SECRET_KEY == "your-secret-key-change-in-production":
        raise ValueError(
            "SECRET_KEY environment variable is required for security.\n"
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )

    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))  # 30 days

    # Cloudflare R2 Storage (S3-compatible)
    R2_ACCOUNT_ID: str = os.getenv("R2_ACCOUNT_ID", "")
    R2_ACCESS_KEY_ID: str = os.getenv("R2_ACCESS_KEY_ID", "")
    R2_SECRET_ACCESS_KEY: str = os.getenv("R2_SECRET_ACCESS_KEY", "")
    R2_BUCKET_NAME: str = os.getenv("R2_BUCKET_NAME", "")
    R2_PUBLIC_URL: str = os.getenv("R2_PUBLIC_URL", "")

    # Public origin for things FB needs to fetch (e.g. /uploads/thumbnails/...).
    # Falls back to Railway's auto-injected public domain if not explicitly set.
    BACKEND_PUBLIC_URL: str = (
        os.getenv("BACKEND_PUBLIC_URL")
        or (f"https://{os.getenv('RAILWAY_PUBLIC_DOMAIN')}" if os.getenv("RAILWAY_PUBLIC_DOMAIN") else "")
    )

    @property
    def imagen_enabled(self) -> bool:
        return bool(self.GEMINI_API_KEY)

    @property
    def fal_enabled(self) -> bool:
        return bool(self.FAL_KEY)

    @property
    def r2_enabled(self) -> bool:
        placeholders = {"", "your-r2-account-id", "your-r2-access-key-id", "your-r2-secret-access-key"}
        return bool(
            self.R2_ACCOUNT_ID and self.R2_ACCESS_KEY_ID and self.R2_SECRET_ACCESS_KEY
            and self.R2_ACCOUNT_ID not in placeholders
            and self.R2_ACCESS_KEY_ID not in placeholders
            and self.R2_SECRET_ACCESS_KEY not in placeholders
        )

    @property
    def r2_endpoint_url(self) -> str:
        return f"https://{self.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

settings = Settings()
