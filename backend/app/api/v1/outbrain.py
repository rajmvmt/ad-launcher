"""Outbrain Amplify campaign management + reporting API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import NativeAdConnection, User
from app.core.deps import get_current_active_user
from app.services.outbrain_service import OutbrainService

router = APIRouter()


def get_outbrain_service(
    connection_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if connection_id:
        conn = db.query(NativeAdConnection).filter(
            NativeAdConnection.id == connection_id,
            NativeAdConnection.platform == "outbrain",
            NativeAdConnection.is_active == True,
        ).first()
    else:
        conn = db.query(NativeAdConnection).filter(
            NativeAdConnection.platform == "outbrain",
            NativeAdConnection.is_default == True,
            NativeAdConnection.is_active == True,
        ).first()

    if not conn:
        raise HTTPException(status_code=404, detail="No Outbrain connection found")
    return OutbrainService(conn)


# ── Marketers ──────────────────────────────────────────────────────

@router.get("/marketers")
def list_marketers(
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_marketers()


# ── Campaigns ──────────────────────────────────────────────────────

@router.get("/campaigns")
def list_campaigns(
    marketer_id: Optional[str] = None,
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_campaigns(marketer_id)


@router.get("/campaigns/{campaign_id}")
def get_campaign(
    campaign_id: str,
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_campaign(campaign_id)


@router.post("/campaigns")
def create_campaign(
    data: Dict[str, Any],
    marketer_id: Optional[str] = None,
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.create_campaign(data, marketer_id)


@router.put("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: str,
    data: Dict[str, Any],
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.update_campaign(campaign_id, data)


@router.patch("/campaigns/{campaign_id}/status")
def update_campaign_status(
    campaign_id: str,
    data: Dict[str, Any],
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    enabled = data.get("enabled")
    if enabled is None:
        status = data.get("status", "").upper()
        enabled = status in ("ACTIVE", "ON", "RUNNING", "TRUE")
    return service.update_campaign_status(campaign_id, enabled)


# ── PromotedLinks (Ads) ───────────────────────────────────────────

@router.get("/campaigns/{campaign_id}/promoted-links")
def list_promoted_links(
    campaign_id: str,
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_promoted_links(campaign_id)


@router.post("/campaigns/{campaign_id}/promoted-links")
def create_promoted_link(
    campaign_id: str,
    data: Dict[str, Any],
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.create_promoted_link(campaign_id, data)


@router.get("/promoted-links/{link_id}")
def get_promoted_link(
    link_id: str,
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_promoted_link(link_id)


@router.put("/promoted-links/{link_id}")
def update_promoted_link(
    link_id: str,
    data: Dict[str, Any],
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.update_promoted_link(link_id, data)


@router.patch("/promoted-links/{link_id}/status")
def update_promoted_link_status(
    link_id: str,
    data: Dict[str, Any],
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    enabled = data.get("enabled")
    if enabled is None:
        status = data.get("status", "").upper()
        enabled = status in ("ACTIVE", "ON", "TRUE")
    return service.update_promoted_link_status(link_id, enabled)


# ── Reporting ──────────────────────────────────────────────────────

@router.get("/reports/campaigns")
def campaign_report(
    since: str = Query(..., description="Start date YYYY-MM-DD"),
    until: str = Query(..., description="End date YYYY-MM-DD"),
    marketer_id: Optional[str] = None,
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_campaign_report(since, until, marketer_id)


@router.get("/reports/campaigns/periodic")
def campaign_periodic_report(
    since: str = Query(..., description="Start date YYYY-MM-DD"),
    until: str = Query(..., description="End date YYYY-MM-DD"),
    breakdown: str = Query("daily"),
    marketer_id: Optional[str] = None,
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_campaign_periodic_report(since, until, marketer_id, breakdown)


@router.get("/reports/campaigns/{campaign_id}/promoted-links")
def promoted_links_report(
    campaign_id: str,
    since: str = Query(..., description="Start date YYYY-MM-DD"),
    until: str = Query(..., description="End date YYYY-MM-DD"),
    marketer_id: Optional[str] = None,
    service: OutbrainService = Depends(get_outbrain_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_promoted_links_report(campaign_id, since, until, marketer_id)
