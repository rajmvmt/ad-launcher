"""Render the daily /spy swipe-file markdown report and persist as SpyReport."""
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional
from sqlalchemy.orm import Session

from app.models import SpyReport
from app.services.spy.scoring import ScoredAd


@dataclass
class ReportEntry:
    rank: int
    page_name: str
    headline: str
    reasons: list[str]
    thumbnail_url: Optional[str]
    ad_library_url: Optional[str]
    copy_snippet: Optional[str]
    cta_text: Optional[str]
    landing_url: Optional[str]


def render_markdown(
    report_date: date,
    total_scanned: int,
    new_count: int,
    competitors_scanned: int,
    keywords_scanned: int,
    entries: list[ReportEntry],
) -> str:
    lines = [
        f"# Spy Report — {report_date.isoformat()}",
        (
            f"Scanned {total_scanned:,} ads across "
            f"{competitors_scanned} competitors + {keywords_scanned} keywords. "
            f"{new_count} new today."
        ),
        "",
        "## Top 20 Swipe-worthy",
        "",
    ]
    for e in entries:
        headline = e.headline or "(no headline)"
        lines.append(f"### {e.rank}. {e.page_name} — \"{headline}\"")
        if e.reasons:
            lines.append("- " + " · ".join(e.reasons))
        if e.thumbnail_url:
            lines.append(f"- ![creative]({e.thumbnail_url})")
        if e.ad_library_url:
            lines.append(f"- [View in Ad Library]({e.ad_library_url})")
        if e.copy_snippet:
            lines.append(f"- **Copy:** {e.copy_snippet}")
        if e.cta_text:
            cta_line = f"- **CTA:** {e.cta_text}"
            if e.landing_url:
                cta_line += f" → {e.landing_url}"
            lines.append(cta_line)
        lines.append("")
    return "\n".join(lines)


def persist_report(
    db: Session,
    report_date: date,
    total_scanned: int,
    new_count: int,
    competitors_scanned: int,
    keywords_scanned: int,
    scored: list[ScoredAd],
    entries: list[ReportEntry],
    summary_markdown: str,
) -> SpyReport:
    """Upsert a SpyReport for the given date."""
    existing = db.query(SpyReport).filter(SpyReport.report_date == report_date).one_or_none()
    score_details = {
        s.ad_id: {
            "score": s.score,
            "days_active": s.days_active,
            "variant_count": s.variant_count,
            "novelty_bonus": s.novelty_bonus,
        }
        for s in scored
    }
    top_ids = [s.ad_id for s in scored]

    if existing:
        existing.total_ads_scanned = total_scanned
        existing.new_ads_count = new_count
        existing.competitors_scanned = competitors_scanned
        existing.keywords_scanned = keywords_scanned
        existing.top_scraped_ad_ids = top_ids
        existing.score_details = score_details
        existing.summary_markdown = summary_markdown
        db.commit()
        return existing

    report = SpyReport(
        report_date=report_date,
        total_ads_scanned=total_scanned,
        new_ads_count=new_count,
        competitors_scanned=competitors_scanned,
        keywords_scanned=keywords_scanned,
        top_scraped_ad_ids=top_ids,
        score_details=score_details,
        summary_markdown=summary_markdown,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report
