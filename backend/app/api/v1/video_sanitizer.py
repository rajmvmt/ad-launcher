"""
Video Sanitizer API

POST  /clean       — upload one video, returns job_id. Async background processing.
POST  /batch       — upload multiple videos, returns batch_id + list of job_ids.
GET   /jobs/{id}   — poll job status/result.
POST  /analyze     — sync ffprobe of uploaded file, returns metadata report.
GET   /batches/{id}— aggregate status of a batch.

Storage: uploads go to Cloudflare R2 (same as image sanitizer). Sanitized files
use a `sanitized/video/` prefix for easy lifecycle management.
"""

import asyncio
import json
import logging
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from app.core.config import settings
from app.services.video_sanitizer import (
    analyze_video,
    cleanup_workspace,
    make_temp_workspace,
    sanitize_video,
)
from app.services.video_resizer import (
    RATIO_PRESETS,
    FIT_MODES,
    resize_to_ratios,
)

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}
MAX_FILE_SIZE = 500 * 1024 * 1024   # 500MB — matches the existing uploads limit
MAX_BATCH_FILES = 20

UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "uploads"
UPLOAD_DIR = UPLOAD_DIR.resolve()
os.makedirs(UPLOAD_DIR, mode=0o755, exist_ok=True)

# Filesystem-backed job registry — shared across uvicorn workers on the same
# container. Each job is one JSON file; atomic writes via tmp + rename.
# Trades durability across container restarts for zero-dependency simplicity.
JOB_DIR = Path(os.getenv("VIDSAN_JOB_DIR", "/tmp/vidsan-jobs"))
JOB_DIR.mkdir(parents=True, exist_ok=True)
BATCH_DIR = JOB_DIR / "batches"
BATCH_DIR.mkdir(parents=True, exist_ok=True)


