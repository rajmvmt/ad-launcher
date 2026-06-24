"""Meta Ad Library API scraper with Playwright fallback.

Tries the official Graph API first. If that fails (e.g. system user tokens
get OAuthException on ads_archive), falls back to headless Chromium scraping
of the public Ad Library web UI.
"""
import httpx
import logging
from datetime import datetime, date
from typing import Optional, List

logger = logging.getLogger(__name__)

GRAPH_API_BASE = "https://graph.facebook.com/v22.0"

# Fields we request from the Ad Library API
AD_LIBRARY_FIELDS = ",".join([
    "id",
    "ad_creative_bodies",
    "ad_creative_link_captions",
    "ad_creative_link_titles",
    "ad_snapshot_url",
    "page_id",
    "page_name",
    "ad_delivery_start_time",
    "ad_delivery_stop_time",
    "publisher_platforms",
    "bylines",
    "languages",
])


class AdLibraryScraper:
    def __init__(self, access_token: str):
        self.access_token = access_token

    def _extract_snapshot_thumbnail(self, snapshot_url: str) -> Optional[str]:
        """Render an ad snapshot/render_ad URL in Playwright, capture the image bytes,
        upload to R2 for permanent storage. Returns permanent R2 URL.

        Works best with render_ad URLs (/ads/archive/render_ad/?id=xxx) which
        render a single ad creative, yielding exactly one content image.
        """
        if not snapshot_url:
            return None
        try:
            from playwright.sync_api import sync_playwright
            # Capture (url, bytes, content_type) tuples
            media_captures = []

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                )
                page = context.new_page()

                def on_response(response):
                    url = response.url
                    ct = response.headers.get("content-type", "")
                    if "image/" in ct and ("scontent" in url or "fbcdn" in url):
                        if "rsrc.php" not in url and "emoji" not in url and "/static/" not in url:
                            try:
                                body = response.body()
                                if body and len(body) > 2000:  # skip tiny icons
                                    media_captures.append((url, body, ct))
                            except Exception:
                                pass

                page.on("response", on_response)
                page.goto(snapshot_url, timeout=15000)
                page.wait_for_timeout(5000)
                browser.close()

            if not media_captures:
                return None

            # Pick the best image
            best = None

            # Prefer ad creative images (t39.35426-6 pattern)
            for cap_url, body, ct in media_captures:
                if "t39.35426-6" in cap_url:
                    best = (body, ct)
                    break

            # Next: skip small profile pics / avatars
            if not best:
                for cap_url, body, ct in media_captures:
                    if "/p50x50/" in cap_url or "/p60x60/" in cap_url or "/p100x100/" in cap_url:
                        continue
                    if "t1.30497" in cap_url:
                        continue
                    best = (body, ct)
                    break

            if not best:
                best = (media_captures[0][1], media_captures[0][2])

            # Upload to R2 for permanent storage (FB CDN URLs expire too)
            return self._upload_to_r2(best[0], best[1])
        except Exception as e:
            logger.debug(f"Snapshot thumbnail fetch failed: {e}")
            return None

    @staticmethod
    def _upload_to_r2(image_bytes: bytes, content_type: str) -> Optional[str]:
        """Upload image bytes to R2 and return permanent URL."""
        try:
            import uuid
            from app.api.v1.uploads import get_s3_client
            from app.core.config import settings

            client = get_s3_client()
            if not client:
                return None

            ext = "jpg"
            if "png" in content_type:
                ext = "png"
            elif "webp" in content_type:
                ext = "webp"

            filename = f"swipe-thumbs/fb/{uuid.uuid4().hex}.{ext}"
            client.put_object(
                Bucket=settings.R2_BUCKET_NAME,
                Key=filename,
                Body=image_bytes,
                ContentType=content_type,
            )
            return f"{settings.R2_PUBLIC_URL}/{filename}"
        except Exception as e:
            logger.debug(f"R2 upload failed: {e}")
            return None

    async def search(
        self,
        search_terms: str,
        country: str = "US",
        ad_type: str = "ALL",
        limit: int = 50,
        active_only: bool = True,
        search_page_ids: Optional[List[str]] = None,
        languages: Optional[List[str]] = None,
    ) -> List[dict]:
        """Search the Meta Ad Library. Tries API first, falls back to Playwright."""
        api_error = None

        # Try official API first
        try:
            results = await self._api_search(
                search_terms, country, ad_type, limit, active_only, search_page_ids, languages
            )
            if results:
                return results
            logger.info(f"API returned 0 results for '{search_terms}', trying Playwright fallback")
        except Exception as e:
            api_error = str(e)
            logger.warning(f"API search failed: {e}, trying Playwright fallback")

        # Fallback to Playwright browser scraping
        try:
            results = await self._playwright_search(search_terms, country, limit)
            if results:
                return results
        except ImportError:
            logger.error("Playwright not installed — cannot use browser fallback")
        except Exception as e:
            logger.error(f"Playwright fallback failed: {e}")

        # Both methods failed
        if api_error:
            raise Exception(f"Ad Library search failed: {api_error}")
        raise Exception("Ad Library search returned no results from both API and browser scraping")

    async def search_by_page_id(
        self,
        page_id: str,
        country: str = "US",
        limit: int = 100,
        active_only: bool = True,
        languages: Optional[List[str]] = None,
    ) -> List[dict]:
        """Scrape active ads for a single FB Page by id. Thin wrapper over _api_search."""
        try:
            return await self._api_search(
                search_terms="",
                country=country,
                ad_type="ALL",
                limit=limit,
                active_only=active_only,
                search_page_ids=[page_id],
                languages=languages,
            )
        except Exception as e:
            logger.warning(f"search_by_page_id({page_id}) API failed: {e}")
            return []

    # ── Official API search ────────────────────────────────────────────

    async def _api_search(
        self, search_terms, country, ad_type, limit, active_only, search_page_ids, languages=None
    ) -> List[dict]:
        """Search using the official Facebook Ads Library API."""
        params = {
            "access_token": self.access_token,
            "search_terms": search_terms,
            "ad_reached_countries": country,
            "ad_type": ad_type,
            "fields": AD_LIBRARY_FIELDS,
            "limit": min(limit, 300),
        }

        if active_only:
            params["ad_active_status"] = "ACTIVE"

        if search_page_ids:
            params["search_page_ids"] = ",".join(search_page_ids)

        if languages:
            params["languages"] = ",".join(languages)

        results = []
        url = f"{GRAPH_API_BASE}/ads_archive"

        async with httpx.AsyncClient(timeout=30) as client:
            while len(results) < limit:
                resp = await client.get(url, params=params)
                if resp.status_code != 200:
                    error_data = {}
                    try:
                        error_data = resp.json()
                    except Exception:
                        pass
                    raise Exception(
                        f"Ad Library API error {resp.status_code}: "
                        f"{error_data.get('error', {}).get('message', resp.text[:200])}"
                    )

                data = resp.json()
                ads = data.get("data", [])
                if not ads:
                    break

                for ad in ads:
                    results.append(self._normalize_api_ad(ad))

                paging = data.get("paging", {})
                next_url = paging.get("next")
                if not next_url or len(results) >= limit:
                    break
                url = next_url
                params = {}

        return results[:limit]

    def _normalize_api_ad(self, ad: dict) -> dict:
        """Normalize an API result into our SwipeFile format."""
        start_str = ad.get("ad_delivery_start_time")
        stop_str = ad.get("ad_delivery_stop_time")
        start_date = None
        stop_date = None
        days_running = None

        if start_str:
            try:
                start_date = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass

        if stop_str:
            try:
                stop_date = datetime.fromisoformat(stop_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass

        if start_date:
            end = stop_date or datetime.now(start_date.tzinfo)
            days_running = max(1, (end - start_date).days)

        bodies = ad.get("ad_creative_bodies", [])
        titles = ad.get("ad_creative_link_titles", [])
        captions = ad.get("ad_creative_link_captions", [])
        platforms = ad.get("publisher_platforms", [])

        # ad_creative_link_captions contains the domain (e.g. "SECURE.REJUVACARE.COM")
        caption = captions[0] if captions else None
        landing_page_url = None
        if caption:
            # The caption is typically a domain — construct a URL from it
            domain = caption.strip().lower()
            if domain and "." in domain and " " not in domain:
                landing_page_url = f"https://{domain}"

        return {
            "ad_library_id": ad.get("id"),
            "headline": titles[0] if titles else None,
            "primary_text": bodies[0] if bodies else None,
            "cta_text": caption,
            "landing_page_url": landing_page_url,
            "video_url": None,  # API doesn't expose video URLs
            "advertiser_name": ad.get("page_name"),
            "advertiser_page_url": f"https://www.facebook.com/{ad['page_id']}" if ad.get("page_id") else None,
            "source_url": ad.get("ad_snapshot_url"),
            "platform": "facebook",
            "source_type": "ad_library",
            "first_seen": start_date.isoformat() if start_date else None,
            "last_seen": stop_date.isoformat() if stop_date else None,
            "days_running": days_running,
            "publisher_platforms": platforms,
            "thumbnail_url": None,
            "media_type": "unknown",
        }

    # ── Playwright browser fallback ────────────────────────────────────

    async def _playwright_search(
        self, search_terms: str, country: str, limit: int
    ) -> List[dict]:
        """Scrape the Ad Library web UI with headless Chromium."""
        from playwright.async_api import async_playwright
        import urllib.parse

        params = {
            "active_status": "active",
            "ad_type": "all",
            "country": country,
            "q": search_terms,
            "sort_data[direction]": "desc",
            "sort_data[mode]": "relevancy_monthly_grouped",
            "media_type": "all",
        }
        url = f"https://www.facebook.com/ads/library/?{urllib.parse.urlencode(params)}"
        logger.info(f"Playwright scraping: {url}")

        results = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/121.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()

            try:
                await page.goto(url, timeout=60000, wait_until="domcontentloaded")

                # Wait for ads to appear
                try:
                    await page.wait_for_selector("text=Library ID:", timeout=15000)
                except Exception:
                    logger.warning("No ads found or page didn't load properly")
                await page.wait_for_timeout(2000)

                # Scroll to load more ads — optimized: fewer scrolls, shorter waits
                scrolls = min(5, (limit // 5) + 1)
                for i in range(scrolls):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(1000)

                await page.wait_for_timeout(1500)

                # Extract ads from DOM with thumbnails + media type
                ads_data = await page.evaluate(_EXTRACTION_JS)
                logger.info(f"Playwright found {len(ads_data)} ads in DOM")

                # Convert to our format
                for ad in ads_data[:limit]:
                    ext_id = ad.get("external_id")
                    start_date_str = ad.get("start_date")
                    days_running = _calc_days_running(start_date_str)

                    results.append({
                        "ad_library_id": ext_id,
                        "headline": ad.get("headline"),
                        "primary_text": (ad.get("ad_copy") or "")[:500] or None,
                        "cta_text": ad.get("cta_text"),
                        "landing_page_url": ad.get("landing_page_url"),
                        "video_url": ad.get("video_url"),
                        "advertiser_name": ad.get("brand_name", "Unknown"),
                        "advertiser_page_url": None,
                        "source_url": f"https://www.facebook.com/ads/library/?id={ext_id}" if ext_id else None,
                        "platform": "facebook",
                        "source_type": "ad_library",
                        "first_seen": start_date_str,
                        "last_seen": None,
                        "days_running": days_running,
                        "publisher_platforms": ad.get("platforms") or [],
                        "thumbnail_url": ad.get("thumbnail_url"),
                        "media_type": ad.get("media_type", "unknown"),
                    })

            finally:
                await browser.close()

        return results


def _calc_days_running(start_date_str: Optional[str]) -> Optional[int]:
    """Calculate days running from a date string like 'Jan 15, 2026'."""
    if not start_date_str:
        return None
    try:
        # Try common date formats from Ad Library
        for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %d %Y", "%B %d %Y"):
            try:
                start = datetime.strptime(start_date_str.strip(), fmt).date()
                return max(1, (date.today() - start).days)
            except ValueError:
                continue
    except Exception:
        pass
    return None


# ── Playwright DOM extraction JavaScript ──────────────────────────────
# Walks the DOM tree to find ad containers. Extracts: text fields,
# Library IDs, brands, headlines, copy, CTA buttons, platforms, dates,
# thumbnail images, and media type (image/video/carousel).

_EXTRACTION_JS = """
() => {
    const results = [];
    const seenIds = new Set();

    const libraryIdDivs = Array.from(document.querySelectorAll('div')).filter(div => {
        const text = div.innerText || '';
        return text.includes('Library ID:');
    });

    libraryIdDivs.forEach(idDiv => {
        let current = idDiv;
        let adContainer = null;

        for (let i = 0; i < 10 && current; i++) {
            const text = current.innerText || '';
            if (text.includes('Library ID:') &&
                (text.includes('Sponsored') || text.length > 200)) {
                if (text.length < 15000) {
                    adContainer = current;
                }
            }
            current = current.parentElement;
        }

        if (!adContainer) return;

        const text = adContainer.innerText || '';

        const idMatch = text.match(/Library ID:\\s*(\\d+)/);
        if (!idMatch) return;

        const libraryId = idMatch[1];
        if (seenIds.has(libraryId)) return;
        seenIds.add(libraryId);

        const lines = text.split(String.fromCharCode(10))
            .map(l => l.trim())
            .filter(l => l.length > 0 && l !== String.fromCharCode(8203));

        let brandName = 'Unknown Brand';
        let sponsoredIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === 'Sponsored') {
                sponsoredIndex = i;
                if (i > 0) {
                    const candidate = lines[i - 1];
                    if (candidate && candidate.length > 3 && candidate.length < 150 &&
                        !candidate.includes('Library ID') &&
                        !candidate.includes('See ad details') &&
                        !candidate.includes('Menu') &&
                        candidate !== 'Active' &&
                        candidate !== 'Inactive') {
                        brandName = candidate;
                    }
                }
                break;
            }
        }

        let adCopy = '';
        let headline = '';

        for (let i = sponsoredIndex + 1; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes('Library ID') ||
                line.includes('Started running') ||
                line.includes('Platforms') ||
                line.includes('http://') ||
                line.includes('https://') ||
                line.includes('HTTPS://') ||
                line.includes('HTTP://')) {
                break;
            }

            if (line.length < 3) continue;

            if (!headline && line.length >= 10) {
                headline = line;
                continue;
            }

            if (headline && line.length >= 10) {
                adCopy += (adCopy ? '\\n' : '') + line;
            }
        }

        let ctaText = null;
        let landingPageUrl = null;
        adContainer.querySelectorAll('a, button').forEach(el => {
            const elText = (el.innerText || '').trim();
            const commonCTAs = ['learn more', 'shop now', 'sign up', 'get started',
                               'download', 'subscribe', 'buy now', 'see more',
                               'order now', 'book now', 'apply now', 'contact us',
                               'get offer', 'watch more', 'listen now', 'install now'];
            if (commonCTAs.some(cta => elText.toLowerCase().includes(cta))) {
                ctaText = elText;
                // Try to grab the href — Facebook wraps CTA in <a> tags
                if (el.tagName === 'A' && el.href) {
                    const href = el.href;
                    if (!href.includes('facebook.com') && !href.includes('fb.com') && href.startsWith('http')) {
                        landingPageUrl = href;
                    }
                }
            }
        });

        // Also look for domain-like link captions (e.g. "SECURE.REJUVACARE.COM")
        if (!landingPageUrl) {
            adContainer.querySelectorAll('a').forEach(el => {
                const href = el.href || '';
                const elText = (el.innerText || '').trim();
                // Domain-like captions that aren't FB links
                if (href.startsWith('http') && !href.includes('facebook.com') && !href.includes('fb.com')
                    && !href.includes('l.facebook.com') && elText.length > 3 && elText.length < 100
                    && !elText.includes('Library ID') && !elText.includes('Started running')) {
                    landingPageUrl = href;
                }
            });
        }

        let platforms = [];
        if (text.includes('Facebook')) platforms.push('facebook');
        if (text.includes('Instagram')) platforms.push('instagram');
        if (text.includes('Messenger')) platforms.push('messenger');
        if (text.includes('Audience Network')) platforms.push('audience_network');

        let startDate = null;
        const dateMatch = text.match(/Started running on\\s+([A-Za-z]+\\s+\\d+,?\\s*\\d*)/);
        if (dateMatch) startDate = dateMatch[1];

        // ── Extract thumbnail image ──
        let thumbnailUrl = null;
        let mediaType = 'unknown';

        // Look for images within the ad container
        const imgs = adContainer.querySelectorAll('img');
        for (const img of imgs) {
            const src = img.src || img.getAttribute('src') || '';
            // Skip tiny icons, profile pics, platform logos
            const w = img.naturalWidth || img.width || 0;
            const h = img.naturalHeight || img.height || 0;
            if (w >= 100 && h >= 100 && src.startsWith('http')) {
                thumbnailUrl = src;
                mediaType = 'image';
                break;
            }
            // Also check by CSS dimensions if natural size unknown
            const rect = img.getBoundingClientRect();
            if (rect.width >= 100 && rect.height >= 100 && src.startsWith('http')) {
                thumbnailUrl = src;
                mediaType = 'image';
                break;
            }
        }

        // If no big image found, check for any reasonable image
        if (!thumbnailUrl) {
            for (const img of imgs) {
                const src = img.src || '';
                // Skip Facebook UI elements (emoji, icons, logos)
                if (src.includes('emoji') || src.includes('rsrc.php') || src.includes('static')) continue;
                if (src.startsWith('http') && src.includes('scontent')) {
                    thumbnailUrl = src;
                    mediaType = 'image';
                    break;
                }
            }
        }

        // Detect video ads — look for video elements or play button indicators
        let videoUrl = null;
        const videos = adContainer.querySelectorAll('video');
        if (videos.length > 0) {
            mediaType = 'video';
            for (const vid of videos) {
                // Grab video src for playback
                if (vid.src && vid.src.startsWith('http')) {
                    videoUrl = vid.src;
                }
                // Check <source> children too
                if (!videoUrl) {
                    const source = vid.querySelector('source');
                    if (source && source.src && source.src.startsWith('http')) {
                        videoUrl = source.src;
                    }
                }
                // Try to get video poster as thumbnail
                if (vid.poster) {
                    thumbnailUrl = vid.poster;
                }
                if (videoUrl) break;
            }
        }

        // Check for video play button SVG/icon (Facebook often uses these instead of <video>)
        if (mediaType === 'unknown' || mediaType === 'image') {
            const svgs = adContainer.querySelectorAll('svg');
            const playIcon = Array.from(svgs).find(svg => {
                const html = svg.innerHTML || '';
                // Play button triangles in SVG
                return html.includes('polygon') || html.includes('play');
            });
            // Also check for "Video" text in ad metadata
            if (playIcon || text.includes('video') || text.includes('Video')) {
                // Only override if we found strong evidence of video
                if (playIcon) mediaType = 'video';
            }
        }

        // Detect carousel — multiple images or carousel indicators
        const imageCount = Array.from(imgs).filter(img => {
            const rect = img.getBoundingClientRect();
            return rect.width >= 80 && rect.height >= 80;
        }).length;
        if (imageCount >= 3) {
            mediaType = 'carousel';
        }

        results.push({
            external_id: libraryId,
            brand_name: brandName,
            headline: headline || null,
            ad_copy: adCopy.substring(0, 500),
            cta_text: ctaText,
            landing_page_url: landingPageUrl,
            video_url: videoUrl,
            platforms: platforms.length > 0 ? platforms : null,
            start_date: startDate,
            thumbnail_url: thumbnailUrl,
            media_type: mediaType
        });
    });

    return results;
}
"""
