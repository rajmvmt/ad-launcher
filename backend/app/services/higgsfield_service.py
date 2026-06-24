"""
Higgsfield AI Service - Image generation & Image-to-Video generation.
Uses the higgsfield_client SDK for image gen and platform API for video.
"""
import os
import uuid
import httpx
import requests as req
from pathlib import Path
from typing import Optional

import higgsfield_client

BASE_URL = "https://platform.higgsfield.ai"
TIMEOUT = 30.0
UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

SUPPORTED_IMAGE_MODELS = [
    "higgsfield/soul-2.0",
    "higgsfield/soul-cinema",
    "higgsfield/popcorn",
    "fal-ai/nano-banana-2",
    "fal-ai/nano-banana-pro",
    "fal-ai/recraft-v4.1",
    "fal-ai/flux-2",
    "fal-ai/seedream-5.0-lite",
    "google/gpt-image-2",
    "openai/gpt-image-1.5",
    "xai/grok-imagine",
]


def _get_headers():
    api_key = os.getenv("HIGGSFIELD_API_KEY")
    secret = os.getenv("HIGGSFIELD_API_SECRET")
    if not api_key or not secret:
        raise ValueError("HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET must be set")
    return {
        "hf-api-key": api_key,
        "hf-secret": secret,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def generate_image_sync(
    prompt: str,
    model: str = "higgsfield/soul-2.0",
    aspect_ratio: str = "1:1",
    num_images: int = 1,
) -> list[str]:
    """
    Generate images via Higgsfield's model hub.
    Returns list of local URL paths (/uploads/...).
    """
    os.environ["HIGGSFIELD_API_KEY"] = os.getenv("HIGGSFIELD_API_KEY", "")
    os.environ["HIGGSFIELD_API_SECRET"] = os.getenv("HIGGSFIELD_API_SECRET", "")

    result = higgsfield_client.subscribe(
        model,
        arguments={
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "num_images": num_images,
            "output_format": "png",
        },
    )

    images = result.get("images") or result.get("output", [])
    if not images:
        raise RuntimeError(f"Higgsfield returned no images from {model}")

    local_urls = []
    for img in images:
        url = img if isinstance(img, str) else img.get("url", "")
        if not url:
            continue
        resp = req.get(url, timeout=60)
        resp.raise_for_status()
        filename = f"hf_{uuid.uuid4()}.png"
        with open(UPLOAD_DIR / filename, "wb") as f:
            f.write(resp.content)
        local_urls.append(f"/uploads/{filename}")

    return local_urls


async def list_motions():
    """Get available video motion presets (zoom, dolly, pan, etc.)"""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(f"{BASE_URL}/v1/motions", headers=_get_headers())
        resp.raise_for_status()
        return resp.json()


async def generate_video(
    image_url: str,
    motion_id: str,
    prompt: str = "",
    model: str = "dop-lite",
    strength: float = 0.5,
) -> dict:
    """
    Submit image-to-video generation job.

    Args:
        image_url: Public URL of the source image
        motion_id: Motion preset ID (from list_motions)
        prompt: Description of the scene (auto-generated if empty)
        model: dop-lite (cheapest), dop-turbo, or dop-preview
        strength: Motion intensity 0.0-1.0

    Returns:
        Job response with id for polling
    """
    if not prompt:
        prompt = "Cinematic video with smooth natural motion"

    request_body = {
        "params": {
            "model": model,
            "prompt": prompt,
            "input_images": [{"type": "image_url", "image_url": image_url}],
            "motions": [{"id": motion_id, "strength": strength}],
        }
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            f"{BASE_URL}/v1/image2video/dop",
            headers=_get_headers(),
            json=request_body,
        )
        resp.raise_for_status()
        return resp.json()


async def get_job_status(job_id: str) -> dict:
    """Check status of a generation job. Returns status + results when done."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            f"{BASE_URL}/v1/job-sets/{job_id}",
            headers=_get_headers(),
        )
        resp.raise_for_status()
        return resp.json()


def is_configured() -> bool:
    """Check if Higgsfield credentials are set."""
    return bool(os.getenv("HIGGSFIELD_API_KEY") and os.getenv("HIGGSFIELD_API_SECRET"))
