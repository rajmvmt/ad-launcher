"""/api/v1/spy — daily report endpoints + manual trigger.

Auth: shared-secret bearer token. Set `SPY_ADMIN_TOKEN` in Railway and in
`~/.claude/projects/-home-roly/memory/reference_spy_skill.md`. The /spy
command-line skill passes `Authorization: Bearer $SPY_ADMIN_TOKEN`.

This bypasses the app's per-user JWT auth because /spy is a single-user
operator tool, not a multi-tenant feature.
"""
import logging
import subprocess
import sys
import os
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SpyReport

logger = logging.getLogger(__name__)
router = APIRouter()


def require_spy_token(authorization: Optional[str] = Header(default=None)) -> None:
    expected = os.getenv("SPY_ADMIN_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="SPY_ADMIN_TOKEN not configured on server")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="Invalid spy token")


def _serialize(r: SpyReport) -> dict:
    return {
        "report_date": r.report_date.isoformat(),
        "total_ads_scanned": r.total_ads_scanned,
        "new_ads_count": r.new_ads_count,
        "competitors_scanned": r.competitors_scanned,
        "keywords_scanned": r.keywords_scanned,
        "top_scraped_ad_ids": r.top_scraped_ad_ids or [],
        "summary_markdown": r.summary_markdown,
        "telegram_chat_id": r.telegram_chat_id,
        "telegram_message_id": r.telegram_message_id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/reports")
def list_reports(
    limit: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    _auth: None = Depends(require_spy_token),
):
    rows = db.query(SpyReport).order_by(SpyReport.report_date.desc()).limit(limit).all()
    return [_serialize(r) for r in rows]


@router.get("/reports/{report_date}")
def get_report(
    report_date: str,
    db: Session = Depends(get_db),
    _auth: None = Depends(require_spy_token),
):
    if report_date == "latest":
        row = db.query(SpyReport).order_by(SpyReport.report_date.desc()).first()
    else:
        try:
            d = date.fromisoformat(report_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD or 'latest'")
        row = db.query(SpyReport).filter(SpyReport.report_date == d).first()

    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    return _serialize(row)


@router.get("/top")
def get_top(
    n: int = Query(20, ge=1, le=100),
    date_str: Optional[str] = Query(None, alias="date"),
    db: Session = Depends(get_db),
    _auth: None = Depends(require_spy_token),
):
    if date_str and date_str != "latest":
        try:
            d = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date")
        row = db.query(SpyReport).filter(SpyReport.report_date == d).first()
    else:
        row = db.query(SpyReport).order_by(SpyReport.report_date.desc()).first()

    if not row:
        raise HTTPException(status_code=404, detail="No reports yet")
    ids = (row.top_scraped_ad_ids or [])[:n]
    return {"report_date": row.report_date.isoformat(), "top_ad_ids": ids, "score_details": row.score_details}


@router.post("/run")
def trigger_run(
    _auth: None = Depends(require_spy_token),
):
    """Manual trigger — spawns run_daily_spy.py in a detached subprocess."""
    # backend/app/api/v1/spy.py → climb to backend/ → join run_daily_spy.py
    script = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
        "run_daily_spy.py",
    )
    if not os.path.exists(script):
        raise HTTPException(status_code=500, detail=f"run_daily_spy.py not found at {script}")
    try:
        subprocess.Popen(
            [sys.executable, script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as e:
        logger.exception("failed to spawn run_daily_spy.py")
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "started", "script": script}
