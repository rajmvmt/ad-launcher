"""
Conversions API — Everflow postback receiver + conversion reporting.

Postback URL for Everflow:
  GET /api/v1/conversions/postback?click_id={sub2}&campaign_id={sub4}&adset_id={sub5}&ad_id={sub6}&revenue={payout_amount}&transaction_id={transaction_id}&offer_id={offer_id}
"""
import logging
import re
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from typing import Optional
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from app.database import get_db
from app.models import Conversion, User
from app.core.deps import get_current_active_user
from app.core.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_float(val: Optional[str]) -> float:
    """Safely parse a float from query param — handles empty strings, None, garbage."""
    if not val:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def _validate_date(val: Optional[str]) -> Optional[str]:
    """Validate and return ISO date string (YYYY-MM-DD), or None if invalid."""
    if not val:
        return None
    if not _DATE_RE.match(val):
        return None
    try:
        datetime.strptime(val, "%Y-%m-%d")
        return val
    except ValueError:
        return None


_EST = ZoneInfo("America/New_York")


def _date_to_utc_start(date_str: str) -> datetime:
    """Convert 'YYYY-MM-DD' to start-of-day in EST, returned as UTC."""
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=_EST)
    return dt.astimezone(ZoneInfo("UTC"))


def _date_to_utc_end(date_str: str) -> datetime:
    """Convert 'YYYY-MM-DD' to end-of-day (23:59:59) in EST, returned as UTC."""
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(
        hour=23, minute=59, second=59, tzinfo=_EST
    )
    return dt.astimezone(ZoneInfo("UTC"))


@router.get("/postback")
@limiter.limit("60/minute")
def receive_postback(
    request: Request,
    click_id: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    adset_id: Optional[str] = Query(None),
    ad_id: Optional[str] = Query(None),
    payout: Optional[str] = Query(None),
    revenue: Optional[str] = Query(None),
    transaction_id: Optional[str] = Query(None),
    offer_id: Optional[str] = Query(None),
    status: Optional[str] = Query("approved"),
    db: Session = Depends(get_db),
):
    """
    Public endpoint (no auth) — receives S2S postbacks from Everflow.
    Everflow fires this URL on each conversion.
    """
    # Dedup: skip if transaction_id already exists
    if transaction_id:
        existing = db.query(Conversion).filter(
            Conversion.transaction_id == transaction_id
        ).first()
        if existing:
            return {"status": "duplicate", "transaction_id": transaction_id}

    ip = request.client.host if request.client else None

    conversion = Conversion(
        click_id=click_id,
        fb_campaign_id=campaign_id,
        fb_adset_id=adset_id,
        fb_ad_id=ad_id or None,
        payout=_parse_float(payout),
        revenue=_parse_float(revenue),
        status=status or "approved",
        source="everflow",
        offer_id=offer_id,
        transaction_id=transaction_id,
        ip_address=ip,
    )
    db.add(conversion)
    db.commit()

    return {"status": "ok", "id": conversion.id}


