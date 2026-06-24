"""
Tracked FB Pages API — sync pages from connected FB accounts, manage associations.
"""
import json
import logging
import requests as http_requests
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.models import TrackedPage, FacebookConnection, User
from app.core.deps import get_current_active_user
from app.services.facebook_service import FacebookService
from app.services.assignment_sync import sync_from_page

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────

class PageUpdateRequest(BaseModel):
    brand_id: Optional[str] = None
    ad_account_id: Optional[str] = None
    domain_id: Optional[str] = None
    notes: Optional[str] = None


class ManualPageRequest(BaseModel):
    fb_page_id: str
    name: Optional[str] = None


# ── List ─────────────────────────────────────────────

@router.get("")
def list_pages(
    brand_id: Optional[str] = Query(None),
    ad_account_id: Optional[str] = Query(None),
    domain_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all tracked pages, optionally filtered."""
    q = db.query(TrackedPage).order_by(TrackedPage.name)
    if brand_id:
        q = q.filter(TrackedPage.brand_id == brand_id)
    if ad_account_id:
        q = q.filter(TrackedPage.ad_account_id == ad_account_id)
    if domain_id:
        q = q.filter(TrackedPage.domain_id == domain_id)
    return [_page_to_dict(p) for p in q.all()]


# ── Sync ─────────────────────────────────────────────

@router.post("/sync")
def sync_pages(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Pull all pages from connected FB accounts and upsert into tracked_pages."""
    connections = db.query(FacebookConnection).filter(
        FacebookConnection.is_active == True
    ).all()

    if not connections:
        raise HTTPException(status_code=400, detail="No active Facebook connections found")

    synced = 0
    created = 0
    errors = []

    for conn in connections:
        try:
            service = FacebookService(connection=conn)
            fb_pages = service.get_pages()

            for page in fb_pages:
                fb_page_id = page.get("id")
                if not fb_page_id:
                    continue

                existing = db.query(TrackedPage).filter(
                    TrackedPage.fb_page_id == fb_page_id
                ).first()

                # Build picture URL
                picture_url = f"https://graph.facebook.com/{fb_page_id}/picture?type=small"

                if existing:
                    # Update name/category if changed
                    existing.name = page.get("name", existing.name)
                    existing.category = page.get("category", existing.category)
                    existing.picture_url = picture_url
                    if not existing.connection_id:
                        existing.connection_id = conn.id
                    synced += 1
                else:
                    new_page = TrackedPage(
                        fb_page_id=fb_page_id,
                        name=page.get("name", "Unknown"),
                        category=page.get("category"),
                        picture_url=picture_url,
                        connection_id=conn.id,
                    )
                    db.add(new_page)
                    created += 1
                    synced += 1

        except Exception as e:
            logger.error(f"Failed to sync pages from connection {conn.id}: {e}")
            errors.append({"connection_id": conn.id, "error": str(e)})

    db.commit()

    # Fetch last post dates for all tracked pages
    _update_last_post_dates(db, connections)

    return {
        "synced": synced,
        "created": created,
        "errors": errors,
    }


# ── Manual Add ────────────────────────────────────────

@router.post("/add")
def add_page_manually(
    body: ManualPageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Manually add a page by FB Page ID. Tries to fetch name from Graph API."""
    import requests, os

    fb_page_id = body.fb_page_id.strip()
    if not fb_page_id:
        raise HTTPException(status_code=400, detail="fb_page_id is required")

    # Check if already tracked
    existing = db.query(TrackedPage).filter(TrackedPage.fb_page_id == fb_page_id).first()
    if existing:
        return {"status": "already_exists", "page": _page_to_dict(existing)}

    # Try to fetch name/category from Graph API
    name = body.name
    category = None
    picture_url = f"https://graph.facebook.com/{fb_page_id}/picture?type=small"

    if not name:
        # Try with any active connection's token
        conn = db.query(FacebookConnection).filter(FacebookConnection.is_active == True).first()
        token = conn.access_token if conn else (os.getenv("FACEBOOK_ACCESS_TOKEN") or os.getenv("VITE_FACEBOOK_ACCESS_TOKEN"))
        if token:
            try:
                resp = requests.get(
                    f"https://graph.facebook.com/v21.0/{fb_page_id}",
                    params={"fields": "id,name,category", "access_token": token},
                    timeout=10,
                )
                if resp.ok:
                    data = resp.json()
                    name = data.get("name", name)
                    category = data.get("category")
            except Exception as e:
                logger.warning(f"Could not fetch page info for {fb_page_id}: {e}")

    if not name:
        name = f"Page {fb_page_id}"

    new_page = TrackedPage(
        fb_page_id=fb_page_id,
        name=name,
        category=category,
        picture_url=picture_url,
    )
    db.add(new_page)
    db.commit()
    db.refresh(new_page)

    return {"status": "created", "page": _page_to_dict(new_page)}


# ── Update ───────────────────────────────────────────

@router.put("/{page_id}")
def update_page(
    page_id: str,
    body: PageUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a tracked page's associations."""
    page = db.query(TrackedPage).filter(TrackedPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Tracked page not found")

    if body.brand_id is not None:
        page.brand_id = body.brand_id or None
    if body.ad_account_id is not None:
        new_acct = body.ad_account_id or None
        if new_acct:
            conflict = db.query(TrackedPage).filter(
                TrackedPage.ad_account_id == new_acct,
                TrackedPage.id != page_id,
            ).first()
            if conflict:
                raise HTTPException(
                    status_code=400,
                    detail=f"Ad account already assigned to page '{conflict.name}'. One ad account per page.",
                )
        page.ad_account_id = new_acct
    if body.domain_id is not None:
        new_domain = body.domain_id or None
        if new_domain:
            conflict = db.query(TrackedPage).filter(
                TrackedPage.domain_id == new_domain,
                TrackedPage.id != page_id,
            ).first()
            if conflict:
                raise HTTPException(
                    status_code=400,
                    detail=f"Domain already assigned to page '{conflict.name}'. One domain per page.",
                )
        page.domain_id = new_domain
    if body.notes is not None:
        page.notes = body.notes or None

    db.commit()
    db.refresh(page)

    # Sync assignments to linked Domain and Persona
    sync_from_page(page, db)
    db.commit()

    return _page_to_dict(page)


# ── Delete ───────────────────────────────────────────

@router.delete("/{page_id}")
def delete_page(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Remove a tracked page."""
    page = db.query(TrackedPage).filter(TrackedPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Tracked page not found")
    db.delete(page)
    db.commit()
    return {"status": "deleted", "name": page.name}


# ── Comment Moderation Filters ────────────────────────

# Starter pack — common negative/spam words to block on FB page comments
DEFAULT_BLOCKED_KEYWORDS = [
    # Scam/fraud callouts
    "scam", "scammer", "scammed", "scamming", "fraud", "fraudulent", "fake",
    "con artist", "rip off", "ripoff", "ripped off", "ponzi", "pyramid scheme",
    # Warnings to others
    "don't buy", "dont buy", "do not buy", "don't order", "dont order",
    "do not order", "waste of money", "don't trust", "dont trust",
    "do not trust", "stay away", "beware", "warning",
    # Legal/reporting threats
    "lawsuit", "sue", "attorney general", "ftc", "bbb", "report them",
    "reporting", "class action", "lawyer",
    # Product complaints
    "doesn't work", "doesnt work", "does not work", "never received",
    "never arrived", "no refund", "won't refund", "cant cancel",
    "can't cancel", "unauthorized charge", "stolen",
    # Spam/bot patterns
    "make money", "work from home", "earn daily", "crypto", "bitcoin",
    "investment opportunity", "dm me", "check my profile", "link in bio",
    "free iphone", "congratulations you won", "click here",
]


class CommentFilterRequest(BaseModel):
    keywords: Optional[list] = None  # Custom keywords; uses defaults if None
    append: Optional[bool] = True  # Append to existing or replace


@router.get("/comment-filters/defaults")
def get_default_filters(
    current_user: User = Depends(get_current_active_user),
):
    """Return the default starter pack of blocked keywords."""
    return {"keywords": DEFAULT_BLOCKED_KEYWORDS, "count": len(DEFAULT_BLOCKED_KEYWORDS)}


@router.post("/{page_id}/comment-filters")
def apply_comment_filters(
    page_id: str,
    body: CommentFilterRequest = CommentFilterRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Apply comment moderation filters (blocked keywords) to a Facebook Page."""
    page = db.query(TrackedPage).filter(TrackedPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Tracked page not found")

    # Get an active connection for the page access token
    conn = None
    if page.connection_id:
        conn = db.query(FacebookConnection).filter(FacebookConnection.id == page.connection_id).first()
    if not conn:
        conn = db.query(FacebookConnection).filter(FacebookConnection.is_active == True).first()
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection")

    keywords = body.keywords or DEFAULT_BLOCKED_KEYWORDS

    try:
        service = FacebookService(connection=conn)
        page_token = service.get_page_access_token(page.fb_page_id)

        api_version = "v21.0"

        # If appending, fetch existing blacklist from page settings
        existing_keywords = []
        if body.append:
            resp = http_requests.get(
                f"https://graph.facebook.com/{api_version}/{page.fb_page_id}/settings",
                params={"access_token": page_token},
                timeout=15,
            )
            if resp.ok:
                for setting in resp.json().get("data", []):
                    if setting.get("setting") == "PAGE_MODERATION_BLACKLIST":
                        val = setting.get("value", "")
                        if isinstance(val, str) and val:
                            existing_keywords = [k.strip() for k in val.split(",") if k.strip()]
                        break

        # Merge: existing + new, deduplicated, lowercased
        all_keywords = list(dict.fromkeys(
            [k.lower().strip() for k in existing_keywords] +
            [k.lower().strip() for k in keywords]
        ))

        # Apply via Graph API — POST to /{page_id}/settings
        resp = http_requests.post(
            f"https://graph.facebook.com/{api_version}/{page.fb_page_id}/settings",
            data={
                "option": json.dumps({
                    "PAGE_MODERATION_BLACKLIST": ",".join(all_keywords)
                }),
                "access_token": page_token,
            },
            timeout=15,
        )

        if not resp.ok:
            error_data = resp.json()
            error_msg = error_data.get("error", {}).get("message", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=f"Facebook API error: {error_msg}")

        return {
            "success": True,
            "page_name": page.name,
            "keywords_applied": len(all_keywords),
            "keywords": all_keywords,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to apply comment filters to page %s", page.fb_page_id)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{page_id}/comment-filters")
def get_comment_filters(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get current comment moderation filters for a Facebook Page."""
    page = db.query(TrackedPage).filter(TrackedPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Tracked page not found")

    conn = None
    if page.connection_id:
        conn = db.query(FacebookConnection).filter(FacebookConnection.id == page.connection_id).first()
    if not conn:
        conn = db.query(FacebookConnection).filter(FacebookConnection.is_active == True).first()
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection")

    try:
        service = FacebookService(connection=conn)
        page_token = service.get_page_access_token(page.fb_page_id)

        resp = http_requests.get(
            f"https://graph.facebook.com/v21.0/{page.fb_page_id}/settings",
            params={"access_token": page_token},
            timeout=15,
        )
        if not resp.ok:
            error_data = resp.json()
            raise HTTPException(status_code=resp.status_code,
                                detail=error_data.get("error", {}).get("message", resp.text))

        keywords = []
        for setting in resp.json().get("data", []):
            if setting.get("setting") == "PAGE_MODERATION_BLACKLIST":
                val = setting.get("value", "")
                if isinstance(val, str) and val:
                    keywords = [k.strip() for k in val.split(",") if k.strip()]
                break

        return {"keywords": keywords, "count": len(keywords)}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get comment filters for page %s", page.fb_page_id)
        raise HTTPException(status_code=500, detail=str(e))


# ── Helpers ──────────────────────────────────────────

def _update_last_post_dates(db: Session, connections: list):
    """Fetch last post date for each tracked page via Graph API."""
    pages = db.query(TrackedPage).all()
    if not pages or not connections:
        return

    # Use first active connection's token
    token = connections[0].access_token if connections else None
    if not token:
        return

    api_version = "v21.0"
    for page in pages:
        try:
            resp = http_requests.get(
                f"https://graph.facebook.com/{api_version}/{page.fb_page_id}/posts",
                params={"limit": 1, "fields": "created_time", "access_token": token},
                timeout=10,
            )
            if resp.ok:
                data = resp.json().get("data", [])
                if data:
                    created_time = data[0].get("created_time")
                    if created_time:
                        page.last_post_at = datetime.fromisoformat(created_time.replace("Z", "+00:00"))
        except Exception as e:
            logger.warning("Failed to fetch last post for page %s: %s", page.fb_page_id, e)

    db.commit()


def _page_to_dict(p: TrackedPage) -> dict:
    return {
        "id": p.id,
        "fb_page_id": p.fb_page_id,
        "name": p.name,
        "category": p.category,
        "picture_url": p.picture_url,
        "brand_id": p.brand_id,
        "ad_account_id": p.ad_account_id,
        "domain_id": p.domain_id,
        "connection_id": p.connection_id,
        "notes": p.notes,
        "last_post_at": p.last_post_at.isoformat() if p.last_post_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }
