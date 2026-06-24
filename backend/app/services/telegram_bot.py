"""Telegram bot for capturing ad URLs and images to the Swipe File / Landers.

Smart routing:
- Instagram/Facebook/TikTok/YouTube links → Swipe File (My Swipes, "In the Wild")
- Any other link → Landers table
- Image files → Swipe File with image uploaded to R2
"""
from __future__ import annotations

import os
import re
import asyncio
import logging
from typing import Optional

try:
    from telegram import Update
    from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
    HAS_TELEGRAM = True
except ImportError:
    HAS_TELEGRAM = False

logger = logging.getLogger(__name__)

# Singleton state
_app: Optional[object] = None
_running = False

URL_REGEX = re.compile(r'https?://[^\s<>"{}|\\^`\[\]]+')

# Domains that route to Swipe File (ad platforms)
AD_PLATFORM_DOMAINS = {
    "instagram.com", "facebook.com", "fb.com", "fb.watch",
    "tiktok.com", "youtube.com", "youtu.be",
    "twitter.com", "x.com",
}


def _detect_platform(url: str) -> str:
    """Detect ad platform from URL."""
    url_lower = url.lower()
    if "instagram.com" in url_lower:
        return "instagram"
    if "facebook.com" in url_lower or "fb.com" in url_lower or "fb.watch" in url_lower:
        return "facebook"
    if "tiktok.com" in url_lower:
        return "tiktok"
    if "youtube.com" in url_lower or "youtu.be" in url_lower:
        return "youtube"
    return "other"


def _is_ad_platform(url: str) -> bool:
    """Check if a URL belongs to a known ad/social platform."""
    url_lower = url.lower()
    return any(domain in url_lower for domain in AD_PLATFORM_DOMAINS)


# ── Instagram browser session (Playwright) ──

def _load_ig_session_from_db() -> Optional[str]:
    """Load cached Instagram browser session from database."""
    try:
        from app.database import SessionLocal
        from app.models import AppSetting
        db = SessionLocal()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == "ig_session").first()
            return row.value if row else None
        finally:
            db.close()
    except Exception:
        return None


def _save_ig_session_to_db(session_json: str):
    """Save Instagram browser session to database so it survives deploys."""
    try:
        from app.database import SessionLocal
        from app.models import AppSetting
        db = SessionLocal()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == "ig_session").first()
            if row:
                row.value = session_json
            else:
                db.add(AppSetting(key="ig_session", value=session_json))
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.debug(f"Failed to save IG session to DB: {e}")


def _upload_bytes_to_r2(file_bytes: bytes, content_type: str, prefix: str = "swipe-thumbs") -> Optional[str]:
    """Upload raw bytes (image or video) to R2 and return the permanent public URL."""
    try:
        import uuid as _uuid
        from app.api.v1.uploads import get_s3_client
        from app.core.config import settings

        client = get_s3_client()
        if not client:
            logger.debug("R2 not configured — cannot persist file")
            return None

        ext = "jpg"
        if "png" in content_type:
            ext = "png"
        elif "webp" in content_type:
            ext = "webp"
        elif "gif" in content_type:
            ext = "gif"
        elif "video/mp4" in content_type or "mp4" in content_type:
            ext = "mp4"
        elif "video/" in content_type:
            ext = "mp4"  # default video ext

        filename = f"{prefix}/{_uuid.uuid4().hex}.{ext}"
        client.put_object(
            Bucket=settings.R2_BUCKET_NAME,
            Key=filename,
            Body=file_bytes,
            ContentType=content_type,
        )
        return f"{settings.R2_PUBLIC_URL}/{filename}"
    except Exception as e:
        logger.error(f"R2 upload failed: {e}")
        return None


