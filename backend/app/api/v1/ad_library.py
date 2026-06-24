"""Meta Ad Library search & scrape endpoints for the Swipe File Discover feature."""
import logging
import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from app.database import get_db
from app.models import FacebookConnection, SwipeFile, User
from app.core.deps import get_current_active_user
from app.services.ad_library_scraper import AdLibraryScraper
from app.api.v1.swipe_file import _run_auto_categorize
import uuid

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_access_token(connection_id: Optional[str], db: Session) -> str:
    """Get FB access token from a connection, default connection, or env vars."""
    if connection_id:
        conn = db.query(FacebookConnection).filter(
            FacebookConnection.id == connection_id,
            FacebookConnection.is_active == True,
        ).first()
        if conn:
            return conn.access_token

    # Try default connection
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.is_default == True,
        FacebookConnection.is_active == True,
    ).first()
    if conn:
        return conn.access_token

    # Fallback to env vars (like the old Research scraper did)
    env_token = os.getenv("FACEBOOK_ADS_LIBRARY_TOKEN") or os.getenv("FACEBOOK_ACCESS_TOKEN") or os.getenv("VITE_FACEBOOK_ACCESS_TOKEN")
    if env_token:
        return env_token

    raise HTTPException(status_code=404, detail="No Facebook connection found. Add one in Settings or set FACEBOOK_ACCESS_TOKEN env var.")


# ── Search (returns results, doesn't save) ───────────────────────────

@router.get("/search")
async def search_ad_library(
    q: str = Query(..., description="Search keywords"),
    country: str = Query("US"),
    language: Optional[str] = Query(None, description="Filter by language code (e.g. en, es, fr)"),
    limit: int = Query(25, ge=1, le=100),
    active_only: bool = Query(True),
    connection_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    token = _get_access_token(connection_id, db)
    scraper = AdLibraryScraper(token)
    try:
        results = await scraper.search(
            search_terms=q,
            country=country,
            limit=limit,
            active_only=active_only,
            languages=[language] if language else None,
        )
    except Exception as e:
        logger.exception("Ad Library search error")
        raise HTTPException(status_code=502, detail="Ad Library search failed")

    # Mark which ones are already saved
    ad_lib_ids = [r["ad_library_id"] for r in results if r.get("ad_library_id")]
    saved_ids = set()
    if ad_lib_ids:
        saved = db.query(SwipeFile.ad_library_id).filter(
            SwipeFile.ad_library_id.in_(ad_lib_ids)
        ).all()
        saved_ids = {s[0] for s in saved}

    for r in results:
        r["already_saved"] = r.get("ad_library_id") in saved_ids

    return {"total": len(results), "items": results}


# ── Scrape (search + auto-save to swipe file) ────────────────────────

class ScrapeRequest(BaseModel):
    q: str
    country: str = "US"
    limit: int = 50
    active_only: bool = True
    collection: Optional[str] = None
    tags: Optional[List[str]] = None
    niche: Optional[str] = None
    connection_id: Optional[str] = None


@router.post("/scrape")
async def scrape_and_save(
    data: ScrapeRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    token = _get_access_token(data.connection_id, db)
    scraper = AdLibraryScraper(token)
    try:
        results = await scraper.search(
            search_terms=data.q,
            country=data.country,
            limit=data.limit,
            active_only=data.active_only,
        )
    except Exception as e:
        logger.exception("Ad Library search error")
        raise HTTPException(status_code=502, detail="Ad Library search failed")

    created = 0
    skipped = 0
    created_ids = []
    for r in results:
        # Dedup by ad_library_id
        if r.get("ad_library_id"):
            existing = db.query(SwipeFile).filter(
                SwipeFile.ad_library_id == r["ad_library_id"]
            ).first()
            if existing:
                skipped += 1
                continue

        swipe_id = str(uuid.uuid4())
        swipe = SwipeFile(
            id=swipe_id,
            headline=r.get("headline"),
            primary_text=r.get("primary_text"),
            cta_text=r.get("cta_text"),
            landing_page_url=r.get("landing_page_url"),
            video_url=r.get("video_url"),
            advertiser_name=r.get("advertiser_name"),
            advertiser_page_url=r.get("advertiser_page_url"),
            source_url=r.get("source_url"),
            thumbnail_url=r.get("thumbnail_url"),
            creative_type=r.get("media_type") if r.get("media_type") and r.get("media_type") != "unknown" else None,
            platform="facebook",
            source_type="ad_library",
            ad_library_id=r.get("ad_library_id"),
            first_seen=r.get("first_seen"),
            last_seen=r.get("last_seen"),
            days_running=r.get("days_running"),
            collection=data.collection,
            tags=data.tags,
            niche=data.niche,
        )
        db.add(swipe)
        created += 1
        created_ids.append(swipe_id)

    if created:
        db.commit()
        # Auto-categorize all new swipes in background
        for sid in created_ids:
            background_tasks.add_task(_run_auto_categorize, sid)

    return {"created": created, "skipped": skipped, "total_found": len(results)}


# ── Save single ad from search results ───────────────────────────────

class SaveAdRequest(BaseModel):
    ad_library_id: Optional[str] = None
    headline: Optional[str] = None
    primary_text: Optional[str] = None
    cta_text: Optional[str] = None
    landing_page_url: Optional[str] = None
    video_url: Optional[str] = None
    advertiser_name: Optional[str] = None
    advertiser_page_url: Optional[str] = None
    source_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    media_type: Optional[str] = None
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    days_running: Optional[int] = None
    collection: Optional[str] = None
    tags: Optional[List[str]] = None
    niche: Optional[str] = None


@router.post("/save")
def save_ad(
    data: SaveAdRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # Dedup
    if data.ad_library_id:
        existing = db.query(SwipeFile).filter(
            SwipeFile.ad_library_id == data.ad_library_id
        ).first()
        if existing:
            return {"already_saved": True, "id": existing.id}

    # If no thumbnail, try to extract one from the ad snapshot via Playwright
    thumbnail = data.thumbnail_url
    if not thumbnail and data.source_url:
        try:
            from app.services.ad_library_scraper import AdLibraryScraper
            scraper = AdLibraryScraper("")
            thumbnail = scraper._extract_snapshot_thumbnail(data.source_url)
        except Exception:
            pass

    # Convert render_ad URL (with embedded token) to public Ad Library URL for storage
    stored_url = data.source_url
    if stored_url and "/ads/archive/render_ad/" in stored_url and data.ad_library_id:
        stored_url = f"https://www.facebook.com/ads/library/?id={data.ad_library_id}"

    swipe = SwipeFile(
        id=str(uuid.uuid4()),
        headline=data.headline,
        primary_text=data.primary_text,
        cta_text=data.cta_text,
        landing_page_url=data.landing_page_url,
        video_url=data.video_url,
        advertiser_name=data.advertiser_name,
        advertiser_page_url=data.advertiser_page_url,
        source_url=stored_url,
        thumbnail_url=thumbnail,
        creative_type=data.media_type if data.media_type and data.media_type != "unknown" else None,
        platform="facebook",
        source_type="ad_library",
        ad_library_id=data.ad_library_id,
        first_seen=data.first_seen,
        last_seen=data.last_seen,
        days_running=data.days_running,
        collection=data.collection,
        tags=data.tags,
        niche=data.niche,
    )
    db.add(swipe)
    db.commit()

    # Auto-categorize in background
    background_tasks.add_task(_run_auto_categorize, swipe.id)

    return {"saved": True, "id": swipe.id}
