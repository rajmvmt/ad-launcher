import uuid
from datetime import datetime, date, timedelta

from app.database import SessionLocal
from app.models import ScrapedAd, FacebookPage
from app.services.spy.scoring import (
    score_ad, build_reasons, ScoredAd,
    WEIGHT_DAYS_ACTIVE, WEIGHT_VARIANT_COUNT,
    NOVELTY_BONUS_COMPETITOR, NOVELTY_BONUS_KEYWORD,
    DAYS_ACTIVE_CAP,
    count_variants,
)

def _ad(first_seen, last_seen, ad_id="a1", page_name="@x"):
    return {
        "id": ad_id,
        "first_seen": first_seen,
        "last_seen": last_seen,
        "facebook_page_id": "pg1",
        "page_name": page_name,
        "ad_copy": "Try our new blood sugar support",
    }

def test_days_active_component():
    today = datetime(2026, 4, 16)
    ad = _ad(first_seen=today - timedelta(days=10), last_seen=today)
    result = score_ad(ad, variant_count=1, is_new_today=False,
                      from_competitor=True, today=today)
    assert result.days_active == 10
    assert result.variant_count == 1
    assert result.novelty_bonus == 0
    assert result.score == (10 * WEIGHT_DAYS_ACTIVE) + (1 * WEIGHT_VARIANT_COUNT)

def test_days_active_cap():
    today = datetime(2026, 4, 16)
    ad = _ad(first_seen=today - timedelta(days=60), last_seen=today)
    result = score_ad(ad, variant_count=1, is_new_today=False,
                      from_competitor=True, today=today)
    assert result.days_active == DAYS_ACTIVE_CAP

def test_novelty_competitor():
    today = datetime(2026, 4, 16)
    ad = _ad(first_seen=today, last_seen=today)
    result = score_ad(ad, variant_count=1, is_new_today=True,
                      from_competitor=True, today=today)
    assert result.novelty_bonus == NOVELTY_BONUS_COMPETITOR

def test_novelty_keyword():
    today = datetime(2026, 4, 16)
    ad = _ad(first_seen=today, last_seen=today)
    result = score_ad(ad, variant_count=1, is_new_today=True,
                      from_competitor=False, today=today)
    assert result.novelty_bonus == NOVELTY_BONUS_KEYWORD

def test_reasons_include_duration_variants_novelty():
    today = datetime(2026, 4, 16)
    ad = _ad(first_seen=today - timedelta(days=23), last_seen=today, page_name="@CompetitorCo")
    result = score_ad(ad, variant_count=4, is_new_today=False,
                      from_competitor=True, today=today)
    reasons = build_reasons(result, page_name="@CompetitorCo")
    assert "Running 23d" in reasons
    assert "4 variants" in reasons

def test_reasons_new_today():
    today = datetime(2026, 4, 16)
    ad = _ad(first_seen=today, last_seen=today, page_name="@NewCo")
    result = score_ad(ad, variant_count=1, is_new_today=True,
                      from_competitor=True, today=today)
    reasons = build_reasons(result, page_name="@NewCo")
    assert any("New" in r for r in reasons)
    assert any("@NewCo" in r for r in reasons)


def _make_ad(db, page_id, ad_copy, ad_id=None):
    a = ScrapedAd(
        id=ad_id or str(uuid.uuid4()),
        facebook_page_id=page_id,
        ad_copy=ad_copy,
        ad_link="https://fb.com/ads/library/?id=1",
    )
    db.add(a)
    return a


def test_count_variants_groups_similar_copy():
    db = SessionLocal()
    pg = str(uuid.uuid4())
    try:
        page = FacebookPage(id=pg, page_name=f"spy-test-{pg}")
        db.add(page)
        db.flush()

        target = _make_ad(db, pg, "Doctors hate this one weird trick for blood sugar")
        _make_ad(db, pg, "Doctors hate this ONE weird trick for blood sugar support")
        _make_ad(db, pg, "Completely unrelated lawn mowing offer")
        db.commit()

        count = count_variants(db, target.id, threshold=0.6)
        assert count >= 2
    finally:
        try:
            db.rollback()
            db.query(ScrapedAd).filter(ScrapedAd.facebook_page_id == pg).delete()
            db.query(FacebookPage).filter(FacebookPage.id == pg).delete()
            db.commit()
        finally:
            db.close()
