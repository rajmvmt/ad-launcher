"""
Higgsfield AI API endpoints - Image-to-Video generation
"""
import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from app.api.v1.auth import get_current_active_user
from app.services import higgsfield_service

logger = logging.getLogger(__name__)

router = APIRouter()


class GenerateImageRequest(BaseModel):
    prompt: str
    model: Optional[str] = "higgsfield/soul-2.0"
    aspect_ratio: Optional[str] = "1:1"
    num_images: Optional[int] = 1


class GenerateVideoRequest(BaseModel):
    image_url: str
    motion_id: str
    prompt: Optional[str] = ""
    model: Optional[str] = "dop-lite"
    strength: Optional[float] = 0.5


@router.get("/models")
async def get_image_models(user=Depends(get_current_active_user)):
    """List available image generation models."""
    return {"models": higgsfield_service.SUPPORTED_IMAGE_MODELS}


@router.post("/generate-image")
async def generate_image(
    req: GenerateImageRequest,
    user=Depends(get_current_active_user),
):
    """Generate images using Higgsfield's model hub."""
    if not higgsfield_service.is_configured():
        raise HTTPException(status_code=503, detail="Higgsfield API not configured")
    try:
        urls = higgsfield_service.generate_image_sync(
            prompt=req.prompt,
            model=req.model,
            aspect_ratio=req.aspect_ratio,
            num_images=req.num_images,
        )
        return {"images": [{"url": u} for u in urls]}
    except Exception as e:
        logger.exception("Higgsfield image generation error")
        raise HTTPException(status_code=502, detail=f"Image generation failed: {e}")


@router.get("/status")
async def get_status(user=Depends(get_current_active_user)):
    """Check if Higgsfield is configured."""
    return {"configured": higgsfield_service.is_configured()}


@router.get("/motions")
async def get_motions(user=Depends(get_current_active_user)):
    """List available motion presets."""
    if not higgsfield_service.is_configured():
        raise HTTPException(status_code=503, detail="Higgsfield API not configured")
    try:
        motions = await higgsfield_service.list_motions()
        return motions
    except Exception as e:
        logger.exception("Higgsfield motions error")
        raise HTTPException(status_code=502, detail="Higgsfield API error")


@router.post("/generate-video")
async def generate_video(
    req: GenerateVideoRequest,
    user=Depends(get_current_active_user),
):
    """Submit an image-to-video generation job."""
    if not higgsfield_service.is_configured():
        raise HTTPException(status_code=503, detail="Higgsfield API not configured")
    try:
        result = await higgsfield_service.generate_video(
            image_url=req.image_url,
            motion_id=req.motion_id,
            prompt=req.prompt,
            model=req.model,
            strength=req.strength,
        )
        return result
    except Exception as e:
        err_msg = str(e)
        if "Not enough credits" in err_msg or "403" in err_msg:
            raise HTTPException(status_code=402, detail="Not enough Higgsfield credits. Add credits at cloud.higgsfield.ai")
        logger.exception("Higgsfield generate-video error")
        raise HTTPException(status_code=502, detail="Higgsfield API error")


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user=Depends(get_current_active_user)):
    """Check status of a video generation job."""
    if not higgsfield_service.is_configured():
        raise HTTPException(status_code=503, detail="Higgsfield API not configured")
    try:
        result = await higgsfield_service.get_job_status(job_id)
        return result
    except Exception as e:
        logger.exception("Higgsfield job status error")
        raise HTTPException(status_code=502, detail="Higgsfield API error")
