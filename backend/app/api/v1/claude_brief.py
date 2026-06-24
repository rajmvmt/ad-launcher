import logging
import csv
import io
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.services.facebook_service import FacebookService, _extract_results, _extract_purchase_revenue
from app.models import FacebookConnection, User
from app.database import get_db
from app.core.deps import get_current_active_user

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_facebook_service(connection_id: Optional[str] = None, db: Session = None):
    """Get FacebookService from connection_id or default."""
    if connection_id:
        conn = db.query(FacebookConnection).filter(
            FacebookConnection.id == connection_id,
            FacebookConnection.is_active == True
        ).first()
        if not conn:
            raise HTTPException(status_code=404, detail="Facebook connection not found")
        return FacebookService(connection=conn)
    default_conn = db.query(FacebookConnection).filter(
        FacebookConnection.is_default == True,
        FacebookConnection.is_active == True
    ).first()
    if default_conn:
        return FacebookService(connection=default_conn)
    return FacebookService()


def _date_range_from_preset(range_str: str):
    """Convert range preset to {since, until} dict."""
    try:
        from zoneinfo import ZoneInfo
        eastern = ZoneInfo('America/New_York')
    except ImportError:
        from datetime import timezone
        eastern = timezone(timedelta(hours=-5))
    now = datetime.now(eastern)
    today = now.strftime('%Y-%m-%d')
    days_map = {'1d': 0, '7d': 7, '14d': 14, '30d': 30}
    days_back = days_map.get(range_str, 0)
    since = (now - timedelta(days=days_back)).strftime('%Y-%m-%d')
    return {'since': since, 'until': today}


def _prev_range(range_str: str, current_range: dict):
    """Compute the previous comparison period."""
    try:
        from zoneinfo import ZoneInfo
        eastern = ZoneInfo('America/New_York')
    except ImportError:
        from datetime import timezone
        eastern = timezone(timedelta(hours=-5))
    since_dt = datetime.strptime(current_range['since'], '%Y-%m-%d')
    until_dt = datetime.strptime(current_range['until'], '%Y-%m-%d')
    span = (until_dt - since_dt).days + 1
    prev_until = (since_dt - timedelta(days=1)).strftime('%Y-%m-%d')
    prev_since = (since_dt - timedelta(days=span)).strftime('%Y-%m-%d')
    return {'since': prev_since, 'until': prev_until}


def _fmt_money(v):
    return f"{float(v):.2f}"


def _fmt_pct(v):
    return f"{float(v):.1f}"


def _delta_pct(prev, curr):
    prev = float(prev)
    curr = float(curr)
    if prev == 0:
        if curr == 0:
            return "0.0"
        return "+999.9"
    d = ((curr - prev) / abs(prev)) * 100
    return f"{d:+.1f}"


