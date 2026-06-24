"""Competitor FB pages — track pages competitors run ads from."""
import os
import re
import uuid
import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func
from typing import Optional
from pydantic import BaseModel
from app.database import get_db
from app.models import Competitor, FacebookConnection, User
from app.core.deps import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter()


class CompetitorCreate(BaseModel):
    url: Optional[str] = None  # FB Ads Library URL to parse
    name: Optional[str] = None
    fb_page_id: Optional[str] = None
    group_name: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list] = None


class CompetitorUpdate(BaseModel):
    name: Optional[str] = None
    group_name: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list] = None


def _parse_page_id(url: str) -> Optional[str]:
    """Extract view_all_page_id from an FB Ads Library URL."""
    m = re.search(r'view_all_page_id=(\d+)', url)
    return m.group(1) if m else None


def _get_access_token(db: Session) -> Optional[str]:
    """Get a FB access token from the default connection or env."""
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.is_default == True,
        FacebookConnection.is_active == True,
    ).first()
    if conn:
        return conn.access_token
    return (
        os.getenv("FACEBOOK_ADS_LIBRARY_TOKEN")
        or os.getenv("FACEBOOK_ACCESS_TOKEN")
        or os.getenv("VITE_FACEBOOK_ACCESS_TOKEN")
    )


def _fetch_page_name(page_id: str, access_token: str) -> Optional[str]:
    """Fetch page name from Facebook Graph API."""
    try:
        resp = httpx.get(
            f"https://graph.facebook.com/v22.0/{page_id}",
            params={"fields": "name", "access_token": access_token},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json().get("name")
    except Exception as e:
        logger.warning(f"Failed to fetch page name for {page_id}: {e}")
    return None


def _serialize(c: Competitor) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "fb_page_id": c.fb_page_id,
        "fb_ads_library_url": c.fb_ads_library_url,
        "group_name": c.group_name,
        "notes": c.notes,
        "tags": c.tags or [],
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/")
def list_competitors(
    group: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(Competitor).order_by(Competitor.group_name, Competitor.created_at.desc())
    if group:
        query = query.filter(Competitor.group_name == group)
    competitors = query.all()
    return [_serialize(c) for c in competitors]


@router.get("/groups")
def list_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return distinct group names with counts."""
    rows = (
        db.query(Competitor.group_name, sa_func.count(Competitor.id))
        .group_by(Competitor.group_name)
        .order_by(Competitor.group_name)
        .all()
    )
    return [
        {"name": name or "Ungrouped", "count": count, "is_ungrouped": name is None}
        for name, count in rows
    ]


@router.post("/")
def create_competitor(
    data: CompetitorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    page_id = data.fb_page_id
    url = data.url

    # Parse page ID from URL if not provided directly
    if not page_id and url:
        page_id = _parse_page_id(url)
    if not page_id:
        raise HTTPException(status_code=400, detail="Could not extract a Facebook page ID. Paste a valid FB Ads Library URL or provide fb_page_id.")

    # Dedup
    existing = db.query(Competitor).filter(Competitor.fb_page_id == page_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Page already saved as \"{existing.name}\"")

    # Build the canonical Ads Library URL
    if not url:
        url = f"https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id={page_id}&search_type=page"

    # Try to fetch page name if not provided
    name = data.name
    if not name:
        token = _get_access_token(db)
        if token:
            name = _fetch_page_name(page_id, token)
    if not name:
        name = None  # Let the frontend handle prompting for name

    auto_named = name is None
    competitor = Competitor(
        id=str(uuid.uuid4()),
        name=name or "Unknown Page",
        fb_page_id=page_id,
        fb_ads_library_url=url,
        group_name=data.group_name or None,
        notes=data.notes,
        tags=data.tags,
    )
    db.add(competitor)
    db.commit()
    db.refresh(competitor)
    result = _serialize(competitor)
    result["auto_named"] = auto_named
    return result


@router.put("/{competitor_id}")
def update_competitor(
    competitor_id: str,
    data: CompetitorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    comp = db.query(Competitor).filter(Competitor.id == competitor_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Competitor not found")
    for field, value in data.dict(exclude_unset=True).items():
        setattr(comp, field, value)
    db.commit()
    db.refresh(comp)
    return _serialize(comp)


@router.delete("/{competitor_id}")
def delete_competitor(
    competitor_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    comp = db.query(Competitor).filter(Competitor.id == competitor_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Competitor not found")
    db.delete(comp)
    db.commit()
    return {"ok": True}