def _job_path(job_id: str) -> Path:
    # Prevent path traversal — only allow hex IDs
    if not all(c in "0123456789abcdef" for c in job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id")
    return JOB_DIR / f"{job_id}.json"


def _batch_path(batch_id: str) -> Path:
    if not all(c in "0123456789abcdef" for c in batch_id):
        raise HTTPException(status_code=400, detail="Invalid batch_id")
    return BATCH_DIR / f"{batch_id}.json"


def _atomic_write(path: Path, data: dict) -> None:
    """Write JSON atomically so concurrent readers never see partial content."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _read_job(job_id: str) -> Optional[dict]:
    p = _job_path(job_id)
    if not p.exists():
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        logger.warning("Failed to read job %s", job_id)
        return None


def _write_job(job_id: str, data: dict) -> None:
    _atomic_write(_job_path(job_id), data)


def _update_job(job_id: str, **updates) -> Optional[dict]:
    """Read-modify-write. Not fully atomic under concurrent writes but fine for
    our 'one worker owns a job' pattern."""
    existing = _read_job(job_id) or {}
    existing.update(updates)
    _write_job(job_id, existing)
    return existing


def _read_batch(batch_id: str) -> Optional[dict]:
    p = _batch_path(batch_id)
    if not p.exists():
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return None


def _write_batch(batch_id: str, data: dict) -> None:
    _atomic_write(_batch_path(batch_id), data)


# ----------------------------- Storage helpers ----------------------------- #

def _get_s3_client():
    if not settings.r2_enabled:
        return None
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def _save_output(local_path: Path, extension: str) -> str:
    """Upload the sanitized file to R2 (or fallback local) and return a public URL."""
    key = f"sanitized/video/{uuid.uuid4()}{extension}"
    content_type = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".m4v": "video/mp4",
        ".webm": "video/webm",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
    }.get(extension.lower(), "application/octet-stream")

    if settings.r2_enabled:
        client = _get_s3_client()
        with open(local_path, "rb") as f:
            client.put_object(
                Bucket=settings.R2_BUCKET_NAME,
                Key=key,
                Body=f,
                ContentType=content_type,
            )
        return f"{settings.R2_PUBLIC_URL}/{key}"

    # Local fallback (dev only)
    filename = os.path.basename(key)
    dest = UPLOAD_DIR / filename
    dest.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(local_path, dest)
    return f"/uploads/{filename}"


# ----------------------------- Job worker ---------------------------------- #

def _run_job_sync(
    job_id: str,
    input_path: Path,
    workspace: Path,
    ext: str,
    level: int,
    flip_horizontal: bool,
    delogo: Optional[dict],
    original_name: str,
    original_size: int,
    pitch_shift: bool = False,
    colorspace_roundtrip: bool = False,
    sanitize: bool = True,
    resize_ratios: Optional[list[str]] = None,
    fit_mode: str = "crop",
    horizontal_fit_mode: Optional[str] = None,
) -> None:
    """Blocking job runner. Called via asyncio.to_thread so it doesn't block the loop.

    Pipeline:
      1. (optional) sanitize source -> sanitized output (uploaded to R2 as job.url)
      2. (optional) resize the sanitized output (or the source if sanitize=False)
         into each requested ratio -> uploaded to R2 as job.variants[ratio]
    """
    job = _read_job(job_id)
    if not job:
        return
    started_at = time.time()
    resize_ratios = resize_ratios or []
    try:
        _update_job(job_id, status="processing", started_at=started_at)

        report: dict = {}
        url: Optional[str] = None
        variants: dict[str, dict] = {}

        # ---------- 1. Sanitize (optional) ----------
        if sanitize:
            sanitized_path = workspace / f"sanitized{ext}"
            report = sanitize_video(
                str(input_path),
                str(sanitized_path),
                level=level,
                flip_horizontal=flip_horizontal,
                delogo=delogo,
                pitch_shift=pitch_shift,
                colorspace_roundtrip=colorspace_roundtrip,
            )
            output_size = sanitized_path.stat().st_size
            url = _save_output(sanitized_path, ext)

            pct_change = ((output_size - original_size) / original_size * 100) if original_size else 0
            report["original_size"] = original_size
            report["cleaned_size"] = output_size
            report["size_change"] = f"{pct_change:+.1f}%"
            resize_source = sanitized_path
        else:
            resize_source = input_path

        # ---------- 2. Resize variants (optional) ----------
        if resize_ratios:
            variants_workspace = workspace / "variants"
            base = Path(original_name).stem or "video"
            results = resize_to_ratios(
                input_path=str(resize_source),
                workspace=variants_workspace,
                ratios=resize_ratios,
                fit_mode=fit_mode,
                horizontal_fit_mode=horizontal_fit_mode,
                base_name=base,
            )
            for r in results:
                out_path = Path(r["output_path"])
                variant_url = _save_output(out_path, ".mp4")
                variants[r["ratio"]] = {
                    "url": variant_url,
                    "width": r["width"],
                    "height": r["height"],
                    "fit_mode": r["fit_mode"],
                    "size_bytes": out_path.stat().st_size,
                }

        finished_at = time.time()
        _update_job(
            job_id,
            status="completed",
            url=url,
            variants=variants,
            report=report,
            finished_at=finished_at,
            elapsed_s=round(finished_at - started_at, 2),
            original_name=original_name,
        )
    except Exception as e:
        logger.exception("Sanitize/resize job %s failed", job_id)
        _update_job(
            job_id,
            status="failed",
            error=str(e),
            finished_at=time.time(),
            original_name=original_name,
        )
    finally:
        cleanup_workspace(workspace)


async def _run_job(*args, **kwargs):
    await asyncio.to_thread(_run_job_sync, *args, **kwargs)


# ----------------------------- Validation ---------------------------------- #

async def _accept_upload(file: UploadFile) -> tuple[Path, Path, str, int]:
    """Validate + write upload to a temp workspace. Returns (workspace, input_path, ext, size)."""
    filename = os.path.basename(file.filename or "video.mp4")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    workspace = make_temp_workspace()
    input_path = workspace / f"input{ext}"
    size = 0
    try:
        with open(input_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Max {MAX_FILE_SIZE // (1024 * 1024)}MB",
                    )
                out.write(chunk)
    except HTTPException:
        cleanup_workspace(workspace)
        raise
    except Exception:
        cleanup_workspace(workspace)
        logger.exception("Failed to save upload")
        raise HTTPException(status_code=500, detail="Failed to save upload")

    return workspace, input_path, ext, size


def _parse_ratios(ratios_csv: Optional[str]) -> list[str]:
    """Parse a CSV of placement ratios. Empty/None -> []. Bad values raise 400."""
    if not ratios_csv:
        return []
    parts = [p.strip() for p in ratios_csv.split(",") if p.strip()]
    bad = [p for p in parts if p not in RATIO_PRESETS]
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown ratios: {bad}. Allowed: {list(RATIO_PRESETS)}",
        )
    # Dedup, preserve order
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _validate_fit_mode(fit_mode: str, field: str = "fit_mode") -> str:
    if fit_mode not in FIT_MODES:
        raise HTTPException(status_code=400, detail=f"{field} must be one of {FIT_MODES}")
    return fit_mode


def _parse_delogo(delogo_json: Optional[str]) -> Optional[dict]:
    if not delogo_json:
        return None
    try:
        d = json.loads(delogo_json)
    except Exception:
        raise HTTPException(status_code=400, detail="delogo must be valid JSON")
    if not all(k in d for k in ("x", "y", "w", "h")):
        raise HTTPException(status_code=400, detail="delogo needs keys x, y, w, h")
    if any(int(d[k]) < 0 for k in ("x", "y", "w", "h")) or int(d["w"]) < 4 or int(d["h"]) < 4:
        raise HTTPException(status_code=400, detail="delogo dimensions must be positive (w/h >= 4)")
    return {"x": int(d["x"]), "y": int(d["y"]), "w": int(d["w"]), "h": int(d["h"])}


# ----------------------------- Endpoints ----------------------------------- #

@router.post("/clean")
async def clean_video(
    file: UploadFile = File(...),
    level: int = Form(2),
    flip_horizontal: bool = Form(False),
    pitch_shift: bool = Form(False),
    colorspace_roundtrip: bool = Form(False),
    delogo: Optional[str] = Form(None),
    resize_ratios: Optional[str] = Form(None),
    fit_mode: str = Form("crop"),
    horizontal_fit_mode: Optional[str] = Form(None),
):
    """Upload one video. Returns job_id. Poll GET /jobs/{id} for status/result.

    resize_ratios: optional CSV like "9:16,1:1,4:5,16:9". When set, the cleaned
    output is also resized into each ratio and exposed via job.variants[ratio].
    """
    if level not in (1, 2, 3, 4):
        raise HTTPException(status_code=400, detail="Level must be 1, 2, 3, or 4")
    ratios = _parse_ratios(resize_ratios)
    _validate_fit_mode(fit_mode)
    if horizontal_fit_mode:
        _validate_fit_mode(horizontal_fit_mode, "horizontal_fit_mode")
    delogo_dict = _parse_delogo(delogo)
    workspace, input_path, ext, size = await _accept_upload(file)

    job_id = uuid.uuid4().hex
    original_name = os.path.basename(file.filename or f"video{ext}")
    _write_job(job_id, {
        "job_id": job_id,
        "status": "queued",
        "level": level,
        "original_name": original_name,
        "original_size": size,
        "resize_ratios": ratios,
        "created_at": time.time(),
    })
    asyncio.create_task(
        _run_job(
            job_id, input_path, workspace, ext, level, flip_horizontal, delogo_dict,
            original_name, size,
            pitch_shift, colorspace_roundtrip,
            True, ratios, fit_mode, horizontal_fit_mode,
        )
    )
    return {"job_id": job_id, "status": "queued"}


@router.post("/resize")
async def resize_video(
    file: UploadFile = File(...),
    resize_ratios: str = Form(...),
    fit_mode: str = Form("crop"),
    horizontal_fit_mode: Optional[str] = Form(None),
):
    """Upload one video and produce ratio variants only — no metadata sanitize.

    resize_ratios: required CSV (e.g. "9:16,1:1,4:5,16:9"). Returns job_id.
    Poll GET /jobs/{id} for variants[ratio].
    """
    ratios = _parse_ratios(resize_ratios)
    if not ratios:
        raise HTTPException(status_code=400, detail="resize_ratios must include at least one ratio")
    _validate_fit_mode(fit_mode)
    if horizontal_fit_mode:
        _validate_fit_mode(horizontal_fit_mode, "horizontal_fit_mode")
    workspace, input_path, ext, size = await _accept_upload(file)

    job_id = uuid.uuid4().hex
    original_name = os.path.basename(file.filename or f"video{ext}")
    _write_job(job_id, {
        "job_id": job_id,
        "status": "queued",
        "original_name": original_name,
        "original_size": size,
        "resize_ratios": ratios,
        "sanitize": False,
        "created_at": time.time(),
    })
    asyncio.create_task(
        _run_job(
            job_id, input_path, workspace, ext, 1, False, None,
            original_name, size,
            False, False,
            False, ratios, fit_mode, horizontal_fit_mode,
        )
    )
    return {"job_id": job_id, "status": "queued"}


@router.post("/batch")
async def batch_clean(
    files: list[UploadFile] = File(...),
    level: int = Form(2),
    flip_horizontal: bool = Form(False),
    pitch_shift: bool = Form(False),
    colorspace_roundtrip: bool = Form(False),
    resize_ratios: Optional[str] = Form(None),
    fit_mode: str = Form("crop"),
    horizontal_fit_mode: Optional[str] = Form(None),
):
    """Upload up to MAX_BATCH_FILES videos. Returns batch_id + list of job_ids."""
    if level not in (1, 2, 3, 4):
        raise HTTPException(status_code=400, detail="Level must be 1, 2, 3, or 4")
    if len(files) == 0:
        raise HTTPException(status_code=400, detail="No files provided")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(status_code=400, detail=f"Max {MAX_BATCH_FILES} files per batch")
    ratios = _parse_ratios(resize_ratios)
    _validate_fit_mode(fit_mode)
    if horizontal_fit_mode:
        _validate_fit_mode(horizontal_fit_mode, "horizontal_fit_mode")

    batch_id = uuid.uuid4().hex
    job_ids: list[str] = []

    for file in files:
        try:
            workspace, input_path, ext, size = await _accept_upload(file)
        except HTTPException as e:
            # Skip this file, log, continue with remaining
            logger.warning("Skipping invalid file in batch: %s", e.detail)
            continue
        job_id = uuid.uuid4().hex
        original_name = os.path.basename(file.filename or f"video{ext}")
        _write_job(job_id, {
            "job_id": job_id,
            "batch_id": batch_id,
            "status": "queued",
            "level": level,
            "original_name": original_name,
            "original_size": size,
            "resize_ratios": ratios,
            "created_at": time.time(),
        })
        job_ids.append(job_id)
        asyncio.create_task(
            _run_job(
                job_id, input_path, workspace, ext, level, flip_horizontal, None,
                original_name, size,
                pitch_shift, colorspace_roundtrip,
                True, ratios, fit_mode, horizontal_fit_mode,
            )
        )

    if not job_ids:
        raise HTTPException(status_code=400, detail="No valid files in batch")

    _write_batch(batch_id, {
        "batch_id": batch_id,
        "job_ids": job_ids,
        "created_at": time.time(),
        "total": len(job_ids),
    })
    return {"batch_id": batch_id, "job_ids": job_ids, "total": len(job_ids)}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = _read_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str):
    batch = _read_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    jobs = [j for j in (_read_job(jid) for jid in batch["job_ids"]) if j]
    return {
        **batch,
        "jobs": jobs,
        "completed": sum(1 for j in jobs if j.get("status") == "completed"),
        "failed": sum(1 for j in jobs if j.get("status") == "failed"),
        "in_progress": sum(1 for j in jobs if j.get("status") in ("queued", "processing")),
    }


@router.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """Read metadata from uploaded video without sanitizing. Returns what ffprobe sees."""
    workspace, input_path, ext, size = await _accept_upload(file)
    try:
        report = analyze_video(str(input_path))
        report["filename"] = os.path.basename(file.filename or f"video{ext}")
        report["size_bytes"] = size
        return report
    finally:
        cleanup_workspace(workspace)
