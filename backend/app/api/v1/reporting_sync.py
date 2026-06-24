"""DB-backed reporting endpoints — serves synced Facebook data from PostgreSQL."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from sqlalchemy import func as sa_func
from app.models import (
    FBSyncStatus, FBSyncCampaign, FBSyncAdSet, FBSyncAd,
    FBSyncDailyStats, FacebookConnection, User
)
from app.api.v1.facebook import get_current_active_user

router = APIRouter()


def _normalize_account_id(ad_account_id: str) -> str:
    """Normalize to plain ID (no act_ prefix) to match how sync stores it."""
    return ad_account_id.replace('act_', '')


def _is_today(date_str: Optional[str]) -> bool:
    """Check if a date string matches today's date."""
    if not date_str:
        return False
    return date_str == datetime.now().strftime('%Y-%m-%d')


def _campaign_to_response(c, use_today=False):
    """Convert FBSyncCampaign row to API response matching live endpoint shape."""
    if use_today and c.today_date and _is_today(c.today_date):
        insights = {
            'campaign_id': c.fb_campaign_id,
            'campaign_name': c.name,
            'impressions': c.today_impressions or '0',
            'clicks': c.today_clicks or '0',
            'spend': c.today_spend or '0.00',
            'ctr': c.today_ctr or '0',
            'cpc': c.today_cpc or '0',
            'cpm': c.today_cpm or '0',
            'reach': '0',
            'results': c.today_results or 0,
            'purchase_revenue': c.today_purchase_revenue or 0.0,
            'actions': c.today_actions,
            'cost_per_action_type': None,
            'action_values': c.today_action_values,
        }
    else:
        insights = {
            'campaign_id': c.fb_campaign_id,
            'campaign_name': c.name,
            'impressions': c.impressions or '0',
            'clicks': c.clicks or '0',
            'spend': c.spend or '0.00',
            'ctr': c.ctr or '0',
            'cpc': c.cpc or '0',
            'cpm': c.cpm or '0',
            'reach': c.reach or '0',
            'results': c.results or 0,
            'purchase_revenue': c.purchase_revenue or 0.0,
            'actions': c.actions,
            'cost_per_action_type': c.cost_per_action_type,
            'action_values': c.action_values,
        }
    return {
        'id': c.fb_campaign_id,
        'name': c.name,
        'status': c.status,
        'effective_status': c.effective_status,
        'objective': c.objective,
        'daily_budget': c.daily_budget,
        'lifetime_budget': c.lifetime_budget,
        'bid_strategy': c.bid_strategy,
        'buying_type': c.buying_type,
        'special_ad_categories': c.special_ad_categories or [],
        'start_time': c.start_time,
        'stop_time': c.stop_time,
        'insights': insights,
    }


def _adset_to_response(a, use_today=False):
    """Convert FBSyncAdSet row to API response."""
    if use_today and a.today_date and _is_today(a.today_date):
        insights = {
            'adset_id': a.fb_adset_id,
            'adset_name': a.name,
            'impressions': a.today_impressions or '0',
            'clicks': a.today_clicks or '0',
            'spend': a.today_spend or '0.00',
            'ctr': a.today_ctr or '0',
            'cpc': a.today_cpc or '0',
            'cpm': a.today_cpm or '0',
            'reach': '0',
            'results': a.today_results or 0,
            'purchase_revenue': a.today_purchase_revenue or 0.0,
            'actions': a.today_actions,
            'cost_per_action_type': None,
            'action_values': a.today_action_values,
        }
    else:
        insights = {
            'adset_id': a.fb_adset_id,
            'adset_name': a.name,
            'impressions': a.impressions or '0',
            'clicks': a.clicks or '0',
            'spend': a.spend or '0.00',
            'ctr': a.ctr or '0',
            'cpc': a.cpc or '0',
            'cpm': a.cpm or '0',
            'reach': a.reach or '0',
            'results': a.results or 0,
            'purchase_revenue': a.purchase_revenue or 0.0,
            'actions': a.actions,
            'cost_per_action_type': a.cost_per_action_type,
            'action_values': a.action_values,
        }
    return {
        'id': a.fb_adset_id,
        'name': a.name,
        'status': a.status,
        'effective_status': a.effective_status,
        'daily_budget': a.daily_budget,
        'lifetime_budget': a.lifetime_budget,
        'targeting': a.targeting,
        'optimization_goal': a.optimization_goal,
        'bid_amount': a.bid_amount,
        'bid_strategy': a.bid_strategy,
        'billing_event': a.billing_event,
        'start_time': a.start_time,
        'end_time': a.end_time,
        'insights': insights,
    }