def _build_brief(
    account_name: str,
    account_id: str,
    range_str: str,
    cpa_target: float,
    min_spend: float,
    campaigns_data: list,
    adsets_data: list,
    ads_data: list,
    prev_totals: dict,
):
    """Build the plain text brief."""
    today_str = datetime.now().strftime('%Y-%m-%d')
    range_label = {'1d': 'Last 24 Hours', '7d': 'Last 7 Days', '14d': 'Last 14 Days', '30d': 'Last 30 Days'}.get(range_str, range_str)
    comparison_label = 'DAY-OVER-DAY' if range_str == '1d' else 'WEEK-OVER-WEEK'

    # Account totals
    total_spend = 0
    total_conv = 0
    total_impressions = 0
    total_clicks = 0
    total_revenue = 0

    campaign_rows = []
    for c in campaigns_data:
        ins = c.get('insights', {})
        spend = float(ins.get('spend', 0))
        conv = int(ins.get('results', 0))
        impressions = int(ins.get('impressions', 0))
        clicks = int(ins.get('clicks', 0))
        revenue = float(ins.get('purchase_revenue', 0))
        ctr = float(ins.get('ctr', 0))
        cpm_val = float(ins.get('cpm', 0))
        cpa_val = spend / conv if conv > 0 else 0
        roas_val = revenue / spend if spend > 0 else 0

        total_spend += spend
        total_conv += conv
        total_impressions += impressions
        total_clicks += clicks
        total_revenue += revenue

        if spend > 0:
            campaign_rows.append({
                'name': c.get('name', 'Unknown'),
                'spend': spend,
                'conv': conv,
                'cpa': cpa_val,
                'ctr': ctr,
                'cpm': cpm_val,
                'roas': roas_val,
            })

    campaign_rows.sort(key=lambda x: x['spend'], reverse=True)

    total_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
    total_cpm = (total_spend / total_impressions * 1000) if total_impressions > 0 else 0
    total_cpa = total_spend / total_conv if total_conv > 0 else 0
    total_roas = total_revenue / total_spend if total_spend > 0 else 0

    # Ad set classification
    kill_candidates = []
    scale_candidates = []
    watch_candidates = []

    for a in adsets_data:
        ins = a.get('insights', {})
        spend = float(ins.get('spend', 0))
        conv = int(ins.get('results', 0))
        ctr = float(ins.get('ctr', 0))
        cpa_val = spend / conv if conv > 0 else 0
        campaign_name = ins.get('campaign_name', a.get('campaign_name', ''))
        # Try to get campaign name from the adset's campaign_id
        if not campaign_name:
            cid = a.get('campaign_id', '')
            for c in campaigns_data:
                if c.get('id') == cid:
                    campaign_name = c.get('name', '')
                    break

        row = {
            'name': a.get('name', ins.get('adset_name', 'Unknown')),
            'campaign': campaign_name,
            'spend': spend,
            'conv': conv,
            'cpa': cpa_val,
            'ctr': ctr,
        }

        if spend < min_spend:
            continue

        if conv == 0:
            kill_candidates.append(row)
        elif cpa_val < cpa_target and conv >= 2:
            scale_candidates.append(row)
        elif cpa_target <= cpa_val <= cpa_target * 1.5:
            watch_candidates.append(row)

    kill_candidates.sort(key=lambda x: x['spend'], reverse=True)
    scale_candidates.sort(key=lambda x: x['spend'], reverse=True)
    watch_candidates.sort(key=lambda x: x['spend'], reverse=True)

    # Top 10 ads by spend
    ad_rows = []
    for ad in ads_data:
        ins = ad.get('insights', {})
        spend = float(ins.get('spend', 0))
        if spend <= 0:
            continue
        conv = int(ins.get('results', 0))
        ctr = float(ins.get('ctr', 0))
        cpa_val = spend / conv if conv > 0 else 0
        adset_name = ins.get('adset_name', '')
        ad_rows.append({
            'name': ad.get('name', ins.get('ad_name', 'Unknown')),
            'adset': adset_name,
            'spend': spend,
            'conv': conv,
            'cpa': cpa_val,
            'ctr': ctr,
        })
    ad_rows.sort(key=lambda x: x['spend'], reverse=True)
    top_ads = ad_rows[:10]

    # Build output
    lines = []
    lines.append("==============================")
    lines.append(f"DAILY CAMPAIGN BRIEF -- {today_str}")
    lines.append(f"Account: {account_name} ({account_id})")
    lines.append(f"Period: {range_label} | CPA Target: ${_fmt_money(cpa_target)}")
    lines.append("==============================")
    lines.append("")
    lines.append("ACCOUNT OVERVIEW")
    lines.append(f"Spend: ${_fmt_money(total_spend)} | Conv: {total_conv} | CPA: ${_fmt_money(total_cpa)} | CTR: {_fmt_pct(total_ctr)}% | CPM: ${_fmt_money(total_cpm)} | ROAS: {_fmt_pct(total_roas)}x")
    lines.append("")

    # Comparison
    lines.append(comparison_label)
    prev_spend = float(prev_totals.get('spend', 0))
    prev_cpa = float(prev_totals.get('cpa', 0))
    prev_conv = int(prev_totals.get('conv', 0))
    lines.append(f"Spend: ${_fmt_money(prev_spend)} -> ${_fmt_money(total_spend)} ({_delta_pct(prev_spend, total_spend)}%)")
    lines.append(f"CPA: ${_fmt_money(prev_cpa)} -> ${_fmt_money(total_cpa)} ({_delta_pct(prev_cpa, total_cpa)}%)")
    lines.append(f"Conv: {prev_conv} -> {total_conv} ({_delta_pct(prev_conv, total_conv)}%)")
    lines.append("")

    lines.append("---")
    lines.append("CAMPAIGNS")
    for cr in campaign_rows:
        lines.append(f"{cr['name']} | ${_fmt_money(cr['spend'])} | Conv: {cr['conv']} | CPA: ${_fmt_money(cr['cpa'])} | CTR: {_fmt_pct(cr['ctr'])}% | ROAS: {_fmt_pct(cr['roas'])}x")
    lines.append("")

    lines.append("---")
    lines.append(f"KILL CANDIDATES (spent >${_fmt_money(min_spend)}, 0 conv)")
    if kill_candidates:
        for k in kill_candidates:
            lines.append(f"[KILL] {k['name']} ({k['campaign']}) | Spend: ${_fmt_money(k['spend'])} | CTR: {_fmt_pct(k['ctr'])}% | 0 conv")
    else:
        lines.append("(none)")
    lines.append("")

    lines.append(f"SCALE CANDIDATES (CPA < ${_fmt_money(cpa_target)})")
    if scale_candidates:
        for s in scale_candidates:
            lines.append(f"[SCALE] {s['name']} ({s['campaign']}) | Spend: ${_fmt_money(s['spend'])} | CPA: ${_fmt_money(s['cpa'])} | Conv: {s['conv']}")
    else:
        lines.append("(none)")
    lines.append("")

    lines.append(f"WATCH LIST (CPA 1x-1.5x target)")
    if watch_candidates:
        for w in watch_candidates:
            lines.append(f"[WATCH] {w['name']} ({w['campaign']}) | Spend: ${_fmt_money(w['spend'])} | CPA: ${_fmt_money(w['cpa'])} | Conv: {w['conv']}")
    else:
        lines.append("(none)")
    lines.append("")

    lines.append("---")
    lines.append("TOP 10 ADS BY SPEND")
    for i, ad in enumerate(top_ads, 1):
        cpa_str = f"${_fmt_money(ad['cpa'])}" if ad['conv'] > 0 else "N/A"
        lines.append(f"{i}. {ad['name']} | {ad['adset']} | ${_fmt_money(ad['spend'])} | Conv: {ad['conv']} | CPA: {cpa_str} | CTR: {_fmt_pct(ad['ctr'])}%")
    if not top_ads:
        lines.append("(no ads with spend)")
    lines.append("")

    lines.append("---")
    lines.append("NOTES FOR CLAUDE:")
    lines.append(f"- CPA target is ${_fmt_money(cpa_target)}. Flag anything above 1.5x.")
    lines.append("- High CTR + low conv = landing page issue. Low CTR + good conv rate = creative issue worth scaling with new creative.")
    lines.append("- Give me a prioritized action list: kill, scale, test, adjust.")

    return "\n".join(lines)


