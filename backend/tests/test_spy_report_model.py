from datetime import date
from app.database import SessionLocal
from app.models import SpyReport


# Sentinel date guaranteed not to collide with real /spy cron runs.
# Local dev and tests share the Railway prod DB (see CLAUDE.md), so using
# date.today() risks wiping a real row or leaking one via the unique
# report_date index.
SENTINEL_REPORT_DATE = date(1970, 1, 1)


def test_spy_report_insert_and_query():
    db = SessionLocal()
    try:
        # Clean up any prior run (e.g., if a previous test crashed mid-way)
        db.query(SpyReport).filter(
            SpyReport.report_date == SENTINEL_REPORT_DATE
        ).delete()
        db.commit()

        try:
            r = SpyReport(
                report_date=SENTINEL_REPORT_DATE,
                total_ads_scanned=100,
                new_ads_count=5,
                competitors_scanned=3,
                keywords_scanned=2,
                top_scraped_ad_ids=["a", "b"],
                score_details={"a": {"score": 50}},
                summary_markdown="# Test",
            )
            db.add(r)
            db.commit()

            fetched = db.query(SpyReport).filter(
                SpyReport.report_date == SENTINEL_REPORT_DATE
            ).one()
            assert fetched.top_scraped_ad_ids == ["a", "b"]
            assert fetched.score_details == {"a": {"score": 50}}
            assert fetched.summary_markdown == "# Test"
        finally:
            # Always clean up, even if assertions fail, so the next run
            # (test or real cron) doesn't hit a unique-constraint conflict.
            db.query(SpyReport).filter(
                SpyReport.report_date == SENTINEL_REPORT_DATE
            ).delete()
            db.commit()
    finally:
        db.close()