def _extract_media_id(url: str) -> Optional[str]:
    """Extract the Instagram media/story ID from a URL."""
    # Stories: /stories/username/1234567890
    m = re.search(r'/stories/[^/]+/(\d+)', url)
    if m:
        return m.group(1)
    # Posts: /p/SHORTCODE/ or /reel/SHORTCODE/
    m = re.search(r'/(p|reel)/([A-Za-z0-9_-]+)', url)
    if m:
        return m.group(2)  # shortcode, not numeric — handled differently
    return None


def _fetch_instagram_media(url: str) -> dict:
    """Get Instagram post/story thumbnail, video, and landing page via headless browser.

    Uses a logged-in Playwright session to:
    1. Visit the URL and intercept CDN image bytes for thumbnail
    2. Call IG private API /api/v1/media/{id}/info/ to get direct video URL + CTA link
    3. Download video via httpx and upload to R2

    Returns dict with keys: thumbnail_url, video_url, landing_page_url, cta_text, is_expired.
    """
    import json
    import httpx

    result = {"thumbnail_url": None, "video_url": None, "landing_page_url": None, "cta_text": None, "is_expired": False}

    session_json = _load_ig_session_from_db()
    if not session_json:
        logger.debug("No Instagram browser session in DB — trying og:image fallback")
        og_url = _fetch_og_image(url)
        if og_url:
            result["thumbnail_url"] = og_url
        return result

    media_id = _extract_media_id(url)

    try:
        from playwright.sync_api import sync_playwright

        session_data = json.loads(session_json)
        image_captures = []

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--single-process",
                ],
            )
            context = browser.new_context(
                storage_state=session_data,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            page = context.new_page()

            # Intercept network — capture image bytes for thumbnail
            def on_response(response):
                resp_url = response.url
                ct = response.headers.get("content-type", "")
                if "image/" in ct and ("cdninstagram" in resp_url or "fbcdn" in resp_url):
                    try:
                        body = response.body()
                        if body and len(body) > 1000:
                            image_captures.append((resp_url, body, ct))
                    except Exception:
                        pass

            page.on("response", on_response)

            page.goto(url, timeout=15000)
            page.wait_for_timeout(3000)

            # Stories: click "View story"
            if "/stories/" in url.lower():
                page.evaluate("""() => {
                    const btns = document.querySelectorAll('button');
                    for (const btn of btns) {
                        if (btn.textContent.includes('View story')) { btn.click(); return; }
                    }
                    const divs = document.querySelectorAll('div[role="button"]');
                    for (const div of divs) {
                        if (div.textContent.includes('View story')) { div.click(); return; }
                    }
                }""")
                page.wait_for_timeout(4000)

            # Check for expired / unavailable content
            content = page.content()[:5000].lower()
            if any(phrase in content for phrase in [
                "page isn't available", "this page isn",
                "post isn't available", "post isn\u2019t available",
                "content isn't available", "sorry, this page",
                "story unavailable",
            ]):
                browser.close()
                result["is_expired"] = True
                return result

            # Screenshot video element for thumbnail (if it's a video)
            video_screenshot = None
            has_video = False
            try:
                video_el = page.query_selector("video")
                if video_el:
                    has_video = True
                    page.wait_for_timeout(1500)
                    video_screenshot = video_el.screenshot(type="jpeg", quality=85)
                    logger.info(f"Video screenshot: {len(video_screenshot)} bytes")
            except Exception as e:
                logger.debug(f"Video screenshot failed: {e}")

            # Fallback: screenshot the main post image or article element
            page_screenshot = None
            try:
                # Try common IG selectors for the main content image
                for selector in ["article img[srcset]", "article img", "img[style*='object-fit']", "main img"]:
                    el = page.query_selector(selector)
                    if el:
                        box = el.bounding_box()
                        if box and box["width"] > 100 and box["height"] > 100:
                            page_screenshot = el.screenshot(type="jpeg", quality=85)
                            logger.info(f"Fallback element screenshot ({selector}): {len(page_screenshot)} bytes")
                            break
            except Exception as e:
                logger.debug(f"Fallback element screenshot failed: {e}")

            # Use IG private API to get direct video URL
            video_direct_url = None
            cookie_str = None
            if media_id and media_id.isdigit():
                try:
                    cookies = context.cookies()
                    cookie_dict = {c['name']: c['value'] for c in cookies}
                    csrf = cookie_dict.get('csrftoken', '')
                    cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

                    api_url = f"https://www.instagram.com/api/v1/media/{media_id}/info/"
                    api_result = page.evaluate(f"""async () => {{
                        try {{
                            const resp = await fetch("{api_url}", {{
                                headers: {{
                                    'X-CSRFToken': '{csrf}',
                                    'X-IG-App-ID': '936619743392459',
                                }},
                                credentials: 'include',
                            }});
                            return await resp.text();
                        }} catch(e) {{
                            return JSON.stringify({{error: e.message}});
                        }}
                    }}""")

                    api_data = json.loads(api_result)
                    if "items" in api_data:
                        item = api_data["items"][0]
                        if "video_versions" in item:
                            video_direct_url = item["video_versions"][0].get("url")
                            logger.info(f"Got direct video URL from IG API: {video_direct_url[:80] if video_direct_url else 'None'}...")
                        # Extract landing page URL and CTA text
                        if item.get("link"):
                            result["landing_page_url"] = item["link"]
                            logger.info(f"Got landing page: {item['link'][:80]}...")
                        if item.get("link_text"):
                            result["cta_text"] = item["link_text"]
                except Exception as e:
                    logger.warning(f"IG private API video fetch failed: {e}")

            browser.close()

        # ── Pick best thumbnail image ──
        best_image = None
        for cap_url, body, ct in image_captures:
            if "t51.2885-15" in cap_url or "t51.2885-16" in cap_url:
                best_image = (body, ct)
                break

        if not best_image:
            for cap_url, body, ct in image_captures:
                if "t51.2885-19" not in cap_url and "rsrc.php" not in cap_url:
                    best_image = (body, ct)
                    break

        if not best_image and video_screenshot:
            best_image = (video_screenshot, "image/jpeg")

        if not best_image and page_screenshot:
            best_image = (page_screenshot, "image/jpeg")

        if not best_image and image_captures:
            image_captures.sort(key=lambda x: len(x[1]), reverse=True)
            best_image = (image_captures[0][1], image_captures[0][2])

        # Upload thumbnail to R2
        if best_image:
            result["thumbnail_url"] = _upload_bytes_to_r2(best_image[0], best_image[1], prefix="swipe-thumbs/ig")
        else:
            logger.warning(f"No thumbnail captured for {url} — trying og:image fallback")
            og_url = _fetch_og_image(url)
            if og_url:
                result["thumbnail_url"] = og_url

        # ── Download and upload video to R2 ──
        if video_direct_url and cookie_str:
            try:
                logger.info(f"Downloading video from IG CDN...")
                vid_resp = httpx.get(video_direct_url, headers={
                    "Cookie": cookie_str,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                }, timeout=60, follow_redirects=True)
                if vid_resp.status_code == 200 and len(vid_resp.content) > 10000:
                    vid_ct = vid_resp.headers.get("content-type", "video/mp4")
                    logger.info(f"Video downloaded: {len(vid_resp.content)} bytes, uploading to R2...")
                    result["video_url"] = _upload_bytes_to_r2(vid_resp.content, vid_ct, prefix="swipe-videos/ig")
                else:
                    logger.warning(f"Video download got status={vid_resp.status_code}, size={len(vid_resp.content)}")
            except Exception as e:
                logger.warning(f"Video download/upload failed: {e}")

        return result

    except Exception as e:
        logger.error(f"Instagram Playwright media fetch failed for {url}: {e}", exc_info=True)
        return result


def _download_and_upload_image(image_url: str, prefix: str = "swipe-thumbs/og") -> Optional[str]:
    """Download an image from any URL and upload to R2. Returns permanent R2 URL or None."""
    import httpx
    import html

    # Unescape HTML entities (&amp; -> &, etc.)
    image_url = html.unescape(image_url)

    try:
        resp = httpx.get(image_url, follow_redirects=True, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.instagram.com/",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        })
        if resp.status_code != 200:
            logger.debug(f"Image download failed ({resp.status_code}): {image_url[:100]}")
            return None
        if len(resp.content) < 500:
            logger.debug(f"Image too small ({len(resp.content)} bytes), likely an error page")
            return None
        content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        if not content_type.startswith("image/"):
            content_type = "image/jpeg"
        r2_url = _upload_bytes_to_r2(resp.content, content_type, prefix=prefix)
        if r2_url:
            logger.debug(f"Persisted image to R2: {r2_url}")
        return r2_url
    except Exception as e:
        logger.debug(f"Image download+upload failed for {image_url[:100]}: {e}")
        return None


def _fetch_og_image(url: str) -> Optional[str]:
    """Fetch og:image from a URL, download it, and upload to R2 for permanence."""
    import httpx

    try:
        # Use crawler UA — Instagram (and many platforms) only serve og:image to crawlers
        resp = httpx.get(url, follow_redirects=True, timeout=8,
                         headers={"User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"})
        if resp.status_code != 200:
            return None
        text = resp.text[:50000]
        match = re.search(
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
            text, re.IGNORECASE
        )
        if not match:
            match = re.search(
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
                text, re.IGNORECASE
            )
        if not match:
            return None

        cdn_url = match.group(1)
        # Download the image and upload to R2 so it doesn't expire
        r2_url = _download_and_upload_image(cdn_url)
        # Return R2 URL if upload succeeded, otherwise fall back to CDN URL
        return r2_url or cdn_url
    except Exception as e:
        logger.debug(f"OG image fetch failed for {url}: {e}")
        return None


def _fetch_og_title(url: str) -> Optional[str]:
    """Try to fetch the og:title or <title> from a URL."""
    import httpx

    try:
        resp = httpx.get(url, follow_redirects=True, timeout=8,
                         headers={"User-Agent": "Mozilla/5.0 (compatible; MVMTPrinterBot/1.0)"})
        if resp.status_code != 200:
            return None
        text = resp.text[:50000]
        # Try og:title first
        match = re.search(
            r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
            text, re.IGNORECASE
        )
        if not match:
            match = re.search(
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']',
                text, re.IGNORECASE
            )
        if not match:
            # Fallback to <title> tag
            match = re.search(r'<title[^>]*>([^<]+)</title>', text, re.IGNORECASE)
        return match.group(1).strip()[:200] if match else None
    except Exception:
        return None


def _save_to_swipe_file(url: str, platform: str, telegram_user: str,
                        image_url: str = None, video_url: str = None,
                        is_expired: bool = False,
                        landing_page_url: str = None,
                        cta_text: str = None,
                        primary_text: str = None) -> str:
    """Save an ad URL or image to the SwipeFile table. Returns 'saved', 'dupe', 'expired', or 'error'."""
    from app.database import SessionLocal
    from app.models import SwipeFile
    import uuid

    # Skip expired content entirely
    if is_expired:
        return "expired"

    db = SessionLocal()
    try:
        if url:
            existing = db.query(SwipeFile).filter(SwipeFile.source_url == url).first()
            if existing:
                return "dupe"

        # For Instagram, thumbnail is fetched separately before this call
        # For other platforms, fetch og:image
        if not image_url and url and "instagram.com" not in url.lower():
            og_image = _fetch_og_image(url)
        else:
            og_image = None

        swipe = SwipeFile(
            id=str(uuid.uuid4()),
            source_url=url,
            platform=platform,
            source_type="telegram",
            collection="In the Wild",
            thumbnail_url=image_url or og_image,
            image_url=image_url,
            video_url=video_url,
            creative_type="video" if video_url else None,
            landing_page_url=landing_page_url,
            cta_text=cta_text,
            primary_text=primary_text,
            notes=f"Shared via Telegram by {telegram_user}",
        )
        db.add(swipe)
        db.commit()

        # Fire-and-forget auto-categorization
        try:
            import asyncio
            from app.services.swipe_analyzer import auto_categorize_swipe
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(auto_categorize_swipe(swipe.id))
            else:
                loop.run_until_complete(auto_categorize_swipe(swipe.id))
        except Exception as e:
            logger.warning(f"Auto-categorize skipped: {e}")

        return "saved"
    except Exception as e:
        logger.error(f"Failed to save to swipe file: {e}")
        db.rollback()
        return "error"
    finally:
        db.close()


def _save_to_landers(url: str, telegram_user: str) -> str:
    """Save a non-ad URL to the Landers table. Returns 'saved', 'dupe', or 'error'."""
    from app.database import SessionLocal
    from app.models import Lander
    import uuid

    db = SessionLocal()
    try:
        existing = db.query(Lander).filter(Lander.url == url).first()
        if existing:
            return "dupe"

        # Try to get the page title for a better lander name
        title = _fetch_og_title(url)

        lander = Lander(
            id=str(uuid.uuid4()),
            url=url,
            title=title,
            notes=f"Shared via Telegram by {telegram_user}",
        )
        db.add(lander)
        db.commit()

        # Fire-and-forget LanderLab rip
        try:
            from app.services.landerlab_ripper import rip_to_landerlab_async
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(rip_to_landerlab_async(url, title or url))
            else:
                loop.run_until_complete(rip_to_landerlab_async(url, title or url))
        except Exception as e:
            logger.warning(f"LanderLab rip skipped: {e}")

        return "saved"
    except Exception as e:
        logger.error(f"Failed to save to landers: {e}")
        db.rollback()
        return "error"
    finally:
        db.close()


async def _upload_telegram_image(file_obj) -> Optional[str]:
    """Download an image from Telegram and upload to R2. Returns the public URL."""
    try:
        tg_file = await file_obj.get_file()
        file_bytes = await tg_file.download_as_bytearray()

        # Determine extension from file path
        ext = "jpg"
        if tg_file.file_path:
            if tg_file.file_path.endswith(".png"):
                ext = "png"
            elif tg_file.file_path.endswith(".webp"):
                ext = "webp"

        import uuid
        filename = f"telegram/{uuid.uuid4().hex}.{ext}"
        content_type = f"image/{'jpeg' if ext == 'jpg' else ext}"

        from app.api.v1.uploads import upload_to_r2
        url = await upload_to_r2(bytes(file_bytes), filename, content_type)
        return url
    except Exception as e:
        logger.error(f"Failed to upload telegram image: {e}")
        return None


async def _handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command."""
    await update.message.reply_text(
        "MVMT Printer Swipe Bot\n\n"
        "Send me links or images and I'll auto-sort them:\n\n"
        "📱 Instagram/Facebook/TikTok/YouTube links → Swipe File\n"
        "🌐 Any other link → Landers\n"
        "🖼 Images → Swipe File\n\n"
        "You can send multiple URLs in one message."
    )


async def _handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming text messages — extract URLs and route them."""
    text = update.message.text or ""
    urls = URL_REGEX.findall(text)

    if not urls:
        await update.message.reply_text("No URLs found. Send me an ad link or landing page URL.")
        return

    user_name = update.effective_user.full_name or update.effective_user.username or "Unknown"
    swipe_saved = 0
    lander_saved = 0
    dupes = 0
    expired = 0

    for url in urls:
        if _is_ad_platform(url):
            platform = _detect_platform(url)

            # Save immediately, then try to enrich IG posts with scraper
            ig_media = {}
            if platform == "instagram":
                try:
                    from app.services.instagram_scraper import scrape_instagram_post, HAS_INSTALOADER
                    if HAS_INSTALOADER:
                        ig_media = scrape_instagram_post(url)
                except Exception as e:
                    logger.warning(f"IG scrape on Telegram save failed: {e}")

            result = _save_to_swipe_file(
                url, platform, user_name,
                image_url=ig_media.get("thumbnail_url"),
                video_url=ig_media.get("video_url"),
                landing_page_url=ig_media.get("landing_page_url"),
                cta_text=ig_media.get("cta_text"),
                primary_text=ig_media.get("caption"),
            )
            if result == "saved":
                swipe_saved += 1
            elif result == "dupe":
                dupes += 1
            elif result == "expired":
                expired += 1
        else:
            result = _save_to_landers(url, user_name)
            if result == "saved":
                lander_saved += 1
            elif result == "dupe":
                dupes += 1

    parts = []
    if swipe_saved:
        parts.append(f"📱 {swipe_saved} ad{'s' if swipe_saved > 1 else ''} → Swipe File")
    if lander_saved:
        # Check if LanderLab auto-rip is configured
        ll_email, ll_pw = None, None
        try:
            from app.services.landerlab_ripper import _get_landerlab_creds
            ll_email, ll_pw = _get_landerlab_creds()
        except Exception:
            pass
        ll_suffix = " (ripping in LanderLab...)" if (ll_email and ll_pw) else ""
        parts.append(f"🌐 {lander_saved} lander{'s' if lander_saved > 1 else ''} → Landers{ll_suffix}")
    if dupes:
        parts.append(f"({dupes} already saved)")
    if expired:
        parts.append(f"⏰ {expired} expired/deleted — skipped")
    await update.message.reply_text(" · ".join(parts) if parts else "Nothing new to save.")


async def _handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming photos — upload to R2 and save to Swipe File."""
    user_name = update.effective_user.full_name or update.effective_user.username or "Unknown"

    # Get the largest photo (last in the list)
    photo = update.message.photo[-1]
    image_url = await _upload_telegram_image(photo)

    if not image_url:
        await update.message.reply_text("Failed to save image. Try again.")
        return

    caption = update.message.caption or ""
    result = _save_to_swipe_file(
        url=None,
        platform="other",
        telegram_user=user_name,
        image_url=image_url,
    )

    if result == "saved":
        await update.message.reply_text("🖼 Image saved → Swipe File")
    else:
        await update.message.reply_text("Failed to save image.")


async def start_bot(token: str):
    """Start the Telegram bot with polling."""
    global _app, _running

    if not HAS_TELEGRAM:
        raise RuntimeError("python-telegram-bot package not installed")

    if _running and _app:
        return {"status": "already_running"}

    # Pre-flight: verify we can reach Telegram and no other instance is polling
    import httpx
    try:
        resp = httpx.get(f"https://api.telegram.org/bot{token}/getUpdates?timeout=1&offset=-1", timeout=5)
        data = resp.json()
        if not data.get("ok") and data.get("error_code") == 409:
            raise RuntimeError("Conflict: another bot instance is still polling. Wait and try again.")
    except httpx.HTTPError as e:
        raise RuntimeError(f"Cannot reach Telegram API: {e}")

    _app = Application.builder().token(token).build()
    _app.add_handler(CommandHandler("start", _handle_start))
    _app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, _handle_message))
    _app.add_handler(MessageHandler(filters.PHOTO, _handle_photo))

    _running = True
    logger.info("Telegram bot starting...")

    # Run polling in background
    await _app.initialize()
    await _app.start()
    await _app.updater.start_polling(drop_pending_updates=True)

    return {"status": "started"}


async def stop_bot():
    """Stop the Telegram bot."""
    global _app, _running

    if not _running or not _app:
        _running = False
        _app = None
        return {"status": "not_running"}

    try:
        if _app.updater and _app.updater.running:
            await _app.updater.stop()
        if _app.running:
            await _app.stop()
        await _app.shutdown()
    except Exception as e:
        logger.error(f"Error stopping bot: {e}")

    _running = False
    _app = None
    return {"status": "stopped"}


def is_running() -> bool:
    return _running
