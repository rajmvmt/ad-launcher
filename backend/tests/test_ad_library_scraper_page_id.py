import pytest
from unittest.mock import AsyncMock, patch
from app.services.ad_library_scraper import AdLibraryScraper


@pytest.mark.asyncio
async def test_search_by_page_id_calls_api_with_page_filter():
    scraper = AdLibraryScraper("fake-token")
    with patch.object(scraper, "_api_search", new=AsyncMock(return_value=[
        {"ad_library_id": "123", "page_id": "987", "page_name": "TestCo",
         "ad_copy": "hi", "ad_link": "https://fb.com/ads/library/?id=123"}
    ])) as m:
        results = await scraper.search_by_page_id("987", limit=10)
    assert len(results) == 1
    # Verify the page id was passed through
    call_args = m.await_args
    # search_page_ids may be passed as positional or keyword
    assert "987" in (call_args.kwargs.get("search_page_ids") or []) or \
           any("987" in str(a) for a in (call_args.args or []))
