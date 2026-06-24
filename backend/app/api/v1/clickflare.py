"""
Clickflare Stats API — Mobile-friendly reporting endpoints.

Parses ClickFlare CSV exports and returns structured JSON for the
frontend dashboard. Supports CSV upload with aggregated breakdowns
by geo, device, OS, hour, and campaign/sub1.
"""

import csv
import io
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.core.deps import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter()


def _safe_int(row, col):
    if not col or col not in row:
        return 0
    try:
        return int(float(row[col]))
    except (ValueError, TypeError):
        return 0


def _safe_float(row, col):
    if not col or col not in row:
        return 0.0
    try:
        return float(str(row[col]).replace('$', '').replace(',', ''))
    except (ValueError, TypeError, AttributeError):
        return 0.0


def _find_col(headers, *candidates):
    """Case-insensitive column matching."""
    for c in candidates:
        for h_lower, h_orig in headers.items():
            if c.lower() in h_lower:
                return h_orig
    return None


def _calc_metrics(stats):
    """Add calculated metrics (CVR, CPA, EPC, ROI) to a stats dict."""
    clicks = stats.get('clicks', 0)
    conv = stats.get('conversions', 0)
    revenue = stats.get('revenue', 0)
    cost = stats.get('cost', 0)
    stats['cvr'] = round((conv / clicks * 100), 2) if clicks > 0 else 0
    stats['cpa'] = round(cost / conv, 2) if conv > 0 else 0
    stats['epc'] = round(revenue / clicks, 2) if clicks > 0 else 0
    stats['roi'] = round(((revenue - cost) / cost * 100), 2) if cost > 0 else 0
    stats['profit'] = round(revenue - cost, 2)
    return stats


