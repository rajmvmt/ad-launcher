"""Google Ads API — campaign management, reporting, keyword planning."""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, GoogleAdsConnection
from app.core.deps import get_current_active_user, require_permission
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


# ── OAuth Flow ───────────────────────────────────────────────────────

@router.get("/auth-url")
def get_auth_url(current_user: User = Depends(get_current_active_user)):
    """Generate Google OAuth URL for connecting a Google Ads account."""
    from app.services.google_ads_service import GoogleAdsService
    return {"url": GoogleAdsService.get_auth_url()}


@router.get("/callback")
async def oauth_callback(
    request: Request,
    code: str = Query(...),
    db: Session = Depends(get_db),
):
    """Handle OAuth callback — exchange code for tokens and save connection."""
    from app.services.google_ads_service import GoogleAdsService

    try:
        tokens = GoogleAdsService.exchange_code(code)
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            raise HTTPException(status_code=400, detail="No refresh token received. Try revoking access and reconnecting.")

        # Get the customer IDs accessible with this token
        service = GoogleAdsService(refresh_token=refresh_token)
        customers = service.list_accessible_customers()

        # Save or update connection
        existing = db.query(GoogleAdsConnection).first()
        if existing:
            existing.refresh_token = refresh_token
            existing.customer_ids = customers
            existing.is_active = True
        else:
            conn = GoogleAdsConnection(
                refresh_token=refresh_token,
                customer_ids=customers,
                is_active=True,
            )
            db.add(conn)
        db.commit()

        # Redirect to frontend
        frontend_url = settings.FRONTEND_URL or "http://localhost:5173"
        return RedirectResponse(url=f"{frontend_url}/google-ads?connected=true")

    except Exception as e:
        logger.exception("Google Ads OAuth callback failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/connection")
def get_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get current Google Ads connection status."""
    conn = db.query(GoogleAdsConnection).filter(GoogleAdsConnection.is_active == True).first()
    if not conn:
        return {"connected": False}
    return {
        "connected": True,
        "customer_ids": conn.customer_ids or [],
        "selected_customer_id": conn.selected_customer_id,
    }


@router.post("/select-customer")
def select_customer(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Select which Google Ads customer ID to use."""
    customer_id = data.get("customer_id")
    conn = db.query(GoogleAdsConnection).filter(GoogleAdsConnection.is_active == True).first()
    if not conn:
        raise HTTPException(status_code=404, detail="No Google Ads connection found")
    conn.selected_customer_id = customer_id
    db.commit()
    return {"selected_customer_id": customer_id}


# ── Campaigns ────────────────────────────────────────────────────────

def _get_service(db: Session):
    conn = db.query(GoogleAdsConnection).filter(GoogleAdsConnection.is_active == True).first()
    if not conn or not conn.refresh_token:
        raise HTTPException(status_code=400, detail="Google Ads not connected. Go to Settings to connect.")
    if not conn.selected_customer_id:
        raise HTTPException(status_code=400, detail="No Google Ads customer ID selected.")
    from app.services.google_ads_service import GoogleAdsService
    return GoogleAdsService(refresh_token=conn.refresh_token, customer_id=conn.selected_customer_id)


@router.get("/campaigns")
def list_campaigns(
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all campaigns with performance metrics."""
    service = _get_service(db)
    return service.get_campaigns(since=since, until=until)


@router.post("/campaigns")
def create_campaign(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Create a new Google Ads campaign."""
    service = _get_service(db)
    return service.create_campaign(data)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Update a campaign (status, budget, name, bid strategy)."""
    service = _get_service(db)
    return service.update_campaign(campaign_id, data)


# ── Ad Groups ────────────────────────────────────────────────────────

@router.get("/campaigns/{campaign_id}/ad-groups")
def list_ad_groups(
    campaign_id: str,
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List ad groups for a campaign with metrics."""
    service = _get_service(db)
    return service.get_ad_groups(campaign_id, since=since, until=until)


@router.post("/campaigns/{campaign_id}/ad-groups")
def create_ad_group(
    campaign_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Create a new ad group."""
    service = _get_service(db)
    return service.create_ad_group(campaign_id, data)


@router.patch("/ad-groups/{ad_group_id}")
def update_ad_group(
    ad_group_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Update an ad group."""
    service = _get_service(db)
    return service.update_ad_group(ad_group_id, data)


# ── Ads ──────────────────────────────────────────────────────────────

@router.get("/ad-groups/{ad_group_id}/ads")
def list_ads(
    ad_group_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List ads in an ad group."""
    service = _get_service(db)
    return service.get_ads(ad_group_id)


@router.post("/ad-groups/{ad_group_id}/ads")
def create_ad(
    ad_group_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Create a responsive search ad."""
    service = _get_service(db)
    return service.create_responsive_search_ad(ad_group_id, data)


# ── Keywords ─────────────────────────────────────────────────────────

@router.get("/ad-groups/{ad_group_id}/keywords")
def list_keywords(
    ad_group_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List keywords in an ad group."""
    service = _get_service(db)
    return service.get_keywords(ad_group_id)


@router.post("/ad-groups/{ad_group_id}/keywords")
def add_keywords(
    ad_group_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Add keywords to an ad group. Accepts list of {text, match_type}."""
    service = _get_service(db)
    return service.add_keywords(ad_group_id, data.get("keywords", []))


@router.delete("/keywords/{criterion_id}")
def remove_keyword(
    criterion_id: str,
    ad_group_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Remove a keyword."""
    service = _get_service(db)
    return service.remove_keyword(ad_group_id, criterion_id)


# ── Keyword Planning ─────────────────────────────────────────────────

@router.post("/keyword-ideas")
def get_keyword_ideas(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get keyword suggestions from Google's Keyword Planner."""
    service = _get_service(db)
    return service.get_keyword_ideas(
        keywords=data.get("seed_keywords", []),
        url=data.get("url"),
        language_id=data.get("language_id", "1000"),  # English
        location_ids=data.get("location_ids", ["2840"]),  # US
    )


# ── Reporting ────────────────────────────────────────────────────────

@router.get("/reporting")
def get_reporting(
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
    level: str = Query("campaign"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get performance reporting at campaign, ad_group, or ad level."""
    service = _get_service(db)
    return service.get_reporting(since=since, until=until, level=level)