@router.get("/claude-brief", response_class=PlainTextResponse)
def get_claude_brief(
    range: str = Query("1d", regex="^(1d|7d|14d|30d)$"),
    min_spend: Optional[float] = None,
    cpa_target: float = Query(30.0),
    account_id: Optional[str] = None,
    connection_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate a plain text Claude Brief of Meta campaign data."""
    try:
        service = _get_facebook_service(connection_id, db)
        if not service.api:
            service.initialize()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

    # Default min_spend based on range
    if min_spend is None:
        min_spend = 10.0 if range == '1d' else 50.0

    time_range = _date_range_from_preset(range)
    prev_time_range = _prev_range(range, time_range)

    try:
        # Get account info
        ad_account_id = account_id
        account_name = "Unknown"
        if ad_account_id:
            if not ad_account_id.startswith('act_'):
                ad_account_id = f'act_{ad_account_id}'
        else:
            ad_account_id = None

        try:
            accounts = service.get_ad_accounts()
            if ad_account_id:
                acct = next((a for a in accounts if a.get('id') == ad_account_id), accounts[0] if accounts else {})
            else:
                acct = accounts[0] if accounts else {}
            account_name = acct.get('name', 'Unknown')
            if not ad_account_id:
                ad_account_id = acct.get('id')
        except Exception:
            pass

        # Current period data
        campaigns = service.get_campaigns_with_insights(ad_account_id, time_range)
        adsets = service.get_all_adsets_with_insights(ad_account_id, time_range)
        ads_insights = service.get_account_insights(ad_account_id, time_range, level='ad')

        # Map ad insights into ad-like dicts
        ads_data = []
        for ins in ads_insights:
            ads_data.append({
                'name': ins.get('ad_name', 'Unknown'),
                'insights': ins,
            })

        # Previous period for comparison
        prev_campaigns = []
        try:
            prev_campaigns = service.get_campaigns_with_insights(ad_account_id, prev_time_range)
        except Exception:
            pass

        prev_spend = sum(float((c.get('insights') or {}).get('spend', 0)) for c in prev_campaigns)
        prev_conv = sum(int((c.get('insights') or {}).get('results', 0)) for c in prev_campaigns)
        prev_cpa = prev_spend / prev_conv if prev_conv > 0 else 0

        prev_totals = {
            'spend': prev_spend,
            'conv': prev_conv,
            'cpa': prev_cpa,
        }

        # Add campaign names to adsets for display
        campaign_map = {c.get('id'): c.get('name', '') for c in campaigns}
        for a in adsets:
            cid = a.get('campaign_id', '')
            if not cid:
                ins = a.get('insights', {})
                cid = ins.get('campaign_id', '')
            a['campaign_name'] = campaign_map.get(cid, ins.get('campaign_name', '') if 'ins' in dir() else '')

        brief = _build_brief(
            account_name=account_name,
            account_id=ad_account_id or 'N/A',
            range_str=range,
            cpa_target=cpa_target,
            min_spend=min_spend,
            campaigns_data=campaigns,
            adsets_data=adsets,
            ads_data=ads_data,
            prev_totals=prev_totals,
        )

        return PlainTextResponse(content=brief)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error generating Claude Brief")
        raise HTTPException(status_code=500, detail=f"Error generating brief: {str(e)}")


@router.post("/parse-clickflare", response_class=PlainTextResponse)
async def parse_clickflare(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
):
    """Parse a ClickFlare CSV and return a plain text summary."""
    if not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    try:
        contents = await file.read()
        text = contents.decode('utf-8-sig')
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {str(e)}")

    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    # Auto-detect columns (case-insensitive matching)
    headers = {h.lower().strip(): h for h in rows[0].keys()} if rows else {}

    def find_col(*candidates):
        for c in candidates:
            for h_lower, h_orig in headers.items():
                if c.lower() in h_lower:
                    return h_orig
        return None

    col_clicks = find_col('clicks', 'click')
    col_conv = find_col('conversions', 'conversion', 'conv')
    col_revenue = find_col('revenue', 'rev')
    col_cost = find_col('cost', 'spend')
    col_country = find_col('country', 'geo')
    col_region = find_col('region', 'state')
    col_device = find_col('device', 'device_type')
    col_os = find_col('os', 'operating_system')
    col_hour = find_col('hour', 'hr')
    col_sub1 = find_col('sub1', 'subid1', 'sub_id_1')

    def safe_int(row, col):
        if not col or col not in row:
            return 0
        try:
            return int(float(row[col]))
        except (ValueError, TypeError):
            return 0

    def safe_float(row, col):
        if not col or col not in row:
            return 0.0
        try:
            return float(row[col].replace('$', '').replace(',', ''))
        except (ValueError, TypeError, AttributeError):
            return 0.0

    # Aggregate by geo
    geo_stats = {}
    device_stats = {}
    os_stats = {}
    hour_stats = {}
    total_clicks = 0
    total_conv = 0
    total_rev = 0.0
    total_cost = 0.0

    for row in rows:
        clicks = safe_int(row, col_clicks)
        conv = safe_int(row, col_conv)
        rev = safe_float(row, col_revenue)
        cost = safe_float(row, col_cost)
        country = row.get(col_country, 'Unknown') if col_country else 'Unknown'
        region = row.get(col_region, '') if col_region else ''
        device = row.get(col_device, 'Unknown') if col_device else 'Unknown'
        os_val = row.get(col_os, 'Unknown') if col_os else 'Unknown'
        hour = row.get(col_hour, '') if col_hour else ''

        total_clicks += clicks
        total_conv += conv
        total_rev += rev
        total_cost += cost

        geo_key = f"{country}" + (f" - {region}" if region else "")
        if geo_key not in geo_stats:
            geo_stats[geo_key] = {'clicks': 0, 'conv': 0, 'rev': 0, 'cost': 0}
        geo_stats[geo_key]['clicks'] += clicks
        geo_stats[geo_key]['conv'] += conv
        geo_stats[geo_key]['rev'] += rev
        geo_stats[geo_key]['cost'] += cost

        if device:
            if device not in device_stats:
                device_stats[device] = {'clicks': 0, 'conv': 0, 'cost': 0}
            device_stats[device]['clicks'] += clicks
            device_stats[device]['conv'] += conv
            device_stats[device]['cost'] += cost

        if os_val:
            if os_val not in os_stats:
                os_stats[os_val] = {'clicks': 0, 'conv': 0, 'cost': 0}
            os_stats[os_val]['clicks'] += clicks
            os_stats[os_val]['conv'] += conv
            os_stats[os_val]['cost'] += cost

        if hour:
            try:
                h = str(int(float(hour)))
            except (ValueError, TypeError):
                h = hour
            if h not in hour_stats:
                hour_stats[h] = {'clicks': 0, 'conv': 0}
            hour_stats[h]['clicks'] += clicks
            hour_stats[h]['conv'] += conv

    lines = []
    lines.append("==============================")
    lines.append(f"CLICKFLARE DATA BRIEF -- {datetime.now().strftime('%Y-%m-%d')}")
    lines.append(f"Rows: {len(rows)} | Clicks: {total_clicks} | Conv: {total_conv} | Revenue: ${_fmt_money(total_rev)} | Cost: ${_fmt_money(total_cost)}")
    lines.append("==============================")
    lines.append("")

    # Top 10 geos by conversions
    lines.append("TOP 10 GEOS BY CONVERSIONS")
    sorted_geos = sorted(geo_stats.items(), key=lambda x: x[1]['conv'], reverse=True)[:10]
    for geo, stats in sorted_geos:
        cvr = (stats['conv'] / stats['clicks'] * 100) if stats['clicks'] > 0 else 0
        cpa = stats['cost'] / stats['conv'] if stats['conv'] > 0 else 0
        epc = stats['rev'] / stats['clicks'] if stats['clicks'] > 0 else 0
        lines.append(f"{geo} | Clicks: {stats['clicks']} | Conv: {stats['conv']} | CVR: {_fmt_pct(cvr)}% | CPA: ${_fmt_money(cpa)} | EPC: ${_fmt_money(epc)}")
    if not sorted_geos:
        lines.append("(no geo data)")
    lines.append("")

    # Device/OS breakdown
    lines.append("---")
    lines.append("DEVICE BREAKDOWN")
    sorted_devices = sorted(device_stats.items(), key=lambda x: x[1]['conv'], reverse=True)
    for dev, stats in sorted_devices:
        share = (stats['conv'] / total_conv * 100) if total_conv > 0 else 0
        lines.append(f"{dev} | Conv: {stats['conv']} ({_fmt_pct(share)}%) | Clicks: {stats['clicks']} | Cost: ${_fmt_money(stats['cost'])}")
    lines.append("")

    lines.append("OS BREAKDOWN")
    sorted_os = sorted(os_stats.items(), key=lambda x: x[1]['conv'], reverse=True)
    for os_name, stats in sorted_os:
        share = (stats['conv'] / total_conv * 100) if total_conv > 0 else 0
        lines.append(f"{os_name} | Conv: {stats['conv']} ({_fmt_pct(share)}%) | Clicks: {stats['clicks']} | Cost: ${_fmt_money(stats['cost'])}")
    lines.append("")

    # Hourly distribution
    if hour_stats:
        lines.append("---")
        lines.append("HOURLY CONVERSION DISTRIBUTION (EST)")
        sorted_hours = sorted(hour_stats.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 0)
        peak_hour = max(hour_stats.items(), key=lambda x: x[1]['conv'])
        dead_hours = [h for h, s in hour_stats.items() if s['conv'] == 0 and s['clicks'] > 0]

        for h, stats in sorted_hours:
            h_label = f"{int(h):02d}:00" if h.isdigit() else h
            bar = "#" * min(stats['conv'], 30)
            lines.append(f"{h_label} | Conv: {stats['conv']} | Clicks: {stats['clicks']} {bar}")

        lines.append(f"Peak: {peak_hour[0]}:00 EST ({peak_hour[1]['conv']} conv)")
        if dead_hours:
            dead_str = ", ".join(f"{int(h):02d}:00" if h.isdigit() else h for h in sorted(dead_hours, key=lambda x: int(x) if x.isdigit() else 0))
            lines.append(f"Dead hours (clicks but 0 conv): {dead_str}")
        lines.append("")

    lines.append("---")
    lines.append("NOTES FOR CLAUDE:")
    lines.append("- Flag geos with high clicks and 0 conversions (wasted spend).")
    lines.append("- Flag device/OS combos eating budget without converting.")
    lines.append("- Recommend dayparting: suggest hours to pause and hours to increase bids.")
    lines.append("- If funnel data available, identify the biggest drop-off point.")

    return PlainTextResponse(content="\n".join(lines))
