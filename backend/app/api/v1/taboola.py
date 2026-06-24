"""
Taboola campaign management + reporting API endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import NativeAdConnection, User
from app.core.deps import get_current_active_user
from app.services.taboola_service import TaboolaService

router = APIRouter()


def get_taboola_service(
    connection_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if connection_id:
        conn = db.query(NativeAdConnection).filter(
            NativeAdConnection.id == connection_id,
            NativeAdConnection.platform == "taboola",
            NativeAdConnection.is_active == True,
        ).first()
    else:
        conn = db.query(NativeAdConnection).filter(
            NativeAdConnection.platform == "taboola",
            NativeAdConnection.is_default == True,
            NativeAdConnection.is_active == True,
        ).first()

    if not conn:
        raise HTTPException(status_code=404, detail="No Taboola connection found")

    service = TaboolaService(conn)
    return service


# ── Campaigns ──────────────────────────────────────────────────────

@router.get("/campaigns")
def list_campaigns(
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_campaigns(account_id)


@router.get("/campaigns/{campaign_id}")
def get_campaign(
    campaign_id: str,
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_campaign(campaign_id, account_id)


@router.post("/campaigns")
def create_campaign(
    data: Dict[str, Any],
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.create_campaign(data, account_id)


@router.put("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: str,
    data: Dict[str, Any],
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.update_campaign(campaign_id, data, account_id)


@router.patch("/campaigns/{campaign_id}/status")
def update_campaign_status(
    campaign_id: str,
    data: Dict[str, Any],
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    status = data.get("status")
    if not status:
        raise HTTPException(status_code=400, detail="status is required")
    return service.update_campaign(campaign_id, {"is_active": status.upper() == "RUNNING"}, account_id)


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: str,
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.delete_campaign(campaign_id, account_id)


# ── Campaign Items (Ads) ──────────────────────────────────────────

@router.get("/campaigns/{campaign_id}/items")
def list_campaign_items(
    campaign_id: str,
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_campaign_items(campaign_id, account_id)


@router.post("/campaigns/{campaign_id}/items")
def create_campaign_item(
    campaign_id: str,
    data: Dict[str, Any],
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.create_campaign_item(campaign_id, data, account_id)


@router.put("/campaigns/{campaign_id}/items/{item_id}")
def update_campaign_item(
    campaign_id: str,
    item_id: str,
    data: Dict[str, Any],
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.update_campaign_item(campaign_id, item_id, data, account_id)


@router.delete("/campaigns/{campaign_id}/items/{item_id}")
def delete_campaign_item(
    campaign_id: str,
    item_id: str,
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.delete_campaign_item(campaign_id, item_id, account_id)


# ── Reporting ─────────────────────────────────────────────────────

@router.get("/reports/campaigns")
def campaign_report(
    since: str = Query(..., description="Start date YYYY-MM-DD"),
    until: str = Query(..., description="End date YYYY-MM-DD"),
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_campaign_summary_report(since, until, account_id)


@router.get("/reports/campaigns/{campaign_id}/items")
def campaign_items_report(
    campaign_id: str,
    since: str = Query(..., description="Start date YYYY-MM-DD"),
    until: str = Query(..., description="End date YYYY-MM-DD"),
    account_id: Optional[str] = None,
    service: TaboolaService = Depends(get_taboola_service),
    current_user: User = Depends(get_current_active_user),
):
    return service.get_top_campaign_content_report(campaign_id, since, until, account_id)
