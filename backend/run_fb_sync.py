#!/usr/bin/env python3
"""
Cron job script to sync Facebook campaign/adset/ad data + insights into local DB.
Railway cron: */15 * * * * (every 15 minutes)
Command: python run_fb_sync.py
"""
import sys, os, time, logging, json
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import (
    FacebookConnection, FBSyncStatus, FBSyncCampaign, FBSyncAdSet, FBSyncAd,
    FBSyncDailyStats
)
from app.services.facebook_service import FacebookService
from app.services.ad_rejection_alerts import is_rejection_transition, send_rejection_alert

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

LOOKBACK_DAYS = int(os.environ.get('FB_SYNC_LOOKBACK_DAYS', '30'))


def _to_json(obj):
    """Convert FB SDK objects to JSON-serializable Python types."""
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, (list, tuple)):
        return [_to_json(item) for item in obj]
    if isinstance(obj, dict):
        return {str(k): _to_json(v) for k, v in obj.items()}
    # FB SDK objects (Targeting, etc.) support dict() conversion
    try:
        return _to_json(dict(obj))
    except (TypeError, ValueError):
        return str(obj)


SYNC_MODE = os.environ.get('SYNC_MODE', 'quick')  # 'quick' or 'full'


def sync_account(service, ad_account_id, db, connection_id, mode=None):
    """Sync one ad account's campaigns, adsets, and ads into local DB.

    mode='quick': campaigns/adsets/ads objects + today-only insights (light, 15-min cron)
    mode='full':  everything in quick + 30-day daily stats breakdown (heavy, 2x daily)
    """
    if mode is None:
        mode = SYNC_MODE
    start = time.time()

    # Normalize: read endpoints strip 'act_' before lookup, so we must store without it.
    # Service methods (_get_account) auto-prefix when needed, so plain id works for FB API too.
    ad_account_id = ad_account_id.replace('act_', '')

    today = datetime.now().strftime('%Y-%m-%d')
    since = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).strftime('%Y-%m-%d')
    time_range = {'since': since, 'until': today}

    campaigns_count = 0
    adsets_count = 0
    ads_count = 0

    # 1) Sync campaigns
    try:
        campaigns = service.get_campaigns_with_insights(ad_account_id, time_range)
    except Exception as e:
        logger.error(f"Failed to fetch campaigns for {ad_account_id}: {e}")
        campaigns = []

    for camp in campaigns:
        ins = camp.get('insights', {})
        # Upsert campaign
        existing = db.query(FBSyncCampaign).filter(
            FBSyncCampaign.fb_campaign_id == camp['id'],
            FBSyncCampaign.ad_account_id == ad_account_id,
        ).first()

        values = {
            'fb_campaign_id': camp['id'],
            'ad_account_id': ad_account_id,
            'name': camp.get('name', ''),
            'status': camp.get('status'),
            'effective_status': camp.get('effective_status'),
            'objective': camp.get('objective'),
            'daily_budget': camp.get('daily_budget'),
            'lifetime_budget': camp.get('lifetime_budget'),
            'bid_strategy': camp.get('bid_strategy'),
            'buying_type': camp.get('buying_type'),
            'special_ad_categories': _to_json(camp.get('special_ad_categories')),
            'start_time': camp.get('start_time'),
            'stop_time': camp.get('stop_time'),
            'insights_since': since,
            'insights_until': today,
            'impressions': ins.get('impressions', '0'),
            'clicks': ins.get('clicks', '0'),
            'spend': ins.get('spend', '0.00'),
            'ctr': ins.get('ctr', '0'),
            'cpc': ins.get('cpc', '0'),
            'cpm': ins.get('cpm', '0'),
            'reach': ins.get('reach', '0'),
            'results': ins.get('results', 0),
            'purchase_revenue': ins.get('purchase_revenue', 0.0),
            'actions': _to_json(ins.get('actions')),
            'cost_per_action_type': _to_json(ins.get('cost_per_action_type')),
            'action_values': _to_json(ins.get('action_values')),
            'synced_at': datetime.utcnow(),
        }

        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
        else:
            existing = FBSyncCampaign(**values)
            db.add(existing)
        campaigns_count += 1

    db.commit()

    # 2) Sync adsets for each campaign
    for camp in campaigns:
        try:
            adsets = service.get_adsets_with_insights(camp['id'], ad_account_id, time_range)
        except Exception as e:
            logger.warning(f"Failed to fetch adsets for campaign {camp['id']}: {e}")
            continue

        for aset in adsets:
            ins = aset.get('insights', {})
            existing = db.query(FBSyncAdSet).filter(
                FBSyncAdSet.fb_adset_id == aset['id'],
                FBSyncAdSet.ad_account_id == ad_account_id,
            ).first()

            values = {
                'fb_adset_id': aset['id'],
                'fb_campaign_id': camp['id'],
                'ad_account_id': ad_account_id,
                'name': aset.get('name', ''),
                'status': aset.get('status'),
                'effective_status': aset.get('effective_status'),
                'daily_budget': aset.get('daily_budget'),
                'lifetime_budget': aset.get('lifetime_budget'),
                'targeting': _to_json(aset.get('targeting')),
                'optimization_goal': aset.get('optimization_goal'),
                'bid_amount': str(aset.get('bid_amount', '')) if aset.get('bid_amount') else None,
                'bid_strategy': aset.get('bid_strategy'),
                'billing_event': aset.get('billing_event'),
                'start_time': aset.get('start_time'),
                'end_time': aset.get('end_time'),
                'insights_since': since,
                'insights_until': today,
                'impressions': ins.get('impressions', '0'),
                'clicks': ins.get('clicks', '0'),
                'spend': ins.get('spend', '0.00'),
                'ctr': ins.get('ctr', '0'),
                'cpc': ins.get('cpc', '0'),
                'cpm': ins.get('cpm', '0'),
                'reach': ins.get('reach', '0'),
                'results': ins.get('results', 0),
                'purchase_revenue': ins.get('purchase_revenue', 0.0),
                'actions': ins.get('actions'),
                'cost_per_action_type': ins.get('cost_per_action_type'),
                'action_values': ins.get('action_values'),
                'synced_at': datetime.utcnow(),
            }

            if existing:
                for k, v in values.items():
                    setattr(existing, k, v)
            else:
                existing = FBSyncAdSet(**values)
                db.add(existing)
            adsets_count += 1

        db.commit()

        # 3) Sync ads for each adset
        for aset in adsets:
            try:
                ads = service.get_ads_with_insights(aset['id'], ad_account_id, time_range)
            except Exception as e:
                logger.warning(f"Failed to fetch ads for adset {aset['id']}: {e}")
                continue

            for ad in ads:
                ins = ad.get('insights', {})
                existing_ad = db.query(FBSyncAd).filter(
                    FBSyncAd.fb_ad_id == ad['id'],
                    FBSyncAd.ad_account_id == ad_account_id,
                ).first()

                # Detect DISAPPROVED transition before we overwrite the stored status
                prev_status = existing_ad.effective_status if existing_ad else None
                new_status = ad.get('effective_status')
                if is_rejection_transition(prev_status, new_status):
                    send_rejection_alert(
                        ad_id=ad['id'],
                        ad_name=ad.get('name', ''),
                        account_id=ad_account_id,
                        campaign_name=camp.get('name', ''),
                        adset_name=aset.get('name', ''),
                        issues_info=ad.get('issues_info'),
                    )

                values = {
                    'fb_ad_id': ad['id'],
                    'fb_adset_id': aset['id'],
                    'fb_campaign_id': camp['id'],
                    'ad_account_id': ad_account_id,
                    'name': ad.get('name', ''),
                    'status': ad.get('status'),
                    'effective_status': ad.get('effective_status'),
                    'creative_id': (ad.get('creative') or {}).get('id'),
                    'creative_data': _to_json(ad.get('creative_data')),
                    'insights_since': since,
                    'insights_until': today,
                    'impressions': ins.get('impressions', '0'),
                    'clicks': ins.get('clicks', '0'),
                    'spend': ins.get('spend', '0.00'),
                    'ctr': ins.get('ctr', '0'),
                    'cpc': ins.get('cpc', '0'),
                    'cpm': ins.get('cpm', '0'),
                    'reach': ins.get('reach', '0'),
                    'results': ins.get('results', 0),
                    'purchase_revenue': ins.get('purchase_revenue', 0.0),
                    'actions': ins.get('actions'),
                    'cost_per_action_type': ins.get('cost_per_action_type'),
                    'action_values': ins.get('action_values'),
                    'synced_at': datetime.utcnow(),
                }

                if existing_ad:
                    for k, v in values.items():
                        setattr(existing_ad, k, v)
                else:
                    existing_ad = FBSyncAd(**values)
                    db.add(existing_ad)
                ads_count += 1

            db.commit()

    # 4) Sync today-only insights (separate time_range = today only)
    #    Also upserts into daily stats table so "Today" works from /daily/* endpoints
    def _upsert_daily(obj_id, obj_type, ins, campaign_id=None, adset_id=None):
        """Upsert a single day's stats into the daily stats table."""
        from app.services.facebook_service import _extract_results, _extract_purchase_revenue
        existing = db.query(FBSyncDailyStats).filter(
            FBSyncDailyStats.date == today,
            FBSyncDailyStats.object_id == obj_id,
            FBSyncDailyStats.object_type == obj_type,
            FBSyncDailyStats.ad_account_id == ad_account_id,
        ).first()
        values = {
            'date': today, 'object_id': obj_id, 'object_type': obj_type,
            'ad_account_id': ad_account_id,
            'campaign_id': campaign_id or ins.get('campaign_id'),
            'adset_id': adset_id or ins.get('adset_id'),
            'object_name': ins.get(f'{obj_type}_name', ''),
            'impressions': ins.get('impressions', '0'),
            'clicks': ins.get('clicks', '0'),
            'spend': ins.get('spend', '0.00'),
            'ctr': ins.get('ctr', '0'), 'cpc': ins.get('cpc', '0'), 'cpm': ins.get('cpm', '0'),
            'reach': ins.get('reach', '0'),
            'results': _extract_results(ins.get('actions')) if 'results' not in ins else ins.get('results', 0),
            'purchase_revenue': _extract_purchase_revenue(ins.get('action_values')) if 'purchase_revenue' not in ins else ins.get('purchase_revenue', 0.0),
            'actions': _to_json(ins.get('actions')),
            'action_values': _to_json(ins.get('action_values')),
            'synced_at': datetime.utcnow(),
        }
        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
        else:
            db.add(FBSyncDailyStats(**values))

    today_range = {'since': today, 'until': today}
    try:
        today_campaign_insights = service.get_account_insights(ad_account_id, today_range, level='campaign')
        for ins in today_campaign_insights:
            cid = ins.get('campaign_id')
            if not cid:
                continue
            _upsert_daily(cid, 'campaign', ins)
            row = db.query(FBSyncCampaign).filter(
                FBSyncCampaign.fb_campaign_id == cid,
                FBSyncCampaign.ad_account_id == ad_account_id,
            ).first()
            if row:
                row.today_date = today
                row.today_spend = ins.get('spend', '0.00')
                row.today_impressions = ins.get('impressions', '0')
                row.today_clicks = ins.get('clicks', '0')
                row.today_ctr = ins.get('ctr', '0')
                row.today_cpc = ins.get('cpc', '0')
                row.today_cpm = ins.get('cpm', '0')
                row.today_results = ins.get('results', 0)
                row.today_purchase_revenue = ins.get('purchase_revenue', 0.0)
                row.today_actions = _to_json(ins.get('actions'))
                row.today_action_values = _to_json(ins.get('action_values'))
        db.commit()
    except Exception as e:
        logger.warning(f"Failed to fetch today campaign insights for {ad_account_id}: {e}")
        db.rollback()

    try:
        today_adset_insights = service.get_account_insights(ad_account_id, today_range, level='adset')
        for ins in today_adset_insights:
            asid = ins.get('adset_id')
            if not asid:
                continue
            _upsert_daily(asid, 'adset', ins)
            row = db.query(FBSyncAdSet).filter(
                FBSyncAdSet.fb_adset_id == asid,
                FBSyncAdSet.ad_account_id == ad_account_id,
            ).first()
            if row:
                row.today_date = today
                row.today_spend = ins.get('spend', '0.00')
                row.today_impressions = ins.get('impressions', '0')
                row.today_clicks = ins.get('clicks', '0')
                row.today_ctr = ins.get('ctr', '0')
                row.today_cpc = ins.get('cpc', '0')
                row.today_cpm = ins.get('cpm', '0')
                row.today_results = ins.get('results', 0)
                row.today_purchase_revenue = ins.get('purchase_revenue', 0.0)
                row.today_actions = _to_json(ins.get('actions'))
                row.today_action_values = _to_json(ins.get('action_values'))
        db.commit()
    except Exception as e:
        logger.warning(f"Failed to fetch today adset insights for {ad_account_id}: {e}")
        db.rollback()

    try:
        today_ad_insights = service.get_account_insights(ad_account_id, today_range, level='ad')
        for ins in today_ad_insights:
            aid = ins.get('ad_id')
            if not aid:
                continue
            _upsert_daily(aid, 'ad', ins)
            row = db.query(FBSyncAd).filter(
                FBSyncAd.fb_ad_id == aid,
                FBSyncAd.ad_account_id == ad_account_id,
            ).first()
            if row:
                row.today_date = today
                row.today_spend = ins.get('spend', '0.00')
                row.today_impressions = ins.get('impressions', '0')
                row.today_clicks = ins.get('clicks', '0')
                row.today_ctr = ins.get('ctr', '0')
                row.today_cpc = ins.get('cpc', '0')
                row.today_cpm = ins.get('cpm', '0')
                row.today_results = ins.get('results', 0)
                row.today_purchase_revenue = ins.get('purchase_revenue', 0.0)
                row.today_actions = _to_json(ins.get('actions'))
                row.today_action_values = _to_json(ins.get('action_values'))
        db.commit()
    except Exception as e:
        logger.warning(f"Failed to fetch today ad insights for {ad_account_id}: {e}")
        db.rollback()

    # 5) Sync daily stats breakdown — ONLY in full mode (heavy, 2x daily)
    if mode != 'full':
        logger.info(f"  Skipping daily stats (mode={mode})")
    else:
        logger.info(f"  Syncing 30-day daily breakdown...")

    daily_range = {'since': since, 'until': today}
    for level_name, id_field in [('campaign', 'campaign_id'), ('adset', 'adset_id'), ('ad', 'ad_id')] if mode == 'full' else []:
        try:
            from facebook_business.adobjects.adaccount import AdAccount
            account = service._get_account(ad_account_id)
            fields = [
                'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
                'ad_id', 'ad_name', 'impressions', 'clicks', 'spend',
                'ctr', 'cpc', 'cpm', 'reach', 'actions', 'action_values',
            ]
            params = {
                'time_range': daily_range,
                'level': level_name,
                'time_increment': 1,
                'filtering': [
                    {'field': 'campaign.effective_status', 'operator': 'IN',
                     'value': ['ACTIVE', 'PAUSED']},
                ],
            }
            cursor = account.get_insights(fields=fields, params=params)
            count = 0
            for row in cursor:
                d = dict(row)
                day = d.get('date_start', '')
                obj_id = d.get(id_field, '')
                if not day or not obj_id:
                    continue

                from app.services.facebook_service import _extract_results, _extract_purchase_revenue
                existing = db.query(FBSyncDailyStats).filter(
                    FBSyncDailyStats.date == day,
                    FBSyncDailyStats.object_id == obj_id,
                    FBSyncDailyStats.object_type == level_name,
                    FBSyncDailyStats.ad_account_id == ad_account_id,
                ).first()

                values = {
                    'date': day,
                    'object_id': obj_id,
                    'object_type': level_name,
                    'ad_account_id': ad_account_id,
                    'campaign_id': d.get('campaign_id'),
                    'adset_id': d.get('adset_id'),
                    'object_name': d.get(f'{level_name}_name', ''),
                    'impressions': d.get('impressions', '0'),
                    'clicks': d.get('clicks', '0'),
                    'spend': d.get('spend', '0.00'),
                    'ctr': d.get('ctr', '0'),
                    'cpc': d.get('cpc', '0'),
                    'cpm': d.get('cpm', '0'),
                    'reach': d.get('reach', '0'),
                    'results': _extract_results(d.get('actions')),
                    'purchase_revenue': _extract_purchase_revenue(d.get('action_values')),
                    'actions': _to_json(d.get('actions')),
                    'action_values': _to_json(d.get('action_values')),
                    'synced_at': datetime.utcnow(),
                }

                if existing:
                    for k, v in values.items():
                        setattr(existing, k, v)
                else:
                    db.add(FBSyncDailyStats(**values))
                count += 1

            db.commit()
            logger.info(f"  Synced {count} daily {level_name} stats for {ad_account_id}")
        except Exception as e:
            logger.warning(f"Failed to sync daily {level_name} stats for {ad_account_id}: {e}")
            db.rollback()

    # Update sync status
    duration_ms = int((time.time() - start) * 1000)
    sync_status = db.query(FBSyncStatus).filter(
        FBSyncStatus.ad_account_id == ad_account_id
    ).first()

    if sync_status:
        sync_status.last_synced_at = datetime.utcnow()
        sync_status.last_sync_duration_ms = duration_ms
        sync_status.last_sync_error = None
        sync_status.campaigns_count = campaigns_count
        sync_status.adsets_count = adsets_count
        sync_status.ads_count = ads_count
    else:
        sync_status = FBSyncStatus(
            ad_account_id=ad_account_id,
            connection_id=connection_id,
            last_synced_at=datetime.utcnow(),
            last_sync_duration_ms=duration_ms,
            campaigns_count=campaigns_count,
            adsets_count=adsets_count,
            ads_count=ads_count,
        )
        db.add(sync_status)
    db.commit()

    return campaigns_count, adsets_count, ads_count, duration_ms


