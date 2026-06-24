import uuid
import pytest
from app.database import SessionLocal
from app.models import Competitor, ScrapedAd


@pytest.mark.asyncio
async def test_runner_upserts_scraped_ads_per_competitor(monkeypatch):
    from app.services.spy import competitor_runner

    db = SessionLocal()
    c = Competitor(
        id=str(uuid.uuid4()),
        name="FakeCo",
        fb_page_id=str(uuid.uuid4()),
        group_name=f"spy-test-{uuid.uuid4()}",
    )
    try:
        db.add(c)
        db.commit()

        fake_results = [
            {
                "ad_library_id": "extA-" + c.id[:8],
                "page_id": c.fb_page_id,
                "page_name": "FakeCo",
                "ad_copy": f"Buy our thing {c.id}",
                "headline": f"Deal of the day {c.id}",
                "cta_text": "Shop Now",
                "ad_link": f"https://fb.com/ads/library/?id=extA-{c.id[:8]}",
                "platforms": ["facebook"],
                "start_date": "2026-04-01",
                "media_type": "image",
                "thumbnail_url": None,
            }
        ]

        async def fake_search_by_page_id(self, page_id, **kwargs):
            if page_id == c.fb_page_id:
                return fake_results
            return []

        monkeypatch.setattr(
            "app.services.ad_library_scraper.AdLibraryScraper.search_by_page_id",
            fake_search_by_page_id,
        )

        # Keep this run fast — don't sleep between competitors in tests
        monkeypatch.setattr(
            "app.services.spy.competitor_runner.SCRAPE_SLEEP_SECONDS",
            0.0,
        )

        result = await competitor_runner.run_competitor_scrape(db, access_token="fake")
        assert result.competitors_scanned >= 1
        assert result.new_ads >= 1

        saved = db.query(ScrapedAd).filter(ScrapedAd.external_id == f"extA-{c.id[:8]}").first()
        assert saved is not None
        assert len(result.new_ad_ids) >= 1
        assert saved.id in result.new_ad_ids
    finally:
        try:
            db.query(ScrapedAd).filter(ScrapedAd.external_id == f"extA-{c.id[:8]}").delete()
            db.query(Competitor).filter(Competitor.id == c.id).delete()
            db.commit()
        except Exception:
            db.rollback()
        db.close()
