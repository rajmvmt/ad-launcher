from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from app.database import get_db
from app.models import Lander, User
from app.core.deps import get_current_active_user
import uuid

router = APIRouter()


class LanderCreate(BaseModel):
    url: str
    title: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list] = None
    brand_id: Optional[str] = None
    screenshot_url: Optional[str] = None


class LanderUpdate(BaseModel):
    url: Optional[str] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list] = None
    brand_id: Optional[str] = None
    screenshot_url: Optional[str] = None


@router.get("/")
def list_landers(
    brand_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(Lander).order_by(Lander.created_at.desc())
    if brand_id:
        query = query.filter(Lander.brand_id == brand_id)
    landers = query.all()
    return [
        {
            "id": l.id,
            "url": l.url,
            "title": l.title,
            "notes": l.notes,
            "tags": l.tags or [],
            "brand_id": l.brand_id,
            "brand_name": l.brand.name if l.brand else None,
            "screenshot_url": l.screenshot_url,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in landers
    ]


@router.post("/")
def create_lander(
    data: LanderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    lander = Lander(
        id=str(uuid.uuid4()),
        url=data.url,
        title=data.title or data.url,
        notes=data.notes,
        tags=data.tags,
        brand_id=data.brand_id,
        screenshot_url=data.screenshot_url,
    )
    db.add(lander)
    db.commit()
    db.refresh(lander)
    return {
        "id": lander.id,
        "url": lander.url,
        "title": lander.title,
        "notes": lander.notes,
        "tags": lander.tags or [],
        "brand_id": lander.brand_id,
        "screenshot_url": lander.screenshot_url,
        "created_at": lander.created_at.isoformat() if lander.created_at else None,
    }


@router.put("/{lander_id}")
def update_lander(
    lander_id: str,
    data: LanderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    lander = db.query(Lander).filter(Lander.id == lander_id).first()
    if not lander:
        raise HTTPException(status_code=404, detail="Lander not found")
    for field, value in data.dict(exclude_unset=True).items():
        setattr(lander, field, value)
    db.commit()
    db.refresh(lander)
    return {
        "id": lander.id,
        "url": lander.url,
        "title": lander.title,
        "notes": lander.notes,
        "tags": lander.tags or [],
        "brand_id": lander.brand_id,
        "screenshot_url": lander.screenshot_url,
    }


@router.delete("/{lander_id}")
def delete_lander(
    lander_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    lander = db.query(Lander).filter(Lander.id == lander_id).first()
    if not lander:
        raise HTTPException(status_code=404, detail="Lander not found")
    db.delete(lander)
    db.commit()
    return {"ok": True}
