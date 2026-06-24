"""P&L / Performance Summary endpoint — reads from Google Sheets CSV export."""

import csv
import io
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from typing import Optional
import httpx

from app.core.deps import get_current_active_user
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter()

SHEET_ID = "1oDg7-UVSlXPMiOvVabsHbcjW7yx8GpOwMSGcIjMWfG0"
SHEET_CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=0"


def _parse_money(val: str) -> float:
    """Parse '$1,234.56' -> 1234.56"""
    if not val:
        return 0.0
    return float(val.replace("$", "").replace(",", ""))


def _parse_int(val: str) -> int:
    if not val:
        return 0
    return int(float(val.replace(",", "")))


@router.get("/pnl")
async def get_pnl(
    current_user: User = Depends(get_current_active_user),
    days: Optional[int] = Query(None, description="Filter to last N days"),
):
    """Fetch P&L data from Google Sheets."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        resp = await client.get(SHEET_CSV_URL)
        resp.raise_for_status()

    reader = csv.DictReader(io.StringIO(resp.text))
    rows = []

    cutoff = None
    if days:
        cutoff = (datetime.utcnow() - timedelta(days=days)).date()

    for row in reader:
        date_str = row.get("Date", "").strip()
        if not date_str:
            continue
        try:
            date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        if cutoff and date < cutoff:
            continue

        revenue = _parse_money(row.get("Revenue", ""))
        spent = _parse_money(row.get("Amount Spent (USD)", ""))
        cogs = _parse_money(row.get("COGS", ""))
        shipping = _parse_money(row.get("Shipping Cost", ""))
        processing = _parse_money(row.get("Processing & Trx Fee", ""))
        voids = _parse_money(row.get("Void, Refund, Alert, CB Amount and Fee", ""))
        handling = _parse_money(row.get("Handling Cost", ""))
        cs_cost = _parse_money(row.get("CS Cost", ""))

        fulfillment_costs = cogs + shipping + processing + voids + handling + cs_cost
        net_revenue = revenue - fulfillment_costs  # revenue after all costs except ad spend
        profit = net_revenue - spent  # net revenue minus ad spend

        rows.append({
            "date": date_str,
            "campaign": row.get("Campaign", "").strip(),
            "offer": row.get("Offer", "").strip(),
            "media": row.get("Media", "").strip(),
            "platform": row.get("QS Platform", "").strip(),
            "orders_platform": _parse_int(row.get("Orders (Platform)", "")),
            "orders_qs": _parse_int(row.get("Orders (QS)", "")),
            "spent": round(spent, 2),
            "revenue": round(revenue, 2),
            "net_revenue": round(net_revenue, 2),
            "fulfillment_costs": round(fulfillment_costs, 2),
            "cogs": round(cogs, 2),
            "shipping": round(shipping, 2),
            "processing": round(processing, 2),
            "voids": round(voids, 2),
            "handling": round(handling, 2),
            "cs_cost": round(cs_cost, 2),
            "profit": round(profit, 2),
            "margin": round((profit / revenue * 100), 1) if revenue > 0 else 0,
            "roi": round((profit / spent * 100), 1) if spent > 0 else 0,
        })

    # Summary
    total_spent = sum(r["spent"] for r in rows)
    total_revenue = sum(r["revenue"] for r in rows)
    total_net_revenue = sum(r["net_revenue"] for r in rows)
    total_fulfillment = sum(r["fulfillment_costs"] for r in rows)
    total_profit = sum(r["profit"] for r in rows)
    total_orders = sum(r["orders_platform"] or r["orders_qs"] for r in rows)

    return {
        "rows": rows,
        "summary": {
            "total_spent": round(total_spent, 2),
            "total_revenue": round(total_revenue, 2),
            "total_net_revenue": round(total_net_revenue, 2),
            "total_fulfillment": round(total_fulfillment, 2),
            "total_profit": round(total_profit, 2),
            "total_orders": total_orders,
            "roi": round((total_profit / total_spent * 100), 1) if total_spent > 0 else 0,
        },
    }
