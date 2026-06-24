"""Swipe File — save, organize, and search ad inspiration."""
import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List
from pydantic import BaseModel
from app.database import get_db
from app.models import SwipeFile, User
from app.core.deps import get_current_active_user
import asyncio
import uuid

logger = logging.getLogger(__name__)


def _run_auto_categorize(swipe_id: str):
    """Run auto_categorize_swipe in a new event loop (for BackgroundTasks)."""
    from app.services.swipe_analyzer import auto_categorize_swipe
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(auto_categorize_swipe(swipe_id))
    finally:
        loop.close()

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────

class SwipeCreate(BaseModel):
    headline: Optional[str] = None
    primary_text: Optional[str] = None
    cta_text: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    landing_page_url: Optional[str] = None
    platform: Optional[str] = None
    source_url: Optional[str] = None
    source_type: str = "manual"
    advertiser_name: Optional[str] = None
    advertiser_page_url: Optional[str] = None
    ad_library_id: Optional[str] = None
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    days_running: Optional[int] = None
    ai_analysis: Optional[dict] = None
    niche: Optional[str] = None
    creative_type: Optional[str] = None
    tags: Optional[list] = None
    collection: Optional[str] = None
    is_starred: bool = False
    notes: Optional[str] = None
    brand_id: Optional[str] = None


class SwipeUpdate(BaseModel):
    headline: Optional[str] = None
    primary_text: Optional[str] = None
    cta_text: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    landing_page_url: Optional[str] = None
    platform: Optional[str] = None
    source_url: Optional[str] = None
    source_type: Optional[str] = None
    advertiser_name: Optional[str] = None
    advertiser_page_url: Optional[str] = None
    niche: Optional[str] = None
    creative_type: Optional[str] = None
    tags: Optional[list] = None
    collection: Optional[str] = None
    is_starred: Optional[bool] = None
    notes: Optional[str] = None
    brand_id: Optional[str] = None


class BulkUrlImport(BaseModel):
    urls: List[str]
    collection: Optional[str] = None
    tags: Optional[list] = None


