"""Image and Video Uniqueizer — modify media for fingerprint uniqueness."""
import io
import os
import random
import struct
import subprocess
import tempfile
import logging
from typing import Optional

from PIL import Image, ImageFilter, ImageEnhance
import numpy as np

logger = logging.getLogger(__name__)

# ── Image Uniqueizer ───────────────────────────────────


def uniqueize_image(image_bytes: bytes, degree: str = "medium") -> bytes:
    """
    Modify an image to make it unique to platform fingerprinting.

    degree: 'light', 'medium', or 'strong'
    Returns: modified image bytes (PNG).
    """
    img = Image.open(io.BytesIO(image_bytes))

    # Convert to RGB if necessary
    if img.mode in ("RGBA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "RGBA":
            background.paste(img, mask=img.split()[3])
        else:
            background.paste(img)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Strip EXIF metadata by rebuilding
    data = list(img.getdata())
    clean_img = Image.new(img.mode, img.size)
    clean_img.putdata(data)
    img = clean_img

    if degree == "light":
        img = _light_uniqueize(img)
    elif degree == "strong":
        img = _strong_uniqueize(img)
    else:  # medium
        img = _medium_uniqueize(img)

    # Save to bytes
    output = io.BytesIO()
    img.save(output, format="PNG", optimize=True)
    output.seek(0)
    return output.getvalue()


def _light_uniqueize(img: Image.Image) -> Image.Image:
    """Light modifications — barely visible."""
    # Slight brightness shift
    enhancer = ImageEnhance.Brightness(img)
    img = enhancer.enhance(random.uniform(0.98, 1.02))

    # Add 1px invisible border by cropping/expanding
    w, h = img.size
    img = img.crop((1, 1, w - 1, h - 1))
    img = img.resize((w, h), Image.LANCZOS)

    # Noise: change a few random pixels by 1 value
    arr = np.array(img)
    num_pixels = max(1, (w * h) // 500)
    for _ in range(num_pixels):
        x, y = random.randint(0, w - 1), random.randint(0, h - 1)
        c = random.randint(0, 2)
        arr[y, x, c] = min(255, max(0, int(arr[y, x, c]) + random.choice([-1, 1])))
    return Image.fromarray(arr)


def _medium_uniqueize(img: Image.Image) -> Image.Image:
    """Medium modifications — subtle but effective."""
    # Color shift
    enhancer = ImageEnhance.Color(img)
    img = enhancer.enhance(random.uniform(0.95, 1.05))

    # Brightness shift
    enhancer = ImageEnhance.Brightness(img)
    img = enhancer.enhance(random.uniform(0.97, 1.03))

    # Contrast shift
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(random.uniform(0.97, 1.03))

    # Slight rotation and crop back
    angle = random.uniform(-0.5, 0.5)
    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(255, 255, 255))

    # Noise injection
    arr = np.array(img)
    noise = np.random.normal(0, 1.5, arr.shape).astype(np.int16)
    arr = np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    return Image.fromarray(arr)


def _strong_uniqueize(img: Image.Image) -> Image.Image:
    """Strong modifications — more aggressive changes."""
    # Apply medium first
    img = _medium_uniqueize(img)

    # Additional slight blur
    img = img.filter(ImageFilter.GaussianBlur(radius=0.3))

    # Sharpness adjustment
    enhancer = ImageEnhance.Sharpness(img)
    img = enhancer.enhance(random.uniform(0.9, 1.1))

    # Slight crop (2-3px on each side)
    w, h = img.size
    crop_px = random.randint(2, 4)
    img = img.crop((crop_px, crop_px, w - crop_px, h - crop_px))
    img = img.resize((w, h), Image.LANCZOS)

    # Heavier noise
    arr = np.array(img)
    noise = np.random.normal(0, 3, arr.shape).astype(np.int16)
    arr = np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    return Image.fromarray(arr)


# ── Video Uniqueizer ───────────────────────────────────


def uniqueize_video(video_bytes: bytes, degree: str = "medium", original_ext: str = ".mp4") -> bytes:
    """
    Modify a video to make it unique. Uses FFmpeg.

    degree: 'light', 'medium', or 'strong'
    Returns: modified video bytes.
    """
    # Write input to temp file
    with tempfile.NamedTemporaryFile(suffix=original_ext, delete=False) as inp:
        inp.write(video_bytes)
        input_path = inp.name

    output_path = input_path + "_out.mp4"

    try:
        filters = _get_video_filters(degree)
        cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-vf", filters,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", str(random.randint(22, 26)),  # Slight quality variation
            "-c:a", "aac",
            "-b:a", "128k",
            "-map_metadata", "-1",  # Strip metadata
            "-movflags", "+faststart",
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            logger.error(f"FFmpeg failed: {result.stderr.decode()[:500]}")
            raise RuntimeError("Video processing failed")

        with open(output_path, "rb") as f:
            return f.read()
    finally:
        for path in [input_path, output_path]:
            try:
                os.unlink(path)
            except OSError:
                pass


def _get_video_filters(degree: str) -> str:
    """Build FFmpeg filter chain based on degree."""
    if degree == "light":
        brightness = random.uniform(-0.01, 0.01)
        contrast = random.uniform(0.99, 1.01)
        return f"eq=brightness={brightness}:contrast={contrast}"
    elif degree == "strong":
        brightness = random.uniform(-0.03, 0.03)
        contrast = random.uniform(0.97, 1.03)
        saturation = random.uniform(0.95, 1.05)
        hue = random.uniform(-2, 2)
        noise_amount = random.randint(3, 8)
        return f"eq=brightness={brightness}:contrast={contrast}:saturation={saturation},hue=h={hue},noise=alls={noise_amount}:allf=t"
    else:  # medium
        brightness = random.uniform(-0.02, 0.02)
        contrast = random.uniform(0.98, 1.02)
        saturation = random.uniform(0.97, 1.03)
        return f"eq=brightness={brightness}:contrast={contrast}:saturation={saturation}"
