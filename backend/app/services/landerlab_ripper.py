"""LanderLab auto-ripper — Playwright automation to rip landers into LanderLab.

Flow:
1. Load LanderLab email/password from AppSetting
2. Launch headless Chromium
3. Navigate to create-from-URL page (with session cookies if available)
4. If redirected to login → login, then navigate to create page again
5. Fill URL → Continue → Fill name → "Create Landing Page"
6. Done — LanderLab rips the page in background
"""
from __future__ import annotations

import json
import asyncio
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

WORKSPACE_RE = re.compile(r'app\.landerlab\.io/(\d+)/')


def _get_landerlab_creds() -> tuple[Optional[str], Optional[str]]:
    """Load LanderLab email/password from AppSetting."""
    try:
        from app.database import SessionLocal
        from app.models import AppSetting
        db = SessionLocal()
        try:
            email_row = db.query(AppSetting).filter(AppSetting.key == "landerlab_email").first()
            pw_row = db.query(AppSetting).filter(AppSetting.key == "landerlab_password").first()
            return (
                email_row.value if email_row else None,
                pw_row.value if pw_row else None,
            )
        finally:
            db.close()
    except Exception:
        return None, None


def _get_landerlab_session() -> Optional[str]:
    """Load cached LanderLab browser session (cookies JSON) from DB."""
    try:
        from app.database import SessionLocal
        from app.models import AppSetting
        db = SessionLocal()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == "landerlab_session").first()
            return row.value if row else None
        finally:
            db.close()
    except Exception:
        return None


def _save_landerlab_session(session_json: str):
    """Persist LanderLab browser session cookies to DB."""
    try:
        from app.database import SessionLocal
        from app.models import AppSetting
        db = SessionLocal()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == "landerlab_session").first()
            if row:
                row.value = session_json
            else:
                db.add(AppSetting(key="landerlab_session", value=session_json))
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.debug(f"Failed to save LanderLab session to DB: {e}")


def _is_login_page(url: str) -> bool:
    return "/auth/login" in url or "/auth/" in url


def _do_login(page, email: str, password: str) -> bool:
    """Perform login on the LanderLab login page. Returns True on success."""
    logger.info("Logging into LanderLab...")
    page.wait_for_timeout(1500)

    page.fill('input[name="email"]', email)
    page.fill('input[type="password"]', password)
    page.click('button[type="submit"]')

    page.wait_for_timeout(5000)

    current_url = page.url
    logger.info(f"After login URL: {current_url}")

    if _is_login_page(current_url):
        return False
    return True