def main():
    mode = 'quick'
    if len(sys.argv) > 1 and sys.argv[1] in ('quick', 'full'):
        mode = sys.argv[1]
    else:
        mode = os.environ.get('SYNC_MODE', 'quick')
    logger.info(f"FB sync starting (mode={mode})")

    db = SessionLocal()
    try:
        connections = db.query(FacebookConnection).filter(
            FacebookConnection.is_active == True
        ).all()

        if not connections:
            logger.info("No active Facebook connections found")
            return

        for conn in connections:
            try:
                service = FacebookService(connection=conn)
                if not service.api:
                    service.initialize()

                accounts = service.get_ad_accounts()
                for acct in accounts:
                    acct_id = acct.get('account_id') or acct.get('id', '')
                    if not acct_id:
                        continue
                    # Normalize: always store without act_ prefix
                    acct_id = acct_id.replace('act_', '')

                    logger.info(f"Syncing account {acct_id} ({acct.get('name', 'unknown')})...")
                    try:
                        c, a, ads, ms = sync_account(service, acct_id, db, conn.id, mode=mode)
                        logger.info(f"  Synced: {c} campaigns, {a} adsets, {ads} ads in {ms}ms")
                    except Exception as e:
                        db.rollback()
                        logger.error(f"  Failed to sync account {acct_id}: {e}", exc_info=True)
                        # Record error in sync status
                        sync_status = db.query(FBSyncStatus).filter(
                            FBSyncStatus.ad_account_id == acct_id
                        ).first()
                        if sync_status:
                            sync_status.last_sync_error = str(e)[:500]
                        else:
                            sync_status = FBSyncStatus(
                                ad_account_id=acct_id,
                                connection_id=conn.id,
                                last_sync_error=str(e)[:500],
                            )
                            db.add(sync_status)
                        db.commit()

            except Exception as e:
                logger.error(f"Error processing connection {conn.id}: {e}", exc_info=True)

        logger.info("FB sync complete")

    except Exception as e:
        logger.error(f"Fatal error in FB sync: {e}", exc_info=True)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
