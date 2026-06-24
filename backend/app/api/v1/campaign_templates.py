from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import CampaignTemplate, User
from app.core.deps import get_current_active_user

router = APIRouter()


@router.get("/")
def list_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """List all campaign templates."""
    templates = db.query(CampaignTemplate).order_by(
        CampaignTemplate.created_at.desc()
    ).all()
    return [{
        "id": t.id,
        "name": t.name,
        "campaign_config": t.campaign_config,
        "adset_config": t.adset_config,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    } for t in templates]


@router.post("/")
def create_template(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Save current campaign + adset config as a reusable template."""
    name = data.get('name')
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    template = CampaignTemplate(
        name=name,
        campaign_config=data.get('campaign_config', {}),
        adset_config=data.get('adset_config', {}),
        user_id=current_user.id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return {"id": template.id, "name": template.name}


@router.delete("/{template_id}")
def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Delete a campaign template."""
    template = db.query(CampaignTemplate).filter(
        CampaignTemplate.id == template_id
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(template)
    db.commit()
    return {"message": "Template deleted"}