def _parse_csv_rows(rows):
    """Parse CSV rows into structured stats."""
    if not rows:
        return None

    headers = {h.lower().strip(): h for h in rows[0].keys()}

    col_clicks = _find_col(headers, 'clicks', 'click')
    col_conv = _find_col(headers, 'conversions', 'conversion', 'conv')
    col_revenue = _find_col(headers, 'revenue', 'rev', 'payout')
    col_cost = _find_col(headers, 'cost', 'spend')
    col_country = _find_col(headers, 'country', 'geo')
    col_region = _find_col(headers, 'region', 'state')
    col_device = _find_col(headers, 'device', 'device_type')
    col_os = _find_col(headers, 'os', 'operating_system')
    col_hour = _find_col(headers, 'hour', 'hr')
    col_sub1 = _find_col(headers, 'sub1', 'subid1', 'sub_id_1', 'campaign')
    col_lander = _find_col(headers, 'lander', 'landing_page', 'lp')
    col_offer = _find_col(headers, 'offer', 'offer_name')

    # Aggregation buckets
    geo_stats = {}
    device_stats = {}
    os_stats = {}
    hour_stats = {}
    campaign_stats = {}
    totals = {'clicks': 0, 'conversions': 0, 'revenue': 0.0, 'cost': 0.0}

    for row in rows:
        clicks = _safe_int(row, col_clicks)
        conv = _safe_int(row, col_conv)
        rev = _safe_float(row, col_revenue)
        cost = _safe_float(row, col_cost)
        country = row.get(col_country, 'Unknown') if col_country else 'Unknown'
        region = row.get(col_region, '') if col_region else ''
        device = row.get(col_device, 'Unknown') if col_device else 'Unknown'
        os_val = row.get(col_os, 'Unknown') if col_os else 'Unknown'
        hour = row.get(col_hour, '') if col_hour else ''
        sub1 = row.get(col_sub1, '') if col_sub1 else ''

        totals['clicks'] += clicks
        totals['conversions'] += conv
        totals['revenue'] += rev
        totals['cost'] += cost

        # Geo aggregation
        geo_key = country + (f" - {region}" if region else "")
        if geo_key not in geo_stats:
            geo_stats[geo_key] = {'name': geo_key, 'clicks': 0, 'conversions': 0, 'revenue': 0.0, 'cost': 0.0}
        geo_stats[geo_key]['clicks'] += clicks
        geo_stats[geo_key]['conversions'] += conv
        geo_stats[geo_key]['revenue'] += rev
        geo_stats[geo_key]['cost'] += cost

        # Device aggregation
        if device:
            if device not in device_stats:
                device_stats[device] = {'name': device, 'clicks': 0, 'conversions': 0, 'revenue': 0.0, 'cost': 0.0}
            device_stats[device]['clicks'] += clicks
            device_stats[device]['conversions'] += conv
            device_stats[device]['revenue'] += rev
            device_stats[device]['cost'] += cost

        # OS aggregation
        if os_val:
            if os_val not in os_stats:
                os_stats[os_val] = {'name': os_val, 'clicks': 0, 'conversions': 0, 'revenue': 0.0, 'cost': 0.0}
            os_stats[os_val]['clicks'] += clicks
            os_stats[os_val]['conversions'] += conv
            os_stats[os_val]['revenue'] += rev
            os_stats[os_val]['cost'] += cost

        # Hourly aggregation
        if hour:
            try:
                h = str(int(float(hour)))
            except (ValueError, TypeError):
                h = hour
            if h not in hour_stats:
                hour_stats[h] = {'hour': h, 'clicks': 0, 'conversions': 0, 'revenue': 0.0, 'cost': 0.0}
            hour_stats[h]['clicks'] += clicks
            hour_stats[h]['conversions'] += conv
            hour_stats[h]['revenue'] += rev
            hour_stats[h]['cost'] += cost

        # Campaign / Sub1 aggregation
        if sub1:
            if sub1 not in campaign_stats:
                campaign_stats[sub1] = {'name': sub1, 'clicks': 0, 'conversions': 0, 'revenue': 0.0, 'cost': 0.0}
            campaign_stats[sub1]['clicks'] += clicks
            campaign_stats[sub1]['conversions'] += conv
            campaign_stats[sub1]['revenue'] += rev
            campaign_stats[sub1]['cost'] += cost

    # Calculate metrics for totals
    _calc_metrics(totals)
    totals['revenue'] = round(totals['revenue'], 2)
    totals['cost'] = round(totals['cost'], 2)

    # Sort and calculate metrics for each breakdown
    def sorted_with_metrics(stats_dict, sort_key='conversions', limit=None):
        items = sorted(stats_dict.values(), key=lambda x: x[sort_key], reverse=True)
        if limit:
            items = items[:limit]
        for item in items:
            _calc_metrics(item)
            item['revenue'] = round(item['revenue'], 2)
            item['cost'] = round(item['cost'], 2)
        return items

    # Hourly: sort by hour number
    hourly_sorted = sorted(hour_stats.values(), key=lambda x: int(x['hour']) if x['hour'].isdigit() else 0)
    for h in hourly_sorted:
        _calc_metrics(h)
        h['label'] = f"{int(h['hour']):02d}:00" if h['hour'].isdigit() else h['hour']
        h['revenue'] = round(h['revenue'], 2)
        h['cost'] = round(h['cost'], 2)

    # Find peak and dead hours
    peak_hour = max(hourly_sorted, key=lambda x: x['conversions']) if hourly_sorted else None
    dead_hours = [h for h in hourly_sorted if h['conversions'] == 0 and h['clicks'] > 0]

    # Identify wasted spend geos (high clicks, 0 conversions)
    wasted_geos = [g for g in geo_stats.values() if g['clicks'] > 10 and g['conversions'] == 0]
    for g in wasted_geos:
        g['revenue'] = round(g['revenue'], 2)
        g['cost'] = round(g['cost'], 2)

    return {
        'parsed_at': datetime.now().isoformat(),
        'row_count': len(rows),
        'totals': totals,
        'geo': sorted_with_metrics(geo_stats, limit=20),
        'devices': sorted_with_metrics(device_stats),
        'os': sorted_with_metrics(os_stats),
        'hourly': hourly_sorted,
        'campaigns': sorted_with_metrics(campaign_stats, limit=30),
        'insights': {
            'peak_hour': peak_hour,
            'dead_hours': dead_hours,
            'wasted_geos': wasted_geos[:5],
        },
        'columns_detected': {
            'clicks': col_clicks,
            'conversions': col_conv,
            'revenue': col_revenue,
            'cost': col_cost,
            'country': col_country,
            'device': col_device,
            'os': col_os,
            'hour': col_hour,
            'sub1': col_sub1,
        }
    }


@router.post("/upload")
async def upload_clickflare_csv(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
):
    """
    Upload a ClickFlare CSV export and get structured JSON stats back.
    Mobile-optimized response with breakdowns by geo, device, OS, hour, campaign.
    """
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

    result = _parse_csv_rows(rows)
    if not result:
        raise HTTPException(status_code=400, detail="No data could be parsed from CSV")

    return result
