"""Campaign Optimizer endpoints — AI-powered analysis and execution via claude -p (OAuth)."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db
from app.models import FacebookConnection, User
from app.core.deps import get_current_active_user
from app.services.campaign_optimizer import CampaignOptimizer
from app.services.facebook_service import FacebookService

logger = logging.getLogger(__name__)

router = APIRouter()


class AnalyzeRequest(BaseModel):
    ad_account_id: str
    connection_id: Optional[str] = None


class Recommendation(BaseModel):
    action: str
    object_type: str = "campaign"
    object_id: str
    object_name: Optional[str] = None
    reason: Optional[str] = None
    priority: Optional[str] = None
    details: Optional[str] = None


class ExecuteRequest(BaseModel):
    ad_account_id: str
    connection_id: Optional[str] = None
    recommendation: Recommendation


class AutoOptimizeRequest(BaseModel):
    ad_account_id: str
    connection_id: Optional[str] = None


def _get_fb_service(db: Session, connection_id: Optional[str] = None) -> FacebookService:
    """Get a FacebookService instance from a connection."""
    if connection_id:
        conn = db.query(FacebookConnection).filter(FacebookConnection.id == connection_id).first()
    else:
        conn = db.query(FacebookConnection).filter(FacebookConnection.is_active == True).first()
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection found")
    service = FacebookService(connection=conn)
    if not service.api:
        service.initialize()
    return service


@router.post("/analyze")
def analyze_campaigns(
    req: AnalyzeRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Run AI analysis on campaign data from the synced DB."""
    try:
        optimizer = CampaignOptimizer(
            ad_account_id=req.ad_account_id,
            connection_id=req.connection_id,
        )
        result = optimizer.analyze()
        return result
    except Exception as e:
        logger.exception("Optimizer analysis failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute")
def execute_recommendation(
    req: ExecuteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Execute a single optimizer recommendation (pause/scale)."""
    try:
        service = _get_fb_service(db, req.connection_id)
        optimizer = CampaignOptimizer(
            ad_account_id=req.ad_account_id,
            connection_id=req.connection_id,
        )
        result = optimizer.execute_recommendation(req.recommendation.dict(), service)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Optimizer execute failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/auto-optimize")
def auto_optimize(
    req: AutoOptimizeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Run analysis AND auto-execute high-priority pause recommendations."""
    try:
        optimizer = CampaignOptimizer(
            ad_account_id=req.ad_account_id,
            connection_id=req.connection_id,
        )
        analysis = optimizer.analyze()

        if "error" in analysis:
            return analysis

        service = _get_fb_service(db, req.connection_id)
        executed = []

        for rec in analysis.get("recommendations", []):
            if rec.get("action") == "pause" and rec.get("priority") == "high":
                result = optimizer.execute_recommendation(rec, service)
                executed.append({**rec, "result": result})

        return {
            "analysis": analysis,
            "auto_executed": executed,
            "executed_count": len(executed),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Auto-optimize failed")
        raise HTTPException(status_code=500, detail=str(e))