def _ad_to_response(a, use_today=False):
    """Convert FBSyncAd row to API response."""
    if use_today and a.today_date and _is_today(a.today_date):
        insights = {
            'ad_id': a.fb_ad_id,
            'ad_name': a.name,
            'impressions': a.today_impressions or '0',
            'clicks': a.today_clicks or '0',
            'spend': a.today_spend or '0.00',
            'ctr': a.today_ctr or '0',
            'cpc': a.today_cpc or '0',
            'cpm': a.today_cpm or '0',
            'reach': '0',
            'results': a.today_results or 0,
            'purchase_revenue': a.today_purchase_revenue or 0.0,
            'actions': a.today_actions,
            'cost_per_action_type': None,
            'action_values': a.today_action_values,
        }
    else:
        insights = {
            'ad_id': a.fb_ad_id,
            'ad_name': a.name,
            'impressions': a.impressions or '0',
            'clicks': a.clicks or '0',
            'spend': a.spend or '0.00',
            'ctr': a.ctr or '0',
            'cpc': a.cpc or '0',
            'cpm': a.cpm or '0',
            'reach': a.reach or '0',
            'results': a.results or 0,
            'purchase_revenue': a.purchase_revenue or 0.0,
            'actions': a.actions,
            'cost_per_action_type': a.cost_per_action_type,
            'action_values': a.action_values,
        }
    return {
        'id': a.fb_ad_id,
        'name': a.name,
        'status': a.status,
        'effective_status': a.effective_status,
        'creative': {'id': a.creative_id} if a.creative_id else None,
        'adset_id': a.fb_adset_id,
        'campaign_id': a.fb_campaign_id,
        'insights': insights,
        'creative_data': a.creative_data or {},
    }


