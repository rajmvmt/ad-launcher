"""
Image Sanitizer API Endpoints

Provides three levels of image sanitization:
  Level 1: Quick Clean — metadata stripping only (lossless)
  Level 2: Deep Clean — metadata + pixel re-encode (breaks simple watermarks)
  Level 3: Full Scrub — metadata + noise + transforms (degrades AI watermarks)
"""

import io
import os
import uuid
import logging
from typing import Optional, List

import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import Response
from pathlib import Path

from app.services.image_sanitizer import sanitize_image, analyze_image
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB for sanitizer (larger than normal upload)

UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "uploads"
UPLOAD_DIR = UPLOAD_DIR.resolve()
os.makedirs(UPLOAD_DIR, mode=0o755, exist_ok=True)


def _get_s3_client():
    """Get R2/S3 client if configured."""
    if not settings.r2_enabled:
        return None
    import boto3
    return boto3.client(
        's3',
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name='auto'
    )


async def _save_file(content: bytes, extension: str) -> str:
    """Save sanitized file to R2 or local uploads, return URL."""
    filename = f"sanitized_{uuid.uuid4()}{extension}"

    if settings.r2_enabled:
        client = _get_s3_client()
        content_types = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp'
        }
        client.put_object(
            Bucket=settings.R2_BUCKET_NAME,
            Key=filename,
            Body=content,
            ContentType=content_types.get(extension, 'application/octet-stream')
        )
        return f"{settings.R2_PUBLIC_URL}/{filename}"
    else:
        file_path = UPLOAD_DIR / filename
        with open(file_path, "wb") as f:
            f.write(content)
        return f"/uploads/{filename}"


async def _fetch_image_from_url(url: str) -> tuple[bytes, str]:
    """Download image from URL, return (content, extension)."""
    # Handle local uploads
    if url.startswith("/uploads/"):
        file_path = UPLOAD_DIR / os.path.basename(url)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Image file not found")
        content = file_path.read_bytes()
        ext = os.path.splitext(url)[1].lower()
        return content, ext

    # Handle remote URLs
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch image from URL (status {resp.status_code})")
        content = resp.content
        ext = os.path.splitext(url.split("?")[0])[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            # Try to detect from content type
            ct = resp.headers.get("content-type", "")
            ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
            ext = ext_map.get(ct.split(";")[0].strip(), ".jpg")
        return content, ext


@router.post("/clean")
async def clean_image(
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    level: int = Form(2),
    quality: int = Form(92),
    noise_sigma: float = Form(3.0),
    save: bool = Form(True),
):
    """Sanitize a single image.

    Upload a file OR provide a URL. Returns the cleaned image URL and a report.

    Levels:
    - 1: Quick Clean (metadata only, lossless)
    - 2: Deep Clean (metadata + re-encode)
    - 3: Full Scrub (metadata + noise + transforms for AI watermarks)
    """
    if not file and not url:
        raise HTTPException(status_code=400, detail="Provide either a file upload or a URL")

    if level not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Level must be 1, 2, or 3")

    try:
        if file:
            filename = os.path.basename(file.filename or "image.jpg")
            ext = os.path.splitext(filename)[1].lower()
            if ext not in ALLOWED_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")
            content = await file.read(MAX_FILE_SIZE + 1)
            if len(content) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail=f"File too large. Max {MAX_FILE_SIZE // (1024*1024)}MB")
        else:
            content, ext = await _fetch_image_from_url(url)
            filename = f"image{ext}"

        # Sanitize
        cleaned_bytes, report = sanitize_image(
            content, filename, level=level, quality=quality, noise_sigma=noise_sigma
        )

        report["original_size"] = len(content)
        report["cleaned_size"] = len(cleaned_bytes)
        report["size_change"] = f"{((len(cleaned_bytes) - len(content)) / len(content) * 100):.1f}%"

        if save:
            cleaned_url = await _save_file(cleaned_bytes, ext)
            return {"url": cleaned_url, "report": report}
        else:
            # Return the image directly
            content_types = {
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp'
            }
            return Response(
                content=cleaned_bytes,
                media_type=content_types.get(ext, 'application/octet-stream'),
                headers={"X-Sanitizer-Report": str(report)}
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Image sanitization failed")
        raise HTTPException(status_code=500, detail=f"Sanitization failed: {str(e)}")


@router.post("/batch")
async def batch_clean(
    urls: str = Form(...),
    level: int = Form(2),
    quality: int = Form(92),
):
    """Batch sanitize multiple images by URL.

    Pass URLs as comma-separated string.
    """
    if level not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Level must be 1, 2, or 3")

    url_list = [u.strip() for u in urls.split(",") if u.strip()]
    if not url_list:
        raise HTTPException(status_code=400, detail="No URLs provided")
    if len(url_list) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 images per batch")

    results = []
    for image_url in url_list:
        try:
            content, ext = await _fetch_image_from_url(image_url)
            cleaned_bytes, report = sanitize_image(
                content, f"image{ext}", level=level, quality=quality
            )
            cleaned_url = await _save_file(cleaned_bytes, ext)
            results.append({
                "original_url": image_url,
                "cleaned_url": cleaned_url,
                "report": report,
                "success": True,
            })
        except Exception as e:
            logger.warning(f"Failed to sanitize {image_url}: {e}")
            results.append({
                "original_url": image_url,
                "error": str(e),
                "success": False,
            })

    return {
        "total": len(url_list),
        "success": sum(1 for r in results if r["success"]),
        "failed": sum(1 for r in results if not r["success"]),
        "results": results,
    }


@router.post("/analyze")
async def analyze(
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
):
    """Analyze an image for metadata, C2PA, and watermark indicators.

    Returns a detailed report of what was found without modifying the image.
    """
    if not file and not url:
        raise HTTPException(status_code=400, detail="Provide either a file upload or a URL")

    try:
        if file:
            filename = os.path.basename(file.filename or "image.jpg")
            content = await file.read(MAX_FILE_SIZE + 1)
            if len(content) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail="File too large")
        else:
            content, ext = await _fetch_image_from_url(url)
            filename = f"image{ext}"

        report = analyze_image(content, filename)
        return report

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Image analysis failed")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
