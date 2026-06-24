"""Telegram alerts for Meta ad rejections.

Fires when an ad's effective_status transitions into DISAPPROVED during fb_sync.
Idempotent — only the *transition* triggers; an ad that stays DISAPPROVED across
syncs won't re-alert.
"""
from __future__ import annotations

import os
import json
import logging
from pathlib import Path
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"
REJECTED_STATUS = "DISAPPROVED"
TG_CHANNEL_DIR = Path.home() / ".claude" / "channels" / "telegram"


def _resolve_creds() -> tuple[Optional[str], Optional[str]]:
    """Resolve (bot_token, chat_id) from env first, then fall back to the
    central ~/.claude/channels/telegram/ files used by other local alerters."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")

    if not token:
        env_file = TG_CHANNEL_DIR / ".env"
        try:
            for line in env_file.read_text().splitlines():
                if line.startswith("TELEGRAM_BOT_TOKEN="):
                    token = line.split("=", 1)[1].strip()
                    break
        except OSError:
            pass

    if not chat_id:
        access_file = TG_CHANNEL_DIR / "access.json"
        try:
            data = json.loads(access_file.read_text())
            allow = data.get("allowFrom") or []
            if allow:
                chat_id = str(allow[0])
        except (OSError, ValueError):
            pass

    return token, chat_id


def is_rejection_transition(old_status: Optional[str], new_status: Optional[str]) -> bool:
    """Return True iff this sync flipped the ad into DISAPPROVED for the first time.

    First-time-seen ads that are already DISAPPROVED count as a transition
    (old_status is None).
    """
    if new_status != REJECTED_STATUS:
        return False
    return old_status != REJECTED_STATUS


def _format_issues(issues_info: Any) -> str:
    """Render FB's issues_info into a short human-readable reason."""
    if not issues_info:
        return ""
    if isinstance(issues_info, str):
        try:
            issues_info = json.loads(issues_info)
        except (ValueError, TypeError):
            return issues_info[:200]
    if not isinstance(issues_info, list):
        return ""
    parts = []
    for issue in issues_info[:3]:
        if not isinstance(issue, dict):
            continue
        msg = issue.get("error_message") or issue.get("error_summary") or ""
        code = issue.get("error_code")
        if msg:
            parts.append(f"• {msg}" + (f" (code {code})" if code else ""))
    return "\n".join(parts)


def send_rejection_alert(
    *,
    ad_id: str,
    ad_name: str,
    account_id: str,
    campaign_name: str = "",
    adset_name: str = "",
    issues_info: Any = None,
) -> bool:
    """Post a rejection alert to Telegram. Returns True on success."""
    token, chat_id = _resolve_creds()
    if not token or not chat_id:
        logger.warning("Telegram creds missing; skipping rejection alert for ad %s", ad_id)
        return False

    reason = _format_issues(issues_info)
    manager_url = (
        f"https://business.facebook.com/adsmanager/manage/ads"
        f"?act={account_id}&selected_ad_ids={ad_id}"
    )

    lines = [
        "🚫 Meta ad REJECTED",
        f"Ad: {ad_name or ad_id}",
    ]
    if campaign_name:
        lines.append(f"Campaign: {campaign_name}")
    if adset_name:
        lines.append(f"Ad set: {adset_name}")
    lines.append(f"Account: act_{account_id}")
    if reason:
        lines.append("")
        lines.append("Reason:")
        lines.append(reason)
    lines.append("")
    lines.append(manager_url)
    text = "\n".join(lines)

    try:
        resp = httpx.post(
            f"{TELEGRAM_API_BASE}/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "disable_web_page_preview": True,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.exception("Failed to send rejection alert for ad %s: %s", ad_id, e)
        return False