@router.get("/summary")
def get_conversion_summary(
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
    group_by: str = Query("campaign"),  # campaign, adset, ad
    campaign_ids: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Aggregated conversion data grouped by FB campaign/adset/ad.
    Returns: { items: [{ fb_id, conversions, total_payout, total_revenue }], totals: {...} }
    """
    since = _validate_date(since)
    until = _validate_date(until)

    # Parse campaign_ids filter (comma-separated)
    cid_list = [c.strip() for c in campaign_ids.split(",") if c.strip()] if campaign_ids else []

    # Pick group column
    if group_by == "adset":
        group_col = Conversion.fb_adset_id
    elif group_by == "ad":
        group_col = Conversion.fb_ad_id
    else:
        group_col = Conversion.fb_campaign_id

    filters = [Conversion.status == "approved"]
    if since:
        filters.append(Conversion.created_at >= _date_to_utc_start(since))
    if until:
        filters.append(Conversion.created_at <= _date_to_utc_end(until))
    if cid_list:
        filters.append(Conversion.fb_campaign_id.in_(cid_list))

    results = db.query(
        group_col.label("fb_id"),
        sql_func.count(Conversion.id).label("conversions"),
        sql_func.sum(Conversion.payout).label("total_payout"),
        sql_func.sum(Conversion.revenue).label("total_revenue"),
    ).filter(
        *filters
    ).group_by(group_col).all()

    items = []
    total_conversions = 0
    total_payout = 0
    total_revenue = 0

    for row in results:
        conv = row.conversions or 0
        payout = float(row.total_payout or 0)
        rev = float(row.total_revenue or 0)
        items.append({
            "fb_id": row.fb_id,
            "conversions": conv,
            "total_payout": round(payout, 2),
            "total_revenue": round(rev, 2),
        })
        total_conversions += conv
        total_payout += payout
        total_revenue += rev

    return {
        "items": items,
        "totals": {
            "conversions": total_conversions,
            "total_payout": round(total_payout, 2),
            "total_revenue": round(total_revenue, 2),
        }
    }


@router.get("/daily")
def get_daily_conversions(
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
    campaign_ids: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Daily conversion totals for charting alongside daily spend.
    Returns: [{ date, conversions, payout, revenue }]
    """
    since = _validate_date(since)
    until = _validate_date(until)
    if not since:
        since = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d")
    if not until:
        until = datetime.utcnow().strftime("%Y-%m-%d")

    # Parse campaign_ids filter (comma-separated)
    cid_list = [c.strip() for c in campaign_ids.split(",") if c.strip()] if campaign_ids else []

    filters = [
        Conversion.status == "approved",
        Conversion.created_at >= _date_to_utc_start(since),
        Conversion.created_at <= _date_to_utc_end(until),
    ]
    if cid_list:
        filters.append(Conversion.fb_campaign_id.in_(cid_list))

    # Group by date in EST so daily buckets match user's timezone
    est_date = sql_func.date(sql_func.timezone('America/New_York', Conversion.created_at))

    results = db.query(
        est_date.label("date"),
        sql_func.count(Conversion.id).label("conversions"),
        sql_func.sum(Conversion.payout).label("payout"),
        sql_func.sum(Conversion.revenue).label("revenue"),
    ).filter(
        *filters,
    ).group_by(
        est_date
    ).order_by(
        est_date
    ).all()

    return [
        {
            "date": str(row.date),
            "conversions": row.conversions or 0,
            "payout": round(float(row.payout or 0), 2),
            "revenue": round(float(row.revenue or 0), 2),
        }
        for row in results
    ]


@router.get("/debug-fields")
def debug_conversion_fields(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Diagnostic: check how many conversions have campaign/adset/ad IDs populated."""
    total = db.query(sql_func.count(Conversion.id)).scalar() or 0
    has_campaign = db.query(sql_func.count(Conversion.id)).filter(
        Conversion.fb_campaign_id.isnot(None),
        Conversion.fb_campaign_id != "",
    ).scalar() or 0
    has_adset = db.query(sql_func.count(Conversion.id)).filter(
        Conversion.fb_adset_id.isnot(None),
        Conversion.fb_adset_id != "",
    ).scalar() or 0
    has_ad = db.query(sql_func.count(Conversion.id)).filter(
        Conversion.fb_ad_id.isnot(None),
        Conversion.fb_ad_id != "",
    ).scalar() or 0
    return {
        "total_conversions": total,
        "has_fb_campaign_id": has_campaign,
        "has_fb_adset_id": has_adset,
        "has_fb_ad_id": has_ad,
        "missing_campaign_id": total - has_campaign,
        "missing_adset_id": total - has_adset,
        "missing_ad_id": total - has_ad,
    }


@router.get("/recent")
def get_recent_conversions(
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Recent conversions log for debugging and verification."""
    total = db.query(sql_func.count(Conversion.id)).scalar() or 0
    conversions = db.query(Conversion).order_by(
        Conversion.created_at.desc()
    ).offset(offset).limit(limit).all()

    return {
        "items": [
            {
                "id": c.id,
                "click_id": c.click_id,
                "fb_campaign_id": c.fb_campaign_id,
                "fb_adset_id": c.fb_adset_id,
                "fb_ad_id": c.fb_ad_id,
                "payout": c.payout,
                "revenue": c.revenue,
                "status": c.status,
                "source": c.source,
                "offer_id": c.offer_id,
                "transaction_id": c.transaction_id,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in conversions
        ],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


class ManualConversionRequest(BaseModel):
    fb_campaign_id: Optional[str] = None
    fb_adset_id: Optional[str] = None
    fb_ad_id: Optional[str] = None
    payout: float = 0
    revenue: float = 0
    offer_id: Optional[str] = None
    transaction_id: Optional[str] = None
    status: str = "approved"


@router.post("/manual")
def create_manual_conversion(
    body: ManualConversionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Manually create a conversion record (e.g. for missed postbacks)."""
    # Dedup on transaction_id if provided
    if body.transaction_id:
        existing = db.query(Conversion).filter(
            Conversion.transaction_id == body.transaction_id
        ).first()
        if existing:
            return {"status": "duplicate", "transaction_id": body.transaction_id}

    conversion = Conversion(
        fb_campaign_id=body.fb_campaign_id or None,
        fb_adset_id=body.fb_adset_id or None,
        fb_ad_id=body.fb_ad_id or None,
        payout=body.payout,
        revenue=body.revenue,
        status=body.status,
        source="manual",
        offer_id=body.offer_id or None,
        transaction_id=body.transaction_id or None,
    )
    db.add(conversion)
    db.commit()

    return {"status": "ok", "id": conversion.id}
