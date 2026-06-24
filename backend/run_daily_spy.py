#!/usr/bin/env python3
"""Daily /spy cron entrypoint.

Runs:
  1. Competitor page scraping
  2. Scheduled keyword searches (reuses SchedulerService)
  3. Scoring + ranking
  4. SpyReport persistence
  5. Telegram digest
"""
import asyncio
import logging
import os
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import SavedSearch, ScrapedAd, FacebookPage
from app.services.spy import competitor_runner
from app.services.spy.scoring import (
    score_ad, build_reasons, count_variants, TOP_N,
)
from app.services.spy.report_builder import (
    render_markdown, persist_report, ReportEntry,
)
from app.services.spy.telegram_digest import build_digest_text, send_digest
from app.services.scheduler_service import SchedulerService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("run_daily_spy")


def _resolve_token() -> str | None:
    return (
        os.getenv("FACEBOOK_ADS_LIBRARY_TOKEN")
        or os.getenv("FACEBOOK_ACCESS_TOKEN")
        or os.getenv("VITE_FACEBOOK_ACCESS_TOKEN")
    )


def _page_name_for(db, ad: ScrapedAd) -> str:
    if ad.facebook_page_id:
        page = db.query(FacebookPage).filter(FacebookPage.id == ad.facebook_page_id).first()
        if page:
            return f"@{page.page_name}"
    if ad.brand_name:
        return f"@{ad.brand_name}"
    return "@unknown"


async def main():
    today = date.today()
    now = datetime.utcnow()
    db = SessionLocal()
    try:
        token = _resolve_token()
        if not token:
            logger.error("FACEBOOK token env var missing; cannot run scrape")
            persist_report(
                db=db, report_date=today, total_scanned=0, new_count=0,
                competitors_scanned=0, keywords_scanned=0,
                scored=[], entries=[],
                summary_markdown=f"# Spy Report — {today}\nToken missing — set FACEBOOK_ADS_LIBRARY_TOKEN",
            )
            send_digest(f"🕵️ /spy aborted {today}: no FACEBOOK token configured")
            return

        # 1. Competitor scrape
        comp_result = await competitor_runner.run_competitor_scrape(db, access_token=token)
        competitor_new_ad_ids = set(comp_result.new_ad_ids)
        logger.info(
            f"competitor scrape: {comp_result.competitors_scanned} pages, "
            f"{comp_result.new_ads} new, {comp_result.total_ads_seen} total seen"
        )

        # 2. Scheduled keyword searches
        scheduler = SchedulerService(db)
        await scheduler.run_scheduled_searches()
        due = db.query(SavedSearch).filter(
            SavedSearch.search_type.in_(["scheduled_daily", "scheduled_weekly"]),
            SavedSearch.is_active == True,
        ).count()

        # 3. Score all active-ish ads (seen in the last 48h)
        cutoff = now - timedelta(hours=48)
        active_ads = db.query(ScrapedAd).filter(ScrapedAd.last_seen >= cutoff).all()
        logger.info(f"scoring {len(active_ads)} recently-active ads")

        scored = []
        for ad in active_ads:
            variants = count_variants(db, ad.id)
            is_new_today = ad.first_seen and ad.first_seen.date() == today
            from_competitor = ad.id in competitor_new_ad_ids
            s = score_ad(
                ad={
                    "id": ad.id,
                    "first_seen": ad.first_seen,
                    "last_seen": ad.last_seen,
                    "facebook_page_id": ad.facebook_page_id,
                    "ad_copy": ad.ad_copy,
                },
                variant_count=variants,
                is_new_today=bool(is_new_today),
                from_competitor=from_competitor,
                today=datetime.combine(today, datetime.min.time()),
            )
            scored.append(s)

        scored.sort(key=lambda s: s.score, reverse=True)
        top = scored[:TOP_N]

        # 4. Build entries + markdown
        entries: list[ReportEntry] = []
        ad_by_id = {a.id: a for a in active_ads}
        for rank, s in enumerate(top, start=1):
            ad = ad_by_id.get(s.ad_id)
            if not ad:
                continue
            page_name = _page_name_for(db, ad)
            reasons = build_reasons(s, page_name=page_name)
            entries.append(ReportEntry(
                rank=rank,
                page_name=page_name,
                headline=ad.headline or "",
                reasons=reasons,
                thumbnail_url=None,
                ad_library_url=ad.ad_link,
                copy_snippet=(ad.ad_copy or "")[:200],
                cta_text=ad.cta_text,
                landing_url=None,
            ))

        summary = render_markdown(
            report_date=today,
            total_scanned=len(active_ads),
            new_count=comp_result.new_ads,
            competitors_scanned=comp_result.competitors_scanned,
            keywords_scanned=due,
            entries=entries,
        )

        # 5. Persist
        report = persist_report(
            db=db,
            report_date=today,
            total_scanned=len(active_ads),
            new_count=comp_result.new_ads,
            competitors_scanned=comp_result.competitors_scanned,
            keywords_scanned=due,
            scored=top,
            entries=entries,
            summary_markdown=summary,
        )

        # 6. Telegram digest
        backend_url = os.getenv("BACKEND_URL", "")
        full_url = f"{backend_url}/api/v1/spy/reports/{today.isoformat()}" if backend_url else None
        digest_text = build_digest_text(
            report_date=today,
            total_scanned=len(active_ads),
            new_count=comp_result.new_ads,
            competitors_scanned=comp_result.competitors_scanned,
            keywords_scanned=due,
            entries=entries,
            full_report_url=full_url,
        )
        tg_resp = send_digest(digest_text)
        if tg_resp and tg_resp.get("ok"):
            report.telegram_chat_id = str(tg_resp["result"]["chat"]["id"])
            report.telegram_message_id = str(tg_resp["result"]["message_id"])
            db.commit()

        logger.info(f"/spy report for {today} complete: {len(top)} top, {comp_result.new_ads} new")
    except Exception as e:
        logger.exception(f"run_daily_spy crashed: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
