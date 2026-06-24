"""NewsBreak campaign management + reporting API endpoints."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import NativeAdConnection, User
from app.core.deps import get_current_active_user
from app.services.newsbreak_service import NewsBreakService

logger = logging.getLogger(__name__)

router = APIRouter()


def get_newsbreak_service(
    connection_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if connection_id:
        conn = db.query(NativeAdConnection).filter(
            NativeAdConnection.id == connection_id,
            NativeAdConnection.platform == "newsbreak",
            NativeAdConnection.is_active == True,
        ).first()
    else:
        conn = db.query(NativeAdConnection).filter(
            NativeAdConnection.platform == "newsbreak",
            NativeAdConnection.is_default == True,
            NativeAdConnection.is_active == True,
        ).first()

    if not conn:
        raise HTTPException(status_code=404, detail="No NewsBreak connection found")
    return NewsBreakService(conn)


# ── Campaigns ──────────────────────────────────────────────────────

@router.get("/campaigns")
def list_campaigns(
    ad_account_id: Optional[str] = None,
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    try:
        return service.get_campaigns(ad_account_id)
    except Exception as e:
        logger.exception("NewsBreak API error")
        raise HTTPException(status_code=502, detail="NewsBreak API error")


@router.post("/campaigns")
def create_campaign(
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.create_campaign(data)


@router.put("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: str,
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.update_campaign(campaign_id, data)


@router.patch("/campaigns/{campaign_id}/status")
def update_campaign_status(
    campaign_id: str,
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    status = data.get("status", "").upper()
    if status not in ("ON", "OFF"):
        raise HTTPException(status_code=400, detail="status must be ON or OFF")
    return service.update_campaign_status(campaign_id, status)


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: str,
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.delete_campaign(campaign_id)


# ── Ad Sets ────────────────────────────────────────────────────────

@router.get("/adsets")
def list_ad_sets(
    campaign_id: Optional[str] = None,
    ad_account_id: Optional[str] = None,
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_ad_sets(campaign_id, ad_account_id)


@router.post("/adsets")
def create_ad_set(
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.create_ad_set(data)


@router.put("/adsets/{adset_id}")
def update_ad_set(
    adset_id: str,
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.update_ad_set(adset_id, data)


@router.patch("/adsets/{adset_id}/status")
def update_ad_set_status(
    adset_id: str,
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    status = data.get("status", "").upper()
    if status not in ("ON", "OFF"):
        raise HTTPException(status_code=400, detail="status must be ON or OFF")
    return service.update_ad_set_status(adset_id, status)


@router.delete("/adsets/{adset_id}")
def delete_ad_set(
    adset_id: str,
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.delete_ad_set(adset_id)


# ── Ads ────────────────────────────────────────────────────────────

@router.get("/ads")
def list_ads(
    ad_set_id: Optional[str] = None,
    ad_account_id: Optional[str] = None,
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_ads(ad_set_id, ad_account_id)


@router.post("/ads")
def create_ad(
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.create_ad(data)


@router.put("/ads/{ad_id}")
def update_ad(
    ad_id: str,
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.update_ad(ad_id, data)


@router.patch("/ads/{ad_id}/status")
def update_ad_status(
    ad_id: str,
    data: Dict[str, Any],
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    status = data.get("status", "").upper()
    if status not in ("ON", "OFF"):
        raise HTTPException(status_code=400, detail="status must be ON or OFF")
    return service.update_ad_status(ad_id, status)


@router.delete("/ads/{ad_id}")
def delete_ad(
    ad_id: str,
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.delete_ad(ad_id)


# ── Reporting ──────────────────────────────────────────────────────

@router.get("/reports")
def get_report(
    since: str = Query(..., description="Start date YYYY-MM-DD"),
    until: str = Query(..., description="End date YYYY-MM-DD"),
    dimensions: str = Query("CAMPAIGN", description="Comma-separated: DATE,CAMPAIGN,AD_SET,AD"),
    service: NewsBreakService = Depends(get_newsbreak_service),
    current_user: User = Depends(get_current_active_user),
):
    dims = [d.strip() for d in dimensions.split(",")]
    try:
        return service.get_report(since, until, dimensions=dims)
    except Exception as e:
        logger.exception("NewsBreak report error")
        raise HTTPException(status_code=502, detail=f"NewsBreak report error: {str(e)}")
