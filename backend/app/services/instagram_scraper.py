"""Instagram media scraper using instaloader.

Uses stored credentials to login, persists session to DB (AppSetting),
auto-re-logins when session expires. Downloads thumbnails + videos and
uploads to R2 for permanent storage.
"""
from __future__ import annotations

import base64
import logging
import os
import pickle
import re
import tempfile
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Singleton instaloader instance
_loader = None
_loader_username: Optional[str] = None

try:
    import instaloader
    from instaloader import Post
    HAS_INSTALOADER = True
except ImportError:
    HAS_INSTALOADER = False


# ── DB helpers ──────────────────────────────────────────────────────

def _load_setting(key: str) -> Optional[str]:
    from app.database import SessionLocal
    from app.models import AppSetting
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        return row.value if row else None
    finally:
        db.close()


def _save_setting(key: str, value: str):
    from app.database import SessionLocal
    from app.models import AppSetting
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=key, value=value))
        db.commit()
    finally:
        db.close()


def get_credentials() -> Tuple[Optional[str], Optional[str]]:
    """Load IG credentials from AppSetting."""
    return _load_setting("ig_username"), _load_setting("ig_password")


def save_credentials(username: str, password: str):
    """Save IG credentials to AppSetting."""
    _save_setting("ig_username", username)
    _save_setting("ig_password", password)


def _save_session_to_db(L, username: str):
    """Serialize instaloader session cookies and save to DB."""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".session") as f:
            temp_path = f.name
        L.save_session_to_file(temp_path)
        with open(temp_path, "rb") as f:
            session_bytes = f.read()
        session_b64 = base64.b64encode(session_bytes).decode()
        _save_setting("ig_instaloader_session", session_b64)
        logger.info(f"IG session saved to DB for {username}")
    except Exception as e:
        logger.warning(f"Failed to save IG session to DB: {e}")
    finally:
        try:
            os.unlink(temp_path)
        except Exception:
            pass


def _load_session_from_db(L, username: str) -> bool:
    """Load instaloader session from DB. Returns True if successful."""
    session_b64 = _load_setting("ig_instaloader_session")
    if not session_b64:
        return False
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".session") as f:
            f.write(base64.b64decode(session_b64))
            temp_path = f.name
        L.load_session_from_file(username, temp_path)
        return True
    except Exception as e:
        logger.info(f"Failed to restore IG session from DB: {e}")
        return False
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except Exception:
                pass


def _get_loader() -> Optional["instaloader.Instaloader"]:
    """Get or create an authenticated instaloader instance."""
    global _loader, _loader_username

    if not HAS_INSTALOADER:
        logger.error("instaloader package not installed")
        return None

    username, password = get_credentials()
    if not username or not password:
        logger.warning("No IG credentials configured in Settings")
        return None

    # Reuse existing loader — skip test_login to avoid rate limits
    if _loader is not None and _loader_username == username:
        return _loader

    L = instaloader.Instaloader(
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        max_connection_attempts=2,
        request_timeout=10,
    )

    # Try to restore saved session — quick validity check via private API
    if _load_session_from_db(L, username):
        # Quick check: hit a lightweight private endpoint to see if session is alive
        try:
            session = L.context._session
            resp = session.get(
                "https://i.instagram.com/api/v1/accounts/current_user/",
                headers={
                    "User-Agent": "Instagram 275.0.0.27.98 Android",
                    "X-IG-App-ID": "936619743392459",
                },
                timeout=8,
            )
            if resp.status_code == 200:
                _loader = L
                _loader_username = username
                logger.info(f"IG session restored and verified for {username}")
                return _loader
            else:
                logger.info(f"IG saved session is dead (HTTP {resp.status_code}), doing fresh login")
        except Exception as e:
            logger.info(f"IG session check failed: {e}, doing fresh login")

    # Fresh login
    try:
        L.login(username, password)
        _save_session_to_db(L, username)
        _loader = L
        _loader_username = username
        logger.info(f"IG login successful for {username}")
        return _loader
    except instaloader.exceptions.TwoFactorAuthRequiredException:
        logger.error("IG login requires 2FA — use a burner account without 2FA")
        return None
    except instaloader.exceptions.BadCredentialsException:
        logger.error("IG login failed — bad username or password")
        return None
    except instaloader.exceptions.ConnectionException as e:
        logger.error(f"IG login connection error: {e}")
        return None
    except Exception as e:
        logger.error(f"IG login failed: {e}")
        return None


def test_login() -> dict:
    """Test IG login with stored credentials. Returns status dict."""
    if not HAS_INSTALOADER:
        return {"success": False, "error": "instaloader package not installed"}

    username, password = get_credentials()
    if not username or not password:
        return {"success": False, "error": "No credentials configured"}

    L = _get_loader()
    if L:
        return {"success": True, "username": username, "message": "Login successful"}
    else:
        return {"success": False, "error": "Login failed — check credentials"}


def invalidate_session():
    """Force clear the cached session so next call does a fresh login."""
    global _loader, _loader_username
    _loader = None
    _loader_username = None


def force_fresh_login() -> bool:
    """Invalidate the current session and do a fresh login. Returns True if successful."""
    global _loader, _loader_username
    _loader = None
    _loader_username = None
    # Also clear the saved session from DB so _get_loader does a fresh login
    _save_setting("ig_instaloader_session", "")
    L = _get_loader()
    return L is not None


# ── URL parsing ─────────────────────────────────────────────────────