@router.get("/campaigns")
def get_synced_campaigns(
    ad_account_id: str,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get campaigns from local sync cache. Pass date=YYYY-MM-DD to get today's stats."""
    use_today = date is not None and date == datetime.now().strftime('%Y-%m-%d')
    rows = db.query(FBSyncCampaign).filter(
        FBSyncCampaign.ad_account_id== _normalize_account_id(ad_account_id)
    ).all()
    return [_campaign_to_response(c, use_today=use_today) for c in rows]


@router.get("/adsets")
def get_synced_adsets(
    ad_account_id: str,
    campaign_id: str,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get ad sets for a campaign from local sync cache."""
    use_today = date is not None and date == datetime.now().strftime('%Y-%m-%d')
    rows = db.query(FBSyncAdSet).filter(
        FBSyncAdSet.ad_account_id== _normalize_account_id(ad_account_id),
        FBSyncAdSet.fb_campaign_id == campaign_id,
    ).all()
    return [_adset_to_response(a, use_today=use_today) for a in rows]


@router.get("/ads")
def get_synced_ads(
    ad_account_id: str,
    adset_id: str,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get ads for an ad set from local sync cache."""
    use_today = date is not None and date == datetime.now().strftime('%Y-%m-%d')
    rows = db.query(FBSyncAd).filter(
        FBSyncAd.ad_account_id== _normalize_account_id(ad_account_id),
        FBSyncAd.fb_adset_id == adset_id,
    ).all()
    return [_ad_to_response(a, use_today=use_today) for a in rows]


@router.get("/all-ads")
def get_synced_all_ads(
    ad_account_id: str,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get ALL ads for an account from local sync cache."""
    use_today = date is not None and date == datetime.now().strftime('%Y-%m-%d')
    rows = db.query(FBSyncAd).filter(
        FBSyncAd.ad_account_id== _normalize_account_id(ad_account_id)
    ).all()
    return [_ad_to_response(a, use_today=use_today) for a in rows]


@router.get("/all-adsets")
def get_synced_all_adsets(
    ad_account_id: str,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get ALL adsets for an account from local sync cache."""
    use_today = date is not None and date == datetime.now().strftime('%Y-%m-%d')
    rows = db.query(FBSyncAdSet).filter(
        FBSyncAdSet.ad_account_id== _normalize_account_id(ad_account_id)
    ).all()
    return [_adset_to_response(a, use_today=use_today) for a in rows]


@router.get("/sync-status")
def get_sync_status(
    ad_account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get the last sync status for an ad account."""
    status = db.query(FBSyncStatus).filter(
        FBSyncStatus.ad_account_id== _normalize_account_id(ad_account_id)
    ).first()
    if not status:
        return {"synced": False, "message": "No sync data yet. Run sync first."}
    return {
        "synced": True,
        "last_synced_at": status.last_synced_at.isoformat() if status.last_synced_at else None,
        "last_sync_duration_ms": status.last_sync_duration_ms,
        "last_sync_error": status.last_sync_error,
        "campaigns_count": status.campaigns_count,
        "adsets_count": status.adsets_count,
        "ads_count": status.ads_count,
    }


@router.post("/sync-now")
def trigger_sync_now(
    ad_account_id: str,
    background_tasks: BackgroundTasks,
    connection_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Manually trigger a sync for one ad account."""
    # Find connection
    if connection_id:
        conn = db.query(FacebookConnection).filter(FacebookConnection.id == connection_id).first()
    else:
        conn = db.query(FacebookConnection).filter(FacebookConnection.is_active == True).first()

    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection found")

    def _run_sync():
        from app.database import SessionLocal
        from app.services.facebook_service import FacebookService
        sync_db = SessionLocal()
        try:
            service = FacebookService(connection=conn)
            if not service.api:
                service.initialize()
            from run_fb_sync import sync_account
            sync_account(service, ad_account_id, sync_db, conn.id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Manual sync failed: {e}", exc_info=True)
        finally:
            sync_db.close()

    background_tasks.add_task(_run_sync)
    return {"message": "Sync started in background", "ad_account_id": ad_account_id}


# ─── Daily Stats Endpoints ──────────────────────────────────────────────────


def _aggregate_daily_rows(rows):
    """Sum up daily stats rows into a single aggregate."""
    total_spend = sum(float(r.spend or 0) for r in rows)
    total_impressions = sum(int(r.impressions or 0) for r in rows)
    total_clicks = sum(int(r.clicks or 0) for r in rows)
    total_reach = sum(int(r.reach or 0) for r in rows)
    total_results = sum(r.results or 0 for r in rows)
    total_revenue = sum(r.purchase_revenue or 0 for r in rows)
    return {
        'impressions': str(total_impressions),
        'clicks': str(total_clicks),
        'spend': f'{total_spend:.2f}',
        'ctr': f'{(total_clicks / total_impressions * 100):.2f}' if total_impressions else '0',
        'cpc': f'{(total_spend / total_clicks):.2f}' if total_clicks else '0',
        'cpm': f'{(total_spend / total_impressions * 1000):.2f}' if total_impressions else '0',
        'reach': str(total_reach),
        'results': total_results,
        'purchase_revenue': total_revenue,
        'actions': None,
        'cost_per_action_type': None,
        'action_values': None,
    }


@router.get("/daily/campaigns")
def get_daily_campaigns(
    ad_account_id: str,
    since: str,
    until: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get campaign stats aggregated over a date range from daily sync cache."""
    acct = _normalize_account_id(ad_account_id)

    # Get daily rows for campaigns in this date range
    rows = db.query(FBSyncDailyStats).filter(
        FBSyncDailyStats.ad_account_id == acct,
        FBSyncDailyStats.object_type == 'campaign',
        FBSyncDailyStats.date >= since,
        FBSyncDailyStats.date <= until,
    ).all()

    # Group by campaign_id and aggregate
    from collections import defaultdict
    by_campaign = defaultdict(list)
    for r in rows:
        by_campaign[r.object_id].append(r)

    # Get campaign metadata from sync table
    campaigns = {c.fb_campaign_id: c for c in db.query(FBSyncCampaign).filter(
        FBSyncCampaign.ad_account_id == acct
    ).all()}

    zero_insights = _aggregate_daily_rows([])

    result = []
    seen_ids = set()
    # Campaigns with activity in this date range
    for cid, day_rows in by_campaign.items():
        agg = _aggregate_daily_rows(day_rows)
        camp = campaigns.get(cid)
        seen_ids.add(cid)
        result.append({
            'id': cid,
            'name': camp.name if camp else (day_rows[0].object_name or cid),
            'status': camp.status if camp else None,
            'effective_status': camp.effective_status if camp else None,
            'objective': camp.objective if camp else None,
            'daily_budget': camp.daily_budget if camp else None,
            'lifetime_budget': camp.lifetime_budget if camp else None,
            'bid_strategy': camp.bid_strategy if camp else None,
            'buying_type': camp.buying_type if camp else None,
            'special_ad_categories': camp.special_ad_categories if camp else [],
            'start_time': camp.start_time if camp else None,
            'stop_time': camp.stop_time if camp else None,
            'insights': {**agg, 'campaign_id': cid, 'campaign_name': camp.name if camp else ''},
        })
    # Campaigns with zero activity — still show them
    for cid, camp in campaigns.items():
        if cid not in seen_ids:
            result.append({
                'id': cid,
                'name': camp.name,
                'status': camp.status,
                'effective_status': camp.effective_status,
                'objective': camp.objective,
                'daily_budget': camp.daily_budget,
                'lifetime_budget': camp.lifetime_budget,
                'bid_strategy': camp.bid_strategy,
                'buying_type': camp.buying_type,
                'special_ad_categories': camp.special_ad_categories or [],
                'start_time': camp.start_time,
                'stop_time': camp.stop_time,
                'insights': {**zero_insights, 'campaign_id': cid, 'campaign_name': camp.name},
            })
    return result


@router.get("/daily/adsets")
def get_daily_adsets(
    ad_account_id: str,
    since: str,
    until: str,
    campaign_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get adset stats aggregated over a date range from daily sync cache."""
    acct = _normalize_account_id(ad_account_id)
    q = db.query(FBSyncDailyStats).filter(
        FBSyncDailyStats.ad_account_id == acct,
        FBSyncDailyStats.object_type == 'adset',
        FBSyncDailyStats.date >= since,
        FBSyncDailyStats.date <= until,
    )
    if campaign_id:
        q = q.filter(FBSyncDailyStats.campaign_id == campaign_id)
    rows = q.all()

    from collections import defaultdict
    by_adset = defaultdict(list)
    for r in rows:
        by_adset[r.object_id].append(r)

    adsets = {a.fb_adset_id: a for a in db.query(FBSyncAdSet).filter(
        FBSyncAdSet.ad_account_id == acct
    ).all()}

    zero_insights = _aggregate_daily_rows([])

    result = []
    seen_ids = set()
    for asid, day_rows in by_adset.items():
        agg = _aggregate_daily_rows(day_rows)
        aset = adsets.get(asid)
        seen_ids.add(asid)
        result.append({
            'id': asid,
            'name': aset.name if aset else (day_rows[0].object_name or asid),
            'status': aset.status if aset else None,
            'effective_status': aset.effective_status if aset else None,
            'daily_budget': aset.daily_budget if aset else None,
            'lifetime_budget': aset.lifetime_budget if aset else None,
            'targeting': aset.targeting if aset else None,
            'optimization_goal': aset.optimization_goal if aset else None,
            'bid_amount': aset.bid_amount if aset else None,
            'bid_strategy': aset.bid_strategy if aset else None,
            'billing_event': aset.billing_event if aset else None,
            'start_time': aset.start_time if aset else None,
            'end_time': aset.end_time if aset else None,
            'insights': {**agg, 'adset_id': asid, 'adset_name': aset.name if aset else ''},
        })
    # Ad sets with zero activity
    adsets_to_show = adsets
    if campaign_id:
        adsets_to_show = {k: v for k, v in adsets.items() if v.fb_campaign_id == campaign_id}
    for asid, aset in adsets_to_show.items():
        if asid not in seen_ids:
            result.append({
                'id': asid,
                'name': aset.name,
                'status': aset.status,
                'effective_status': aset.effective_status,
                'daily_budget': aset.daily_budget,
                'lifetime_budget': aset.lifetime_budget,
                'targeting': aset.targeting,
                'optimization_goal': aset.optimization_goal,
                'bid_amount': aset.bid_amount,
                'bid_strategy': aset.bid_strategy,
                'billing_event': aset.billing_event,
                'start_time': aset.start_time,
                'end_time': aset.end_time,
                'insights': {**zero_insights, 'adset_id': asid, 'adset_name': aset.name},
            })
    return result


@router.get("/daily/ads")
def get_daily_ads(
    ad_account_id: str,
    since: str,
    until: str,
    adset_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get ad stats aggregated over a date range from daily sync cache."""
    acct = _normalize_account_id(ad_account_id)
    q = db.query(FBSyncDailyStats).filter(
        FBSyncDailyStats.ad_account_id == acct,
        FBSyncDailyStats.object_type == 'ad',
        FBSyncDailyStats.date >= since,
        FBSyncDailyStats.date <= until,
    )
    if adset_id:
        q = q.filter(FBSyncDailyStats.adset_id == adset_id)
    rows = q.all()

    from collections import defaultdict
    by_ad = defaultdict(list)
    for r in rows:
        by_ad[r.object_id].append(r)

    ads = {a.fb_ad_id: a for a in db.query(FBSyncAd).filter(
        FBSyncAd.ad_account_id == acct
    ).all()}

    zero_insights = _aggregate_daily_rows([])

    result = []
    seen_ids = set()
    for aid, day_rows in by_ad.items():
        agg = _aggregate_daily_rows(day_rows)
        ad = ads.get(aid)
        seen_ids.add(aid)
        result.append({
            'id': aid,
            'name': ad.name if ad else (day_rows[0].object_name or aid),
            'status': ad.status if ad else None,
            'effective_status': ad.effective_status if ad else None,
            'creative': {'id': ad.creative_id} if ad and ad.creative_id else None,
            'adset_id': ad.fb_adset_id if ad else (day_rows[0].adset_id if day_rows else None),
            'campaign_id': ad.fb_campaign_id if ad else (day_rows[0].campaign_id if day_rows else None),
            'insights': {**agg, 'ad_id': aid, 'ad_name': ad.name if ad else ''},
            'creative_data': ad.creative_data if ad else {},
        })
    # Ads with zero activity
    ads_to_show = ads
    if adset_id:
        ads_to_show = {k: v for k, v in ads.items() if v.fb_adset_id == adset_id}
    for aid, ad in ads_to_show.items():
        if aid not in seen_ids:
            result.append({
                'id': aid,
                'name': ad.name,
                'status': ad.status,
                'effective_status': ad.effective_status,
                'creative': {'id': ad.creative_id} if ad.creative_id else None,
                'adset_id': ad.fb_adset_id,
                'campaign_id': ad.fb_campaign_id,
                'insights': {**zero_insights, 'ad_id': aid, 'ad_name': ad.name},
                'creative_data': ad.creative_data or {},
            })
    return result


@router.get("/daily/all-ads")
def get_daily_all_ads(
    ad_account_id: str,
    since: str,
    until: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get ALL ad stats for an account aggregated over a date range."""
    return get_daily_ads(ad_account_id=ad_account_id, since=since, until=until, db=db, current_user=current_user)


@router.get("/daily/all-adsets")
def get_daily_all_adsets(
    ad_account_id: str,
    since: str,
    until: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get ALL adset stats for an account aggregated over a date range."""
    return get_daily_adsets(ad_account_id=ad_account_id, since=since, until=until, db=db, current_user=current_user)
