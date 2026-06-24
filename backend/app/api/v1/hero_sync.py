"""Hero Sync — dynamic hero image swapping for landing pages based on ad creative."""
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import HeroMap, HeroMapEntry, Persona, PersonaImage, User
from app.core.deps import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CreateHeroMapRequest(BaseModel):
    name: str
    brand_id: Optional[str] = None
    landing_page_url: Optional[str] = None
    image_selector: str = "img"
    param_name: str = "img"
    base_image_url: Optional[str] = None  # Doctor/base image
    layout: str = "side_by_side"  # side_by_side, left_base, right_base


class UpdateHeroMapRequest(BaseModel):
    name: Optional[str] = None
    brand_id: Optional[str] = None
    landing_page_url: Optional[str] = None
    image_selector: Optional[str] = None
    param_name: Optional[str] = None
    base_image_url: Optional[str] = None
    layout: Optional[str] = None


class AddEntryRequest(BaseModel):
    key: str
    image_url: str
    label: Optional[str] = None


class UpdateEntryRequest(BaseModel):
    key: Optional[str] = None
    image_url: Optional[str] = None
    label: Optional[str] = None


class BulkAddEntriesRequest(BaseModel):
    entries: List[AddEntryRequest]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _serialize_map(m: HeroMap) -> dict:
    return {
        "id": m.id,
        "brand_id": m.brand_id,
        "name": m.name,
        "landing_page_url": m.landing_page_url,
        "image_selector": m.image_selector,
        "param_name": m.param_name,
        "base_image_url": m.base_image_url,
        "layout": m.layout,
        "entry_count": len(m.entries) if m.entries else 0,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


def _serialize_entry(e: HeroMapEntry) -> dict:
    return {
        "id": e.id,
        "hero_map_id": e.hero_map_id,
        "persona_id": e.persona_id,
        "key": e.key,
        "image_url": e.image_url,
        "label": e.label,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _generate_snippet(hero_map: HeroMap) -> str:
    """Generate the JS snippet to paste into LanderLab."""
    entries = hero_map.entries or []
    if not entries:
        return "// No image entries configured yet"

    # Build the mapping object as JSON-like string (compact, single line)
    import json
    map_obj = {}
    for e in entries:
        map_obj[e.key] = e.image_url
    map_json = json.dumps(map_obj, separators=(',', ':'))

    param = hero_map.param_name or "img"
    selector = hero_map.image_selector or "img"

    # Hybrid approach: immediately swap any existing hero image, PLUS MutationObserver
    # for images not yet in DOM. Works whether script is in head or body.
    # Preloads new image so browser starts downloading it ASAP.
    return (
        f'<script>'
        f'!function(){{var p=new URLSearchParams(window.location.search);'
        f'var k=p.get("{param}");if(!k)return;'
        f'var m={map_json};'
        f'var u=m[k];if(!u)return;'
        # Preload the new image immediately
        f'var l=document.createElement("link");l.rel="preload";l.as="image";l.href=u;document.head.appendChild(l);'
        # Helper: check if img is a hero (not logo/svg/icon/star)
        f'function isHero(e){{var x=(e.src||e.getAttribute("src")||"").toLowerCase();'
        f'return x.indexOf(".svg")<0&&x.indexOf("logo")<0&&x.indexOf("icon")<0&&x.indexOf("star")<0}}'
        # Helper: swap the image
        f'var d=false;function swap(e){{if(d)return;e.src=u;e.srcset="";d=true}}'
        # 1) Immediately check all existing images on the page
        f'var a=document.querySelectorAll("{selector}");'
        f'for(var i=0;i<a.length;i++){{if(isHero(a[i])){{swap(a[i]);break}}}}'
        # 2) MutationObserver for images added later (if script is in head)
        f'if(!d){{var o=new MutationObserver(function(muts){{if(d){{o.disconnect();return}}'
        f'for(var j=0;j<muts.length;j++){{var nodes=muts[j].addedNodes;'
        f'for(var n=0;n<nodes.length;n++){{var el=nodes[n];'
        f'var imgs=[];if(el.tagName==="IMG")imgs.push(el);'
        f'else if(el.querySelectorAll)imgs=el.querySelectorAll("{selector}");'
        f'for(var i=0;i<imgs.length;i++){{if(isHero(imgs[i])){{swap(imgs[i]);o.disconnect();return}}}}'
        f'}}}}}});'
        f'o.observe(document.documentElement,{{childList:true,subtree:true}})}}'
        f'}}();</script>'
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/maps")
def create_hero_map(
    data: CreateHeroMapRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    hero_map = HeroMap(
        name=data.name,
        brand_id=data.brand_id,
        landing_page_url=data.landing_page_url,
        image_selector=data.image_selector,
        param_name=data.param_name,
        base_image_url=data.base_image_url,
        layout=data.layout,
    )
    db.add(hero_map)
    db.commit()
    db.refresh(hero_map)
    return _serialize_map(hero_map)


@router.get("/maps")
def list_hero_maps(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    maps = db.query(HeroMap).order_by(HeroMap.created_at.desc()).all()
    return [_serialize_map(m) for m in maps]


@router.get("/maps/{map_id}")
def get_hero_map(
    map_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    m = db.query(HeroMap).filter(HeroMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Hero map not found")

    result = _serialize_map(m)
    result["entries"] = [_serialize_entry(e) for e in (m.entries or [])]
    result["snippet"] = _generate_snippet(m)
    return result


@router.put("/maps/{map_id}")
def update_hero_map(
    map_id: str,
    data: UpdateHeroMapRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    m = db.query(HeroMap).filter(HeroMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Hero map not found")

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(m, key, value)
    db.commit()
    db.refresh(m)
    return _serialize_map(m)


@router.delete("/maps/{map_id}")
def delete_hero_map(
    map_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    m = db.query(HeroMap).filter(HeroMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Hero map not found")
    db.delete(m)
    db.commit()
    return {"message": "Hero map deleted"}


# ─── Entries ──────────────────────────────────────────────────────────────────

@router.post("/maps/{map_id}/entries")
async def add_entry(
    map_id: str,
    data: AddEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    import uuid

    m = db.query(HeroMap).filter(HeroMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Hero map not found")

    # Check for duplicate key
    existing = db.query(HeroMapEntry).filter(
        HeroMapEntry.hero_map_id == map_id,
        HeroMapEntry.key == data.key,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Key '{data.key}' already exists in this map")

    # Optimize image: compress to JPEG, resize to max 1200px
    filename = f"hero-sync/{map_id}/{data.key}_{uuid.uuid4().hex[:8]}.jpg"
    optimized_url = await _optimize_and_upload(data.image_url, filename)

    entry = HeroMapEntry(
        hero_map_id=map_id,
        key=data.key,
        image_url=optimized_url,
        label=data.label,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _serialize_entry(entry)


@router.post("/maps/{map_id}/entries/bulk")
def bulk_add_entries(
    map_id: str,
    data: BulkAddEntriesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    m = db.query(HeroMap).filter(HeroMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Hero map not found")

    added = 0
    for entry_data in data.entries:
        existing = db.query(HeroMapEntry).filter(
            HeroMapEntry.hero_map_id == map_id,
            HeroMapEntry.key == entry_data.key,
        ).first()
        if existing:
            continue
        entry = HeroMapEntry(
            hero_map_id=map_id,
            key=entry_data.key,
            image_url=entry_data.image_url,
            label=entry_data.label,
        )
        db.add(entry)
        added += 1

    db.commit()
    return {"message": f"Added {added} entries", "added": added}


@router.put("/entries/{entry_id}")
def update_entry(
    entry_id: str,
    data: UpdateEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    entry = db.query(HeroMapEntry).filter(HeroMapEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(entry, key, value)
    db.commit()
    db.refresh(entry)
    return _serialize_entry(entry)


@router.delete("/entries/{entry_id}")
def delete_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    entry = db.query(HeroMapEntry).filter(HeroMapEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"message": "Entry deleted"}


# ─── Snippet ──────────────────────────────────────────────────────────────────

@router.get("/maps/{map_id}/snippet")
def get_snippet(
    map_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get just the JS snippet for a hero map."""
    m = db.query(HeroMap).filter(HeroMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Hero map not found")

    return {"snippet": _generate_snippet(m)}


# ─── Composite Generation ─────────────────────────────────────────────────────

class GenerateCompositesRequest(BaseModel):
    image_urls: List[str]  # before/after image URLs to combine with base
    keys: List[str]  # corresponding keys for each
    labels: Optional[List[str]] = None  # optional labels


def _optimize_image(img_bytes: bytes, max_width: int = 800, quality: int = 70) -> bytes:
    """Compress and resize image to JPEG for fast loading on landing pages."""
    from PIL import Image as PILImage
    import io

    img = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")
    if img.width > max_width:
        ratio = max_width / img.width
        img = img.resize((max_width, int(img.height * ratio)), PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


async def _optimize_and_upload(image_url: str, filename: str) -> str:
    """Download an image, optimize it, and re-upload to R2."""
    import httpx
    from app.core.config import settings

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(image_url)
        if resp.status_code != 200:
            return image_url  # fallback to original
        optimized = _optimize_image(resp.content)

    if settings.r2_enabled:
        from app.api.v1.uploads import upload_to_r2
        return await upload_to_r2(optimized, filename, "image/jpeg")
    else:
        from app.api.v1.uploads import upload_to_local
        return await upload_to_local(optimized, filename)


def _create_composite(base_bytes: bytes, overlay_bytes: bytes, layout: str = "side_by_side") -> bytes:
    """Stitch a base image and overlay image into a composite."""
    from PIL import Image as PILImage
    import io

    base = PILImage.open(io.BytesIO(base_bytes)).convert("RGB")
    overlay = PILImage.open(io.BytesIO(overlay_bytes)).convert("RGB")

    if layout == "left_base":
        # Base on left, overlay on right
        target_h = max(base.height, overlay.height)
        # Scale both to same height
        base_w = int(base.width * (target_h / base.height))
        overlay_w = int(overlay.width * (target_h / overlay.height))
        base = base.resize((base_w, target_h), PILImage.LANCZOS)
        overlay = overlay.resize((overlay_w, target_h), PILImage.LANCZOS)
        composite = PILImage.new("RGB", (base_w + overlay_w, target_h))
        composite.paste(base, (0, 0))
        composite.paste(overlay, (base_w, 0))
    elif layout == "right_base":
        # Overlay on left, base on right
        target_h = max(base.height, overlay.height)
        base_w = int(base.width * (target_h / base.height))
        overlay_w = int(overlay.width * (target_h / overlay.height))
        base = base.resize((base_w, target_h), PILImage.LANCZOS)
        overlay = overlay.resize((overlay_w, target_h), PILImage.LANCZOS)
        composite = PILImage.new("RGB", (overlay_w + base_w, target_h))
        composite.paste(overlay, (0, 0))
        composite.paste(base, (overlay_w, 0))
    else:
        # side_by_side: 50/50 split, same height
        target_h = max(base.height, overlay.height)
        half_w = max(base.width, overlay.width)
        base = base.resize((half_w, target_h), PILImage.LANCZOS)
        overlay = overlay.resize((half_w, target_h), PILImage.LANCZOS)
        composite = PILImage.new("RGB", (half_w * 2, target_h))
        composite.paste(base, (0, 0))
        composite.paste(overlay, (half_w, 0))

    # Resize if wider than 1200px
    if composite.width > 1200:
        ratio = 1200 / composite.width
        composite = composite.resize((1200, int(composite.height * ratio)), PILImage.LANCZOS)

    buf = io.BytesIO()
    composite.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


@router.post("/maps/{map_id}/generate-composites")
async def generate_composites(
    map_id: str,
    data: GenerateCompositesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate composite images by stitching base image with each provided image."""
    import httpx
    import uuid

    m = db.query(HeroMap).filter(HeroMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Hero map not found")

    if not m.base_image_url:
        raise HTTPException(status_code=400, detail="Set a base image on this map first")

    if len(data.image_urls) != len(data.keys):
        raise HTTPException(status_code=400, detail="image_urls and keys must be the same length")

    from app.core.config import settings

    # Fetch base image
    async with httpx.AsyncClient(timeout=30) as client:
        base_resp = await client.get(m.base_image_url)
        if base_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch base image")
        base_bytes = base_resp.content

        created = []
        for i, (img_url, key) in enumerate(zip(data.image_urls, data.keys)):
            # Check for duplicate key
            existing = db.query(HeroMapEntry).filter(
                HeroMapEntry.hero_map_id == map_id,
                HeroMapEntry.key == key,
            ).first()
            if existing:
                continue

            # Fetch overlay image
            overlay_resp = await client.get(img_url)
            if overlay_resp.status_code != 200:
                logger.warning(f"Failed to fetch image: {img_url}")
                continue

            # Generate composite
            composite_bytes = _create_composite(base_bytes, overlay_resp.content, m.layout or "side_by_side")

            # Upload to R2
            filename = f"hero-sync/{m.id}/{key}_{uuid.uuid4().hex[:8]}.jpg"

            if settings.r2_enabled:
                from app.api.v1.uploads import upload_to_r2
                composite_url = await upload_to_r2(composite_bytes, filename, "image/jpeg")
            else:
                from app.api.v1.uploads import upload_to_local
                composite_url = await upload_to_local(composite_bytes, filename)

            # Create entry
            label = data.labels[i] if data.labels and i < len(data.labels) else None
            entry = HeroMapEntry(
                hero_map_id=map_id,
                key=key,
                image_url=composite_url,
                label=label,
            )
            db.add(entry)
            created.append(key)

    db.commit()

    # Reload map
    db.refresh(m)
    return {
        "message": f"Generated {len(created)} composite images",
        "created": created,
        "total_entries": len(m.entries),
    }


# ─── Import All Personas ─────────────────────────────────────────────────────

@router.post("/import-personas")
def import_all_personas(
    brand_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Import all existing personas' before_after images into hero maps.

    Groups by brand — creates one hero map per brand if needed.
    Skips personas that already have entries in the map.
    """
    from app.services.hero_sync_service import sync_persona_to_hero_map

    q = db.query(Persona).filter(Persona.brand_id.isnot(None))
    if brand_id:
        q = q.filter(Persona.brand_id == brand_id)

    personas = q.all()
    total_added = 0
    results = []

    for persona in personas:
        added = sync_persona_to_hero_map(persona, db)
        if added:
            results.append({"persona": persona.name, "entries_added": added})
        total_added += added

    db.commit()
    return {
        "message": f"Imported {total_added} entries from {len(personas)} personas",
        "total_entries_added": total_added,
        "details": results,
    }
