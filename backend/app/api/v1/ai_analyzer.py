"""AI Analyzer — deep analysis of ad creatives + create similar."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from app.database import get_db
from app.models import SwipeFile, Brand, Product, CustomerProfile, User
from app.core.deps import get_current_active_user

router = APIRouter()


# ── Request Schemas ──────────────────────────────────────────────────

class CreateSimilarRequest(BaseModel):
    swipe_id: Optional[str] = None
    deep_analysis: Optional[dict] = None
    brand_id: str
    product_id: str
    profile_id: str
    variation_count: int = 3
    model: str = "sonnet"


class GenerateSimilarImagesRequest(BaseModel):
    image_prompt: str
    count: int = 1
    image_sizes: List[dict] = [{"width": 1080, "height": 1080, "name": "Square"}]
    model: str = "nano-banana-pro"


# ── Deep Analyze Swipe ───────────────────────────────────────────────

@router.post("/{swipe_id}/analyze")
async def deep_analyze_swipe(
    swipe_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Run deep two-pass analysis on a swipe file entry."""
    from app.services.deep_analyzer import deep_analyze_ad

    swipe = db.query(SwipeFile).filter(SwipeFile.id == swipe_id).first()
    if not swipe:
        raise HTTPException(status_code=404, detail="Swipe not found")

    result = await deep_analyze_ad(
        image_url=swipe.image_url or swipe.thumbnail_url,
        video_url=swipe.video_url,
        headline=swipe.headline,
        primary_text=swipe.primary_text,
        cta_text=swipe.cta_text,
        description=swipe.description,
    )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    swipe.deep_analysis = result
    db.commit()
    db.refresh(swipe)

    return {"swipe_id": swipe.id, "deep_analysis": result}


# ── Deep Analyze Upload ──────────────────────────────────────────────

@router.post("/analyze-upload")
async def analyze_upload(
    file: UploadFile = File(...),
    headline: Optional[str] = Form(None),
    primary_text: Optional[str] = Form(None),
    cta_text: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    current_user: User = Depends(get_current_active_user),
):
    """Analyze an uploaded image/video without saving to swipe file."""
    from app.services.deep_analyzer import deep_analyze_ad

    data = await file.read()
    content_type = file.content_type or "image/jpeg"

    is_video = content_type.startswith("video/")

    if is_video:
        # For video, write to temp file and pass URL
        import tempfile, os
        ext = ".mp4" if "mp4" in content_type else ".mov"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            result = await deep_analyze_ad(
                video_url=f"file://{tmp_path}",
                headline=headline,
                primary_text=primary_text,
                cta_text=cta_text,
                description=description,
            )
        finally:
            os.unlink(tmp_path)
    else:
        result = await deep_analyze_ad(
            image_data=data,
            mime_type=content_type,
            headline=headline,
            primary_text=primary_text,
            cta_text=cta_text,
            description=description,
        )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return {"deep_analysis": result}


# ── Create Similar Copy ──────────────────────────────────────────────

@router.post("/create-similar")
async def create_similar(
    request: CreateSimilarRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate copy variations based on deep analysis + brand context."""
    from app.services.deep_analyzer import generate_similar_copy, build_image_generation_prompt

    # Get the deep analysis
    analysis = request.deep_analysis
    if not analysis and request.swipe_id:
        swipe = db.query(SwipeFile).filter(SwipeFile.id == request.swipe_id).first()
        if not swipe:
            raise HTTPException(status_code=404, detail="Swipe not found")
        analysis = swipe.deep_analysis
        if not analysis:
            raise HTTPException(status_code=400, detail="Swipe has no deep analysis. Run analyze first.")

    if not analysis:
        raise HTTPException(status_code=400, detail="Provide swipe_id or deep_analysis")

    # Load brand, product, profile
    brand = db.query(Brand).filter(Brand.id == request.brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    product = db.query(Product).filter(Product.id == request.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    profile = db.query(CustomerProfile).filter(CustomerProfile.id == request.profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    brand_dict = {"name": brand.name, "voice": brand.voice or ""}
    product_dict = {"name": product.name, "description": product.description or ""}
    profile_dict = {
        "demographics": profile.demographics or "",
        "pain_points": profile.pain_points or "",
        "goals": profile.goals or "",
    }

    copy_result = await generate_similar_copy(
        deep_analysis=analysis,
        brand=brand_dict,
        product=product_dict,
        profile=profile_dict,
        variation_count=request.variation_count,
        model=request.model,
    )

    image_prompt = build_image_generation_prompt(analysis, brand_dict, product_dict)

    return {
        "copy_variations": copy_result.get("variations", []),
        "image_prompt": image_prompt,
    }


# ── Generate Similar Images ──────────────────────────────────────────

@router.post("/generate-similar-images")
async def generate_similar_images(
    request: GenerateSimilarImagesRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Generate images based on recreation blueprint prompt."""
    from app.api.v1.generated_ads import (
        _generate_with_fal_sync,
        _generate_with_imagen_sync,
        get_fal_aspect_ratio,
    )
    from app.core.config import settings

    try:
        import fal_client
    except ImportError:
        fal_client = None

    try:
        from google import genai as genai_img
        from google.genai import types as genai_types
    except ImportError:
        genai_img = None
        genai_types = None

    use_fal = request.model == "nano-banana-pro" and settings.fal_enabled and fal_client
    use_imagen = request.model == "imagen4" and settings.imagen_enabled and genai_img

    if not use_fal and not use_imagen:
        if settings.fal_enabled and fal_client:
            use_fal = True
        elif settings.imagen_enabled and genai_img:
            use_imagen = True
        else:
            raise HTTPException(status_code=400, detail="No image generation backend available")

    images = []
    for size in request.image_sizes[:request.count]:
        w = size.get("width", 1080)
        h = size.get("height", 1080)
        name = size.get("name", f"{w}x{h}")

        try:
            if use_fal:
                url = _generate_with_fal_sync(request.image_prompt, w, h, "1K")
            else:
                ar = get_fal_aspect_ratio(w, h)
                imagen_client = genai_img.Client(api_key=settings.GEMINI_API_KEY)
                url = _generate_with_imagen_sync(imagen_client, request.image_prompt, w, h, ar)

            images.append({"url": url, "size": name, "width": w, "height": h})
        except Exception as e:
            print(f"[ai_analyzer] Image generation failed for {name}: {e}")
            images.append({"url": None, "size": name, "error": str(e)})

    return {"images": images}