def _serialize(s: SwipeFile) -> dict:
    return {
        "id": s.id,
        "headline": s.headline,
        "primary_text": s.primary_text,
        "cta_text": s.cta_text,
        "description": s.description,
        "image_url": s.image_url,
        "video_url": s.video_url,
        "thumbnail_url": s.thumbnail_url,
        "landing_page_url": s.landing_page_url,
        "platform": s.platform,
        "source_url": s.source_url,
        "source_type": s.source_type,
        "advertiser_name": s.advertiser_name,
        "advertiser_page_url": s.advertiser_page_url,
        "ad_library_id": s.ad_library_id,
        "first_seen": s.first_seen.isoformat() if s.first_seen else None,
        "last_seen": s.last_seen.isoformat() if s.last_seen else None,
        "days_running": s.days_running,
        "ai_analysis": s.ai_analysis,
        "deep_analysis": s.deep_analysis,
        "niche": s.niche,
        "category": s.category,
        "creative_type": s.creative_type,
        "tags": s.tags or [],
        "collection": s.collection,
        "is_starred": s.is_starred,
        "notes": s.notes,
        "brand_id": s.brand_id,
        "brand_name": s.brand.name if s.brand else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


# ── List / Search ────────────────────────────────────────────────────

@router.get("/")
def list_swipes(
    platform: Optional[str] = None,
    source_type: Optional[str] = None,
    niche: Optional[str] = None,
    category: Optional[str] = None,
    creative_type: Optional[str] = None,
    collection: Optional[str] = None,
    brand_id: Optional[str] = None,
    starred: Optional[bool] = None,
    search: Optional[str] = None,
    sort: str = Query("newest", description="newest, oldest, longest_running, starred"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(SwipeFile)

    if platform:
        query = query.filter(SwipeFile.platform == platform)
    if source_type:
        query = query.filter(SwipeFile.source_type == source_type)
    if niche:
        query = query.filter(SwipeFile.niche == niche)
    if category:
        query = query.filter(SwipeFile.category == category)
    if creative_type:
        query = query.filter(SwipeFile.creative_type == creative_type)
    if collection:
        query = query.filter(SwipeFile.collection == collection)
    if brand_id:
        query = query.filter(SwipeFile.brand_id == brand_id)
    if starred is not None:
        query = query.filter(SwipeFile.is_starred == starred)
    if search:
        term = f"%{search}%"
        query = query.filter(
            or_(
                SwipeFile.headline.ilike(term),
                SwipeFile.primary_text.ilike(term),
                SwipeFile.advertiser_name.ilike(term),
                SwipeFile.notes.ilike(term),
                SwipeFile.niche.ilike(term),
            )
        )

    total = query.count()

    if sort == "oldest":
        query = query.order_by(SwipeFile.created_at.asc())
    elif sort == "longest_running":
        query = query.order_by(SwipeFile.days_running.desc().nullslast())
    elif sort == "starred":
        query = query.order_by(SwipeFile.is_starred.desc(), SwipeFile.created_at.desc())
    else:
        query = query.order_by(SwipeFile.created_at.desc())

    swipes = query.offset(offset).limit(limit).all()
    return {"total": total, "items": [_serialize(s) for s in swipes]}


# ── Collections list ─────────────────────────────────────────────────

@router.get("/collections")
def list_collections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from sqlalchemy import func as sqlfunc
    rows = (
        db.query(SwipeFile.collection, sqlfunc.count(SwipeFile.id))
        .filter(SwipeFile.collection.isnot(None))
        .group_by(SwipeFile.collection)
        .order_by(sqlfunc.count(SwipeFile.id).desc())
        .all()
    )
    return [{"name": name, "count": count} for name, count in rows]


# ── Niches & Categories ─────────────────────────────────────────────

@router.get("/niches")
def list_niches(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from sqlalchemy import func as sqlfunc
    rows = (
        db.query(SwipeFile.niche, sqlfunc.count(SwipeFile.id))
        .filter(SwipeFile.niche.isnot(None), SwipeFile.niche != "")
        .group_by(SwipeFile.niche)
        .order_by(sqlfunc.count(SwipeFile.id).desc())
        .all()
    )
    return [{"name": name, "count": count} for name, count in rows]


@router.get("/categories")
def list_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from sqlalchemy import func as sqlfunc
    rows = (
        db.query(SwipeFile.category, sqlfunc.count(SwipeFile.id))
        .filter(SwipeFile.category.isnot(None), SwipeFile.category != "")
        .group_by(SwipeFile.category)
        .order_by(sqlfunc.count(SwipeFile.id).desc())
        .all()
    )
    return [{"name": name, "count": count} for name, count in rows]


# ── Stats ────────────────────────────────────────────────────────────

@router.get("/stats")
def swipe_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    total = db.query(SwipeFile).count()
    starred = db.query(SwipeFile).filter(SwipeFile.is_starred == True).count()
    from sqlalchemy import func as sqlfunc
    by_platform = dict(
        db.query(SwipeFile.platform, sqlfunc.count(SwipeFile.id))
        .filter(SwipeFile.platform.isnot(None))
        .group_by(SwipeFile.platform)
        .all()
    )
    by_source = dict(
        db.query(SwipeFile.source_type, sqlfunc.count(SwipeFile.id))
        .group_by(SwipeFile.source_type)
        .all()
    )
    return {
        "total": total,
        "starred": starred,
        "by_platform": by_platform,
        "by_source": by_source,
    }


# ── CRUD ─────────────────────────────────────────────────────────────

@router.post("/")
def create_swipe(
    data: SwipeCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # Dedup by ad_library_id if provided
    if data.ad_library_id:
        existing = db.query(SwipeFile).filter(SwipeFile.ad_library_id == data.ad_library_id).first()
        if existing:
            return _serialize(existing)

    # Dedup by source_url if provided
    if data.source_url:
        existing = db.query(SwipeFile).filter(SwipeFile.source_url == data.source_url).first()
        if existing:
            return _serialize(existing)

    swipe = SwipeFile(id=str(uuid.uuid4()), **data.dict())
    db.add(swipe)
    db.commit()
    db.refresh(swipe)

    # Auto-categorize in background
    background_tasks.add_task(_run_auto_categorize, swipe.id)

    return _serialize(swipe)


@router.post("/bulk")
def bulk_create_swipes(
    items: List[SwipeCreate],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    created = []
    skipped = 0
    for data in items:
        if data.ad_library_id:
            existing = db.query(SwipeFile).filter(SwipeFile.ad_library_id == data.ad_library_id).first()
            if existing:
                skipped += 1
                continue
        if data.source_url:
            existing = db.query(SwipeFile).filter(SwipeFile.source_url == data.source_url).first()
            if existing:
                skipped += 1
                continue
        swipe = SwipeFile(id=str(uuid.uuid4()), **data.dict())
        db.add(swipe)
        created.append(swipe)

    if created:
        db.commit()
        for s in created:
            db.refresh(s)
            # Auto-categorize each new swipe in background
            background_tasks.add_task(_run_auto_categorize, s.id)

    return {"created": len(created), "skipped": skipped, "items": [_serialize(s) for s in created]}


@router.put("/{swipe_id}")
def update_swipe(
    swipe_id: str,
    data: SwipeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    swipe = db.query(SwipeFile).filter(SwipeFile.id == swipe_id).first()
    if not swipe:
        raise HTTPException(status_code=404, detail="Swipe not found")
    for field, value in data.dict(exclude_unset=True).items():
        setattr(swipe, field, value)
    db.commit()
    db.refresh(swipe)
    return _serialize(swipe)


@router.patch("/{swipe_id}/star")
def toggle_star(
    swipe_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    swipe = db.query(SwipeFile).filter(SwipeFile.id == swipe_id).first()
    if not swipe:
        raise HTTPException(status_code=404, detail="Swipe not found")
    swipe.is_starred = not swipe.is_starred
    db.commit()
    db.refresh(swipe)
    return _serialize(swipe)


@router.delete("/{swipe_id}")
def delete_swipe(
    swipe_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    swipe = db.query(SwipeFile).filter(SwipeFile.id == swipe_id).first()
    if not swipe:
        raise HTTPException(status_code=404, detail="Swipe not found")
    db.delete(swipe)
    db.commit()
    return {"ok": True}


@router.delete("/")
def bulk_delete(
    ids: List[str] = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    deleted = db.query(SwipeFile).filter(SwipeFile.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


# ── AI Analysis ──────────────────────────────────────────────────────

@router.post("/{swipe_id}/analyze")
async def analyze_swipe(
    swipe_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from app.services.swipe_analyzer import analyze_image_url, analyze_text

    swipe = db.query(SwipeFile).filter(SwipeFile.id == swipe_id).first()
    if not swipe:
        raise HTTPException(status_code=404, detail="Swipe not found")

    analysis = None
    try:
        if swipe.image_url or swipe.thumbnail_url:
            url = swipe.image_url or swipe.thumbnail_url
            analysis = await analyze_image_url(url)
        elif swipe.primary_text or swipe.headline:
            text = (swipe.headline or "") + "\n\n" + (swipe.primary_text or "")
            analysis = analyze_text(text.strip())
        else:
            raise HTTPException(status_code=400, detail="No image or text to analyze")
    except RuntimeError as e:
        logger.exception("Swipe file analysis error")
        raise HTTPException(status_code=500, detail="Analysis failed")

    if analysis and "error" not in analysis:
        swipe.ai_analysis = analysis
        if analysis.get("estimated_niche") and not swipe.niche:
            swipe.niche = analysis["estimated_niche"]
        if analysis.get("category") and not swipe.category:
            swipe.category = analysis["category"]
        if analysis.get("creative_style") and not swipe.creative_type:
            swipe.creative_type = analysis["creative_style"]
        db.commit()
        db.refresh(swipe)

    return _serialize(swipe)


@router.post("/analyze-bulk")
async def analyze_bulk(
    ids: List[str] = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from app.services.swipe_analyzer import analyze_image_url, analyze_text

    analyzed = 0
    failed = 0
    for sid in ids:
        swipe = db.query(SwipeFile).filter(SwipeFile.id == sid).first()
        if not swipe:
            failed += 1
            continue
        try:
            analysis = None
            if swipe.image_url or swipe.thumbnail_url:
                url = swipe.image_url or swipe.thumbnail_url
                analysis = await analyze_image_url(url)
            elif swipe.primary_text or swipe.headline:
                text = (swipe.headline or "") + "\n\n" + (swipe.primary_text or "")
                analysis = analyze_text(text.strip())

            if analysis and "error" not in analysis:
                swipe.ai_analysis = analysis
                if analysis.get("estimated_niche") and not swipe.niche:
                    swipe.niche = analysis["estimated_niche"]
                if analysis.get("category") and not swipe.category:
                    swipe.category = analysis["category"]
                if analysis.get("creative_style") and not swipe.creative_type:
                    swipe.creative_type = analysis["creative_style"]
                db.commit()
                analyzed += 1
            else:
                failed += 1
        except Exception:
            failed += 1

    return {"analyzed": analyzed, "failed": failed}


# ── Repair broken thumbnails ────────────────────────────────────────

@router.post("/repair-thumbnails")
async def repair_thumbnails(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Find swipes with missing or expired CDN thumbnails, re-download and upload to R2."""
    from app.core.config import settings
    from app.services.telegram_bot import _download_and_upload_image, _fetch_og_image

    r2_domain = settings.R2_PUBLIC_URL  # e.g. https://pub-xxx.r2.dev

    # Only fetch swipes that actually need repair (no R2 thumbnail)
    query = db.query(SwipeFile)
    if r2_domain:
        query = query.filter(
            (SwipeFile.thumbnail_url == None) |
            (~SwipeFile.thumbnail_url.contains(r2_domain))
        )
    else:
        query = query.filter(SwipeFile.thumbnail_url == None)
    all_swipes = query.all()
    repaired = 0
    failed = 0
    skipped = 0

    for swipe in all_swipes:

        # Try to fix: if we have a CDN thumbnail URL, re-download and upload to R2
        r2_url = None
        thumb = swipe.thumbnail_url or swipe.image_url
        if thumb:
            r2_url = _download_and_upload_image(thumb)

        # If that failed (expired CDN) and we have a source_url, try og:image
        if not r2_url and swipe.source_url:
            r2_url = _fetch_og_image(swipe.source_url)

        if r2_url and r2_domain and r2_domain in r2_url:
            swipe.thumbnail_url = r2_url
            if not swipe.image_url:
                swipe.image_url = r2_url
            db.commit()
            repaired += 1
        else:
            failed += 1

    return {"repaired": repaired, "failed": failed, "skipped": skipped}


# ── Refresh IG thumbnails via instaloader ─────────────────────────

@router.post("/refresh-ig-thumbnails")
async def refresh_ig_thumbnails(
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Find IG swipes missing thumbnails/videos, scrape with instaloader, upload to R2.

    Processes up to `limit` swipes per call (default 20) to avoid Instagram rate limits.
    Click multiple times to process more.
    """
    import time
    from app.services.instagram_scraper import scrape_instagram_post, HAS_INSTALOADER, get_credentials
    from app.core.config import settings

    if not HAS_INSTALOADER:
        raise HTTPException(status_code=503, detail="instaloader package not installed")

    username, password = get_credentials()
    if not username or not password:
        raise HTTPException(status_code=400, detail="No IG credentials configured. Go to Settings → Telegram Bot and add your Instagram username & password.")

    r2_domain = settings.R2_PUBLIC_URL

    # Find IG swipes that are missing thumbnails or don't have R2 URLs
    ig_swipes = db.query(SwipeFile).filter(
        SwipeFile.platform == "instagram"
    ).all()

    refreshed = 0
    failed = 0
    skipped = 0
    remaining = 0
    errors = []

    # Collect swipes that need refreshing
    to_refresh = []
    for swipe in ig_swipes:
        thumb = swipe.thumbnail_url or swipe.image_url
        has_r2_thumb = thumb and r2_domain and r2_domain in thumb

        if has_r2_thumb:
            skipped += 1
            continue
        if not swipe.source_url:
            skipped += 1
            continue
        to_refresh.append(swipe)

    remaining = max(0, len(to_refresh) - limit)

    for swipe in to_refresh[:limit]:
        try:
            media = scrape_instagram_post(swipe.source_url)
            # Pause 3s between scrapes to avoid rate limits
            await asyncio.sleep(3)
            updated = False

            if media["thumbnail_url"]:
                swipe.thumbnail_url = media["thumbnail_url"]
                if not swipe.image_url:
                    swipe.image_url = media["thumbnail_url"]
                updated = True

            if media["video_url"]:
                swipe.video_url = media["video_url"]
                updated = True

            if media["creative_type"] and not swipe.creative_type:
                swipe.creative_type = media["creative_type"]
                updated = True

            if media.get("landing_page_url") and not swipe.landing_page_url:
                swipe.landing_page_url = media["landing_page_url"]
                updated = True

            if media.get("cta_text") and not swipe.cta_text:
                swipe.cta_text = media["cta_text"]
                updated = True

            if media.get("caption") and not swipe.primary_text:
                swipe.primary_text = media["caption"]
                updated = True

            if updated:
                db.commit()
                refreshed += 1
            else:
                errors.append(f"{swipe.source_url}: no media returned (post deleted?)")
                failed += 1
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Refresh failed for {swipe.source_url}: {e}")
            errors.append(f"{swipe.source_url}: {str(e)[:100]}")
            failed += 1

    return {"refreshed": refreshed, "failed": failed, "skipped": skipped, "remaining": remaining, "errors": errors[:10]}
