"""Scrape active ads for every active Competitor row."""
import asyncio
import logging
import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Competitor, ScrapedAd
from app.services.ad_library_scraper import AdLibraryScraper

logger = logging.getLogger(__name__)

SCRAPE_SLEEP_SECONDS = 1.0
PER_COMPETITOR_LIMIT = 100


@dataclass
class RunResult:
    competitors_scanned: int = 0
    total_ads_seen: int = 0
    new_ads: int = 0
    errors: list[str] = field(default_factory=list)
    new_ad_ids: list[str] = field(default_factory=list)


def _content_hash(ad: dict) -> str:
    payload = (ad.get("ad_copy") or "") + "|" + (ad.get("headline") or "")
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _upsert_scraped_ad(db: Session, ad: dict) -> tuple[ScrapedAd, bool]:
    external_id = ad.get("ad_library_id")
    content_hash = _content_hash(ad)

    existing = None
    if external_id:
        existing = db.query(ScrapedAd).filter(ScrapedAd.external_id == external_id).first()
    if existing is None:
        existing = db.query(ScrapedAd).filter(ScrapedAd.content_hash == content_hash).first()

    now = datetime.utcnow()
    if existing:
        existing.last_seen = now
        existing.seen_count = (existing.seen_count or 1) + 1
        db.add(existing)
        return existing, False

    new_ad = ScrapedAd(
        external_id=external_id,
        content_hash=content_hash,
        headline=ad.get("headline"),
        ad_copy=ad.get("ad_copy"),
        cta_text=ad.get("cta_text"),
        platform="facebook",
        ad_link=ad.get("ad_link") or f"https://facebook.com/ads/library/?id={external_id}",
        platforms=ad.get("platforms") or ["facebook"],
        start_date=ad.get("start_date"),
        media_type=ad.get("media_type"),
        first_seen=now,
        last_seen=now,
        seen_count=1,
    )
    db.add(new_ad)
    db.flush()
    return new_ad, True


async def run_competitor_scrape(db: Session, access_token: Optional[str]) -> RunResult:
    result = RunResult()
    if not access_token:
        result.errors.append("no access token")
        return result

    scraper = AdLibraryScraper(access_token)
    competitors = db.query(Competitor).all()

    for comp in competitors:
        if not comp.fb_page_id:
            continue
        try:
            ads = await scraper.search_by_page_id(
                comp.fb_page_id, limit=PER_COMPETITOR_LIMIT
            )
        except Exception as e:
            logger.exception(f"competitor scrape failed for {comp.fb_page_id}")
            result.errors.append(f"{comp.fb_page_id}: {e}")
            continue

        result.competitors_scanned += 1
        for ad in ads or []:
            saved, was_new = _upsert_scraped_ad(db, ad)
            result.total_ads_seen += 1
            if was_new:
                result.new_ads += 1
                result.new_ad_ids.append(saved.id)

        db.commit()
        if SCRAPE_SLEEP_SECONDS > 0:
            await asyncio.sleep(SCRAPE_SLEEP_SECONDS)

    return result