def rip_to_landerlab(url: str, name: str) -> dict:
    """Rip a lander URL into LanderLab via Playwright browser automation.

    Returns dict with keys: success (bool), error (str|None).
    """
    email, password = _get_landerlab_creds()
    if not email or not password:
        return {"success": False, "error": "LanderLab credentials not configured"}

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"success": False, "error": "Playwright not installed"}

    session_json = _get_landerlab_session()

    try:
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
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            page = context.new_page()

            # Restore session cookies if available
            if session_json:
                try:
                    cookies = json.loads(session_json)
                    if cookies:
                        context.add_cookies(cookies)
                        logger.info("Restored LanderLab session cookies")
                except Exception as e:
                    logger.debug(f"Failed to restore cookies: {e}")

            # Step 1: Go to the app root to find workspace ID
            page.goto("https://app.landerlab.io/", timeout=20000)
            page.wait_for_timeout(3000)

            # If we got redirected to login, do login
            if _is_login_page(page.url):
                if not _do_login(page, email, password):
                    browser.close()
                    return {"success": False, "error": "LanderLab login failed — check credentials"}

                # Save fresh session
                _save_landerlab_session(json.dumps(context.cookies()))

            # Extract workspace ID from current URL
            workspace_match = WORKSPACE_RE.search(page.url)
            if not workspace_match:
                logger.error(f"Cannot find workspace ID in URL: {page.url}")
                browser.close()
                return {"success": False, "error": f"Could not find workspace ID in URL: {page.url}"}

            workspace_id = workspace_match.group(1)
            logger.info(f"LanderLab workspace: {workspace_id}")

            # Step 2: Navigate to create-from-URL page
            create_url = f"https://app.landerlab.io/{workspace_id}/landing-pages/create/url"
            logger.info(f"Navigating to {create_url}")
            page.goto(create_url, timeout=20000)
            page.wait_for_timeout(3000)

            # If redirected to login again (session expired mid-flow), re-login
            if _is_login_page(page.url):
                logger.info("Session expired during navigation, re-logging in...")
                if not _do_login(page, email, password):
                    browser.close()
                    return {"success": False, "error": "LanderLab re-login failed"}
                _save_landerlab_session(json.dumps(context.cookies()))
                # Navigate to create page again
                page.goto(create_url, timeout=20000)
                page.wait_for_timeout(3000)

            # Verify we're actually on the create page (not login)
            if _is_login_page(page.url):
                browser.close()
                return {"success": False, "error": "Still on login page after authentication"}

            logger.info(f"On create page: {page.url}")
            page.screenshot(path="/tmp/ll_create_page.png")

            # Step 3: Find and fill the URL input
            # The create/url page should have a URL input — find it by placeholder
            url_input = page.locator('input[placeholder*="example.com" i]')
            if url_input.count() == 0:
                # Fallback: any visible text input that's NOT the login email field
                url_input = page.locator('input[type="text"]:not([name="email"]), input[type="url"]').first
            else:
                url_input = url_input.first

            url_input.fill(url)
            logger.info(f"Filled URL: {url[:60]}...")
            page.wait_for_timeout(500)

            # Step 4: Click Continue
            continue_btn = page.locator('button:has-text("Continue")')
            if continue_btn.count() == 0:
                page.screenshot(path="/tmp/ll_no_continue.png")
                browser.close()
                return {"success": False, "error": "Could not find Continue button"}

            continue_btn.click()
            page.wait_for_timeout(4000)
            page.screenshot(path="/tmp/ll_after_continue.png")
            logger.info(f"After Continue: {page.url}")

            # Step 5: Fill name input
            # After Continue, there should be a name input
            name_input = page.locator('input[placeholder*="Landing Page Name" i]')
            if name_input.count() == 0:
                name_input = page.locator('input[placeholder*="name" i]')
            if name_input.count() == 0:
                # Last resort: first visible text input
                name_input = page.locator('input[type="text"]')

            name_input.first.fill(name[:100])
            logger.info(f"Filled name: {name[:60]}...")
            page.wait_for_timeout(500)

            # Step 6: Click "Create Landing Page"
            create_btn = page.locator('button:has-text("Create Landing Page")')
            if create_btn.count() == 0:
                create_btn = page.locator('button:has-text("Create")')

            if create_btn.count() == 0:
                page.screenshot(path="/tmp/ll_no_create_btn.png")
                browser.close()
                return {"success": False, "error": "Could not find Create button"}

            create_btn.first.click()
            logger.info("Clicked Create Landing Page — waiting for LanderLab to rip (up to 90s)...")

            # LanderLab takes ~30-60s to rip. Wait until the modal disappears
            # or the URL changes (redirects to editor on success).
            rip_success = False
            for i in range(18):  # 18 x 5s = 90s max
                page.wait_for_timeout(5000)
                still_on_create = "create/url" in page.url
                modal_visible = page.locator('text=Create Your Landing Page').count() > 0
                if not still_on_create or not modal_visible:
                    rip_success = True
                    logger.info(f"LanderLab rip completed in ~{(i+1)*5}s — redirected to {page.url}")
                    break

            # Save session after operation
            _save_landerlab_session(json.dumps(context.cookies()))

            browser.close()
            if rip_success:
                return {"success": True, "error": None}
            else:
                return {"success": False, "error": "LanderLab rip timed out after 90s"}

    except Exception as e:
        logger.error(f"LanderLab rip failed for {url}: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def rip_to_landerlab_async(url: str, name: str) -> dict:
    """Async wrapper — runs the sync Playwright automation in a thread."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, rip_to_landerlab, url, name)
