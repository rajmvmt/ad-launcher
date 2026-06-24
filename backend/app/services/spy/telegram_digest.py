"""Compact Telegram digest for the daily /spy report."""
import os
import logging
import httpx
from typing import Optional
from datetime import date

from app.services.spy.report_builder import ReportEntry

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"
DIGEST_TOP = 5


def _resolve_token_and_chat() -> tuple[Optional[str], Optional[str]]:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("SPY_TELEGRAM_CHAT_ID") or os.getenv("TELEGRAM_CHAT_ID")
    return token, chat_id


def build_digest_text(
    report_date: date,
    total_scanned: int,
    new_count: int,
    competitors_scanned: int,
    keywords_scanned: int,
    entries: list[ReportEntry],
    full_report_url: Optional[str],
) -> str:
    lines = [
        f"🕵️ Spy Report — {report_date.isoformat()}",
        (
            f"{total_scanned:,} scanned · {new_count} new · "
            f"{competitors_scanned} competitors · {keywords_scanned} keywords"
        ),
        "",
        f"Top {min(DIGEST_TOP, len(entries))}:",
    ]
    for e in entries[:DIGEST_TOP]:
        reason = ", ".join(e.reasons) if e.reasons else ""
        url = e.ad_library_url or ""
        lines.append(f"{e.rank}. {e.page_name} — {reason} — {url}")
    if len(entries) > DIGEST_TOP and full_report_url:
        lines.append("")
        lines.append(f"+ {len(entries) - DIGEST_TOP} more: {full_report_url}")
    return "\n".join(lines)


def send_digest(text: str) -> Optional[dict]:
    """Post digest text to Telegram. Returns the API response JSON or None on failure."""
    token, chat_id = _resolve_token_and_chat()
    if not token or not chat_id:
        logger.warning("Telegram token or chat id missing; skipping digest")
        return None
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
        return resp.json()
    except Exception as e:
        logger.exception(f"Telegram digest send failed: {e}")
        return None
