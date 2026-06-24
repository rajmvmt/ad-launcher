"""Headline presets — saved headline/body combos per offer for quick ad creation."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from app.database import get_db
from app.models import HeadlinePreset, User
from app.core.deps import get_current_active_user

router = APIRouter()


class PresetCreate(BaseModel):
    name: str
    offer: str
    headlines: List[str]
    primary_texts: Optional[List[str]] = None
    description: Optional[str] = None


class PresetUpdate(BaseModel):
    name: Optional[str] = None
    offer: Optional[str] = None
    headlines: Optional[List[str]] = None
    primary_texts: Optional[List[str]] = None
    description: Optional[str] = None


def _serialize(p):
    return {
        "id": p.id,
        "name": p.name,
        "offer": p.offer,
        "headlines": p.headlines,
        "primary_texts": p.primary_texts,
        "description": p.description,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("/")
def list_presets(
    offer: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(HeadlinePreset)
    if offer:
        q = q.filter(HeadlinePreset.offer == offer)
    presets = q.order_by(HeadlinePreset.offer, HeadlinePreset.name).all()
    return [_serialize(p) for p in presets]


@router.post("/")
def create_preset(
    body: PresetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    preset = HeadlinePreset(
        name=body.name,
        offer=body.offer,
        headlines=body.headlines,
        primary_texts=body.primary_texts,
        description=body.description,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return _serialize(preset)


@router.put("/{preset_id}")
def update_preset(
    preset_id: str,
    body: PresetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    preset = db.query(HeadlinePreset).filter(HeadlinePreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    if body.name is not None:
        preset.name = body.name
    if body.offer is not None:
        preset.offer = body.offer
    if body.headlines is not None:
        preset.headlines = body.headlines
    if body.primary_texts is not None:
        preset.primary_texts = body.primary_texts
    if body.description is not None:
        preset.description = body.description
    db.commit()
    return _serialize(preset)


@router.delete("/{preset_id}")
def delete_preset(
    preset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    preset = db.query(HeadlinePreset).filter(HeadlinePreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    db.delete(preset)
    db.commit()
    return {"deleted": True}
