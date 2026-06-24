from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Any, List, Optional
from app.database import get_db
from app.models import Prompt, Brand
from pydantic import BaseModel

router = APIRouter()

class PromptCreate(BaseModel):
    id: str
    name: str
    category: str
    type: str = 'prompt'  # 'prompt', 'doc', or 'research'
    description: Optional[str] = None
    variables: Optional[List[str]] = None
    template: str
    notes: Optional[str] = None
    brand_id: Optional[str] = None
    files: Optional[List[Any]] = None

class PromptUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    variables: Optional[List[str]] = None
    template: Optional[str] = None
    notes: Optional[str] = None
    brand_id: Optional[str] = None
    files: Optional[List[Any]] = None

class PromptResponse(BaseModel):
    id: str
    name: str
    category: str
    type: str = 'prompt'
    description: Optional[str] = None
    variables: Optional[List[str]] = None
    template: str
    notes: Optional[str] = None
    brand_id: Optional[str] = None
    brand_name: Optional[str] = None
    files: Optional[List[Any]] = None

    class Config:
        from_attributes = True

@router.get("/", response_model=List[PromptResponse])
def get_prompts(type: Optional[str] = Query(None), brand_id: Optional[str] = Query(None), db: Session = Depends(get_db)):
    """Get all prompts, optionally filtered by type and/or brand"""
    q = db.query(Prompt)
    if type:
        q = q.filter(Prompt.type == type)
    if brand_id:
        q = q.filter(Prompt.brand_id == brand_id)
    items = q.order_by(Prompt.created_at.desc()).all()

    # Attach brand names
    brand_ids = {i.brand_id for i in items if i.brand_id}
    brand_map = {}
    if brand_ids:
        brands = db.query(Brand).filter(Brand.id.in_(brand_ids)).all()
        brand_map = {b.id: b.name for b in brands}

    result = []
    for item in items:
        data = {c.name: getattr(item, c.name) for c in item.__table__.columns}
        data['brand_name'] = brand_map.get(item.brand_id)
        result.append(data)
    return result

@router.get("/{prompt_id}", response_model=PromptResponse)
def get_prompt(prompt_id: str, db: Session = Depends(get_db)):
    """Get a specific prompt"""
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    data = {c.name: getattr(prompt, c.name) for c in prompt.__table__.columns}
    if prompt.brand_id:
        brand = db.query(Brand).filter(Brand.id == prompt.brand_id).first()
        data['brand_name'] = brand.name if brand else None
    else:
        data['brand_name'] = None
    return data

@router.post("/", response_model=PromptResponse)
def create_prompt(prompt: PromptCreate, db: Session = Depends(get_db)):
    """Create a new prompt, doc, or research item"""
    existing = db.query(Prompt).filter(Prompt.id == prompt.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Item with this ID already exists")

    db_prompt = Prompt(**prompt.dict())
    db.add(db_prompt)
    db.commit()
    db.refresh(db_prompt)

    data = {c.name: getattr(db_prompt, c.name) for c in db_prompt.__table__.columns}
    if db_prompt.brand_id:
        brand = db.query(Brand).filter(Brand.id == db_prompt.brand_id).first()
        data['brand_name'] = brand.name if brand else None
    else:
        data['brand_name'] = None
    return data

@router.put("/{prompt_id}", response_model=PromptResponse)
def update_prompt(prompt_id: str, prompt: PromptUpdate, db: Session = Depends(get_db)):
    """Update an existing prompt, doc, or research item"""
    db_prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not db_prompt:
        raise HTTPException(status_code=404, detail="Item not found")

    update_data = prompt.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_prompt, field, value)

    db.commit()
    db.refresh(db_prompt)

    data = {c.name: getattr(db_prompt, c.name) for c in db_prompt.__table__.columns}
    if db_prompt.brand_id:
        brand = db.query(Brand).filter(Brand.id == db_prompt.brand_id).first()
        data['brand_name'] = brand.name if brand else None
    else:
        data['brand_name'] = None
    return data

@router.delete("/{prompt_id}")
def delete_prompt(prompt_id: str, db: Session = Depends(get_db)):
    """Delete a prompt, doc, or research item"""
    db_prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not db_prompt:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(db_prompt)
    db.commit()
    return {"message": "Deleted successfully"}