def extract_shortcode(url: str) -> Optional[str]:
    """Extract Instagram shortcode from a post/reel URL."""
    m = re.search(r"/(p|reel|tv)/([A-Za-z0-9_-]+)", url)
    return m.group(2) if m else None


def is_story_url(url: str) -> bool:
    return "/stories/" in url.lower()


# ── Main scraper ────────────────────────────────────────────────────

def _extract_media_id(url: str) -> Optional[str]:
    """Extract numeric media/story ID from URL."""
    m = re.search(r'/stories/[^/]+/(\d+)', url)
    if m:
        return m.group(1)
    return None


def _fetch_cta_from_private_api(L, media_pk: str, _retried: bool = False) -> dict:
    """Hit Instagram's private API to get CTA link and landing page URL.

    Works for ads/sponsored posts that have a CTA button (Shop Now, Learn More, etc).
    Uses instaloader's authenticated session cookies.
    If session is dead (403), forces a fresh login and retries once.
    """
    result = {"landing_page_url": None, "cta_text": None}

    try:
        session = L.context._session
        cookies = session.cookies.get_dict()
        csrf = cookies.get("csrftoken", "")

        headers = {
            "User-Agent": "Instagram 275.0.0.27.98 Android",
            "X-CSRFToken": csrf,
            "X-IG-App-ID": "936619743392459",
        }

        api_url = f"https://i.instagram.com/api/v1/media/{media_pk}/info/"
        resp = session.get(api_url, headers=headers, timeout=10)

        if resp.status_code == 200:
            data = resp.json()
            if "items" in data and data["items"]:
                item = data["items"][0]
                if item.get("link"):
                    result["landing_page_url"] = item["link"]
                    logger.info(f"CTA link found: {item['link'][:80]}")
                if item.get("link_text"):
                    result["cta_text"] = item["link_text"]
        elif resp.status_code in (401, 403) and not _retried:
            # Session is dead — force fresh login and retry once
            logger.info(f"Private API returned {resp.status_code} — session expired, forcing fresh login")
            if force_fresh_login():
                new_L = _get_loader()
                if new_L:
                    return _fetch_cta_from_private_api(new_L, media_pk, _retried=True)
        else:
            logger.debug(f"Private API returned {resp.status_code} for media {media_pk}")
    except Exception as e:
        logger.debug(f"Private API CTA fetch failed: {e}")

    return result


def scrape_instagram_post(url: str) -> dict:
    """Scrape an Instagram post/reel for thumbnail, video, CTA link, and caption.

    Downloads media and uploads to R2 for permanent storage.
    Returns dict with: thumbnail_url, video_url, creative_type, landing_page_url, cta_text, caption
    """
    from app.services.telegram_bot import _upload_bytes_to_r2
    import httpx

    result = {
        "thumbnail_url": None, "video_url": None, "creative_type": None,
        "landing_page_url": None, "cta_text": None, "caption": None,
    }

    if is_story_url(url):
        # Stories are ephemeral but we can still try to get media + CTA
        L = _get_loader()
        if not L:
            return result
        media_id = _extract_media_id(url)
        if media_id:
            cta = _fetch_cta_from_private_api(L, media_id)
            result.update(cta)
        return result

    shortcode = extract_shortcode(url)
    if not shortcode:
        logger.info(f"No shortcode found in URL: {url}")
        return result

    L = _get_loader()
    if not L:
        return result

    try:
        post = Post.from_shortcode(L.context, shortcode)

        # Get caption (ad copy text)
        if post.caption:
            result["caption"] = post.caption

        # Get media PK for private API call (CTA extraction)
        # Do this BEFORE fetching images so if session is dead, force_fresh_login
        # refreshes it and subsequent media calls benefit from fresh session
        try:
            media_pk = str(post.mediaid)
            cta = _fetch_cta_from_private_api(L, media_pk)
            result.update(cta)
            # Re-fetch loader in case force_fresh_login was triggered
            L = _get_loader() or L
        except Exception as e:
            logger.debug(f"Media PK extraction failed: {e}")

        # Download thumbnail image (always available)
        image_url = post.url
        if image_url:
            resp = httpx.get(image_url, timeout=30, follow_redirects=True)
            if resp.status_code == 200 and len(resp.content) > 1000:
                ct = resp.headers.get("content-type", "image/jpeg")
                r2_url = _upload_bytes_to_r2(resp.content, ct, prefix="swipe-thumbs/ig")
                if r2_url:
                    result["thumbnail_url"] = r2_url
                    logger.info(f"IG thumbnail → R2: {r2_url}")

        # Download video if it's a video post/reel
        if post.is_video and post.video_url:
            result["creative_type"] = "video"
            resp = httpx.get(post.video_url, timeout=60, follow_redirects=True)
            if resp.status_code == 200 and len(resp.content) > 10000:
                ct = resp.headers.get("content-type", "video/mp4")
                r2_url = _upload_bytes_to_r2(resp.content, ct, prefix="swipe-videos/ig")
                if r2_url:
                    result["video_url"] = r2_url
                    logger.info(f"IG video → R2: {r2_url}")
        else:
            result["creative_type"] = "image"

        return result

    except instaloader.exceptions.QueryReturnedNotFoundException:
        logger.info(f"IG post not found (deleted?): {shortcode}")
        return result
    except instaloader.exceptions.LoginRequiredException:
        invalidate_session()
        logger.warning("IG session expired mid-scrape — invalidated for re-login on next call")
        return result
    except Exception as e:
        logger.error(f"IG scrape failed for {url}: {e}")
        return result
