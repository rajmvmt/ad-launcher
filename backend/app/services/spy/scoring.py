"""Scoring for /spy swipe file ranking.

Score components:
    days_active   — min(cap, (last_seen - first_seen).days)
    variant_count — supplied by caller (computed via pg_trgm similarity query)
    novelty_bonus — 20 if new today from competitor, 10 if new today from keyword

Total = days * W_DAYS + variants * W_VARIANTS + novelty
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

WEIGHT_DAYS_ACTIVE = 3
WEIGHT_VARIANT_COUNT = 5
NOVELTY_BONUS_COMPETITOR = 20
NOVELTY_BONUS_KEYWORD = 10
DAYS_ACTIVE_CAP = 30
SIMILARITY_THRESHOLD = 0.6
TOP_N = 20
AUTO_PROMOTE_SCORE = 80


@dataclass
class ScoredAd:
    ad_id: str
    score: int
    days_active: int
    variant_count: int
    novelty_bonus: int


def _coerce_dt(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v))
    except ValueError:
        return None


def score_ad(
    ad: dict,
    variant_count: int,
    is_new_today: bool,
    from_competitor: bool,
    today: datetime,
) -> ScoredAd:
    """Compute score for a single ScrapedAd-shaped dict.

    `ad` must provide at least: id, first_seen, last_seen.
    """
    first = _coerce_dt(ad.get("first_seen")) or today
    last = _coerce_dt(ad.get("last_seen")) or today
    days = max(0, (last.date() - first.date()).days)
    days = min(DAYS_ACTIVE_CAP, days)

    variants = max(1, int(variant_count))

    if is_new_today:
        novelty = NOVELTY_BONUS_COMPETITOR if from_competitor else NOVELTY_BONUS_KEYWORD
    else:
        novelty = 0

    total = (days * WEIGHT_DAYS_ACTIVE) + (variants * WEIGHT_VARIANT_COUNT) + novelty

    return ScoredAd(
        ad_id=str(ad.get("id")),
        score=total,
        days_active=days,
        variant_count=variants,
        novelty_bonus=novelty,
    )


def build_reasons(scored: ScoredAd, page_name: str | None) -> list[str]:
    reasons: list[str] = []
    if scored.days_active > 0:
        reasons.append(f"Running {scored.days_active}d")
    if scored.variant_count >= 2:
        reasons.append(f"{scored.variant_count} variants")
    if scored.novelty_bonus > 0:
        tag = page_name or "keyword"
        reasons.append(f"New from {tag}" if scored.novelty_bonus == NOVELTY_BONUS_COMPETITOR else f"New ({tag})")
    return reasons


def count_variants(db: Session, scraped_ad_id: str, threshold: float = SIMILARITY_THRESHOLD) -> int:
    """Count active ads from the same page with ad_copy similarity >= threshold.

    Uses PostgreSQL pg_trgm similarity(). Includes the target ad itself in
    the count (so a unique ad returns 1).
    """
    row = db.execute(
        text(
            """
            WITH target AS (
                SELECT facebook_page_id, ad_copy FROM scraped_ads WHERE id = :aid
            )
            SELECT COUNT(*) FROM scraped_ads s, target t
            WHERE s.facebook_page_id = t.facebook_page_id
              AND s.ad_copy IS NOT NULL
              AND t.ad_copy IS NOT NULL
              AND similarity(s.ad_copy, t.ad_copy) >= :thr
            """
        ),
        {"aid": scraped_ad_id, "thr": threshold},
    ).scalar()
    return int(row or 1)
