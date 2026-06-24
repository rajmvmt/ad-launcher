from datetime import datetime, date, timedelta
from app.services.spy.report_builder import render_markdown, ReportEntry


def test_render_markdown_header_counts():
    entries = []
    md = render_markdown(
        report_date=date(2026, 4, 16),
        total_scanned=1247,
        new_count=43,
        competitors_scanned=12,
        keywords_scanned=8,
        entries=entries,
    )
    assert "# Spy Report — 2026-04-16" in md
    assert "1,247" in md or "1247" in md
    assert "43" in md
    assert "12 competitors" in md
    assert "8 keywords" in md


def test_render_markdown_entries():
    today = datetime(2026, 4, 16)
    entries = [
        ReportEntry(
            rank=1,
            page_name="@CompetitorCo",
            headline="The one supplement doctors...",
            reasons=["Running 23d", "4 variants", "New from @CompetitorCo"],
            thumbnail_url="https://pub-xxx.r2.dev/ads/abc.jpg",
            ad_library_url="https://facebook.com/ads/library/?id=123",
            copy_snippet="Try our new ...",
            cta_text="Shop Now",
            landing_url="https://landing.example.com",
        ),
    ]
    md = render_markdown(
        report_date=date(2026, 4, 16),
        total_scanned=10, new_count=1,
        competitors_scanned=1, keywords_scanned=0,
        entries=entries,
    )
    assert "### 1. @CompetitorCo" in md
    assert "Running 23d" in md
    assert "4 variants" in md
    assert "https://pub-xxx.r2.dev/ads/abc.jpg" in md
    assert "Shop Now" in md
