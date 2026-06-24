"""Telegram bot management endpoints."""
import os
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.models import User
from app.core.deps import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter()


class BotConfig(BaseModel):
    token: Optional[str] = None


@router.get("/health")
def bot_health():
    """No-auth health check — confirms route is reachable."""
    return {"ok": True}


@router.get("/status")
def bot_status(current_user: User = Depends(get_current_active_user)):
    from app.services.telegram_bot import is_running, HAS_TELEGRAM
    return {
        "running": is_running(),
        "installed": HAS_TELEGRAM,
        "configured": bool(os.environ.get("TELEGRAM_BOT_TOKEN")),
    }


@router.post("/start")
async def start_bot(
    config: Optional[BotConfig] = None,
    current_user: User = Depends(get_current_active_user),
):
    from app.services.telegram_bot import start_bot as _start, HAS_TELEGRAM

    if not HAS_TELEGRAM:
        raise HTTPException(
            status_code=503,
            detail="python-telegram-bot package not installed. Redeploy to install dependencies."
        )

    token = (config.token if config else None) or os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise HTTPException(
            status_code=400,
            detail="No bot token provided. Set TELEGRAM_BOT_TOKEN env var or pass token in request body."
        )

    # Save to env for persistence within this process
    os.environ["TELEGRAM_BOT_TOKEN"] = token

    # Persist token in DB so it survives backend restarts
    try:
        from app.database import SessionLocal
        from app.models import AppSetting
        db = SessionLocal()
        existing = db.query(AppSetting).filter(AppSetting.key == "telegram_bot_token").first()
        if existing:
            existing.value = token
        else:
            db.add(AppSetting(key="telegram_bot_token", value=token))
        db.commit()
        db.close()
    except Exception as e:
        logger.warning(f"Failed to persist telegram token to DB: {e}")

    try:
        result = await _start(token)
        return result
    except Exception as e:
        logger.exception("Failed to start Telegram bot")
        raise HTTPException(status_code=500, detail="Failed to start Telegram bot")


@router.post("/stop")
async def stop_bot(current_user: User = Depends(get_current_active_user)):
    from app.services.telegram_bot import stop_bot as _stop
    result = await _stop()
    return result


# ── Instagram credentials ──────────────────────────────────────────


class IGCredentials(BaseModel):
    username: str
    password: str


@router.get("/ig-credentials")
def get_ig_credentials(current_user: User = Depends(get_current_active_user)):
    """Check if IG credentials are configured (never returns the password)."""
    from app.services.instagram_scraper import get_credentials, HAS_INSTALOADER
    username, password = get_credentials()
    return {
        "configured": bool(username and password),
        "username": username or "",
        "installed": HAS_INSTALOADER,
    }


@router.post("/ig-credentials")
def save_ig_credentials(
    creds: IGCredentials,
    current_user: User = Depends(get_current_active_user),
):
    """Save IG credentials for thumbnail scraping."""
    from app.services.instagram_scraper import save_credentials, invalidate_session
    save_credentials(creds.username, creds.password)
    invalidate_session()  # Force fresh login with new creds
    return {"status": "saved", "username": creds.username}


@router.post("/ig-test-login")
def test_ig_login(current_user: User = Depends(get_current_active_user)):
    """Test IG login with stored credentials."""
    from app.services.instagram_scraper import test_login
    return test_login()


# ── LanderLab credentials ────────────────────────────────────────


class LanderLabCredentials(BaseModel):
    email: str
    password: str


@router.get("/landerlab-credentials")
def get_landerlab_credentials(current_user: User = Depends(get_current_active_user)):
    """Check if LanderLab credentials are configured (never returns the password)."""
    from app.services.landerlab_ripper import _get_landerlab_creds
    email, password = _get_landerlab_creds()
    return {
        "configured": bool(email and password),
        "email": email or "",
    }


@router.post("/landerlab-credentials")
def save_landerlab_credentials(
    creds: LanderLabCredentials,
    current_user: User = Depends(get_current_active_user),
):
    """Save LanderLab credentials for auto-ripping landers."""
    from app.database import SessionLocal
    from app.models import AppSetting

    db = SessionLocal()
    try:
        for key, value in [("landerlab_email", creds.email.strip()), ("landerlab_password", creds.password.strip())]:
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            if row:
                row.value = value
            else:
                db.add(AppSetting(key=key, value=value))
        # Clear any cached session so next rip does a fresh login
        session_row = db.query(AppSetting).filter(AppSetting.key == "landerlab_session").first()
        if session_row:
            db.delete(session_row)
        db.commit()
    finally:
        db.close()

    return {"status": "saved", "email": creds.email.strip()}
