from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
import logging
import os
import uuid
from typing import Dict, List
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# Security: Define allowed file types and size limits
ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
ALLOWED_VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.webm'}
ALLOWED_DOC_EXTENSIONS = {'.pdf', '.doc', '.docx', '.txt', '.csv', '.xls', '.xlsx', '.md'}
ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS | ALLOWED_DOC_EXTENSIONS
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB for images
MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024  # 2GB for videos
MAX_DOC_SIZE = 25 * 1024 * 1024  # 25MB for documents

# Magic byte signatures for image/video MIME validation
_MAGIC_BYTES = {
    b'\xff\xd8\xff': {'.jpg', '.jpeg'},          # JPEG
    b'\x89PNG\r\n\x1a\n': {'.png'},              # PNG
    b'GIF87a': {'.gif'},                          # GIF87a
    b'GIF89a': {'.gif'},                          # GIF89a
    b'RIFF': {'.webp', '.avi'},                    # WebP/AVI (RIFF container)
    b'\x1a\x45\xdf\xa3': {'.webm'},              # WebM (EBML header)
}


def _validate_magic_bytes(content: bytes, extension: str) -> bool:
    """Validate that file content magic bytes match the declared extension."""
    if extension in ALLOWED_DOC_EXTENSIONS:
        return True  # Skip magic byte check for documents
    # ISO-BMFF (MP4/MOV): 'ftyp' box marker at offset 4. Robust to any ftyp
    # box size — prior check (first 3 bytes == \x00\x00\x00) falsely rejected
    # any file with an ftyp box >= 256 bytes (common for multi-brand MP4/MOV).
    if extension in {'.mp4', '.mov'} and content[4:8] == b'ftyp':
        return True
    for magic, valid_exts in _MAGIC_BYTES.items():
        if content[:len(magic)] == magic and extension in valid_exts:
            return True
    return False

# Local upload dir for fallback
UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "uploads"
UPLOAD_DIR = UPLOAD_DIR.resolve()
os.makedirs(UPLOAD_DIR, mode=0o755, exist_ok=True)

# Initialize R2 client if configured
_s3_client = None

def get_s3_client():
    global _s3_client
    if _s3_client is None and settings.r2_enabled:
        import boto3
        _s3_client = boto3.client(
            's3',
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name='auto'
        )
    return _s3_client


async def upload_to_r2(file_content: bytes, filename: str, content_type: str) -> str:
    """Upload a bytes blob to Cloudflare R2 and return public URL.

    Use this for small in-memory content. For large files (videos), prefer
    upload_to_r2_stream to avoid buffering the whole blob in memory.
    """
    client = get_s3_client()
    if not client:
        raise HTTPException(status_code=500, detail="R2 storage not configured")
    try:
        client.put_object(
            Bucket=settings.R2_BUCKET_NAME,
            Key=filename,
            Body=file_content,
            ContentType=content_type,
        )
        return f"{settings.R2_PUBLIC_URL}/{filename}"
    except Exception:
        logger.exception("Failed to upload to R2")
        raise HTTPException(status_code=500, detail="Failed to upload file to storage")


async def upload_to_local(file_content: bytes, filename: str) -> str:
    """Write a bytes blob to the local uploads dir and return its served URL."""
    file_path = UPLOAD_DIR / filename
    with open(file_path, "wb") as buffer:
        buffer.write(file_content)
    return f"/uploads/{filename}"


async def upload_to_r2_stream(fileobj, filename: str, content_type: str) -> str:
    """Stream-upload a file-like object to R2 via multipart. Avoids loading the full file into memory."""
    client = get_s3_client()
    if not client:
        raise HTTPException(status_code=500, detail="R2 storage not configured")
    try:
        client.upload_fileobj(
            Fileobj=fileobj,
            Bucket=settings.R2_BUCKET_NAME,
            Key=filename,
            ExtraArgs={'ContentType': content_type},
        )
        return f"{settings.R2_PUBLIC_URL}/{filename}"
    except Exception:
        logger.exception("Failed to upload to R2")
        raise HTTPException(status_code=500, detail="Failed to upload file to storage")


async def upload_to_local_stream(fileobj, filename: str) -> str:
    """Stream-write a file-like object to local uploads dir."""
    file_path = UPLOAD_DIR / filename
    with open(file_path, "wb") as buffer:
        while True:
            chunk = fileobj.read(1024 * 1024)
            if not chunk:
                break
            buffer.write(chunk)
    return f"/uploads/{filename}"


# ---------------------------------------------------------------------------
# Multipart (resumable, chunked) upload endpoints — used by the bulk publish
# wizard for big videos. Browser does PUT directly to R2 via presigned URLs;
# backend just coordinates.
# ---------------------------------------------------------------------------

class MultipartInitReq(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"
    size: int


class MultipartSignReq(BaseModel):
    key: str
    upload_id: str
    part_number: int


class _PartInfo(BaseModel):
    part_number: int
    etag: str


class MultipartCompleteReq(BaseModel):
    key: str
    upload_id: str
    parts: List[_PartInfo]


class MultipartAbortReq(BaseModel):
    key: str
    upload_id: str


@router.post("/multipart/init")
async def multipart_init(req: MultipartInitReq):
    if not settings.r2_enabled:
        raise HTTPException(status_code=400, detail="R2 multipart uploads require R2 to be configured")
    safe_filename = os.path.basename(req.filename or "")
    ext = os.path.splitext(safe_filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")
    is_video = ext in ALLOWED_VIDEO_EXTENSIONS
    is_doc = ext in ALLOWED_DOC_EXTENSIONS
    max_size = MAX_VIDEO_SIZE if is_video else MAX_DOC_SIZE if is_doc else MAX_IMAGE_SIZE
    if req.size <= 0 or req.size > max_size:
        raise HTTPException(status_code=400, detail=f"File too large. Maximum size: {max_size / (1024 * 1024):.0f}MB")
    key = f"{uuid.uuid4()}{ext}"
    client = get_s3_client()
    if not client:
        raise HTTPException(status_code=500, detail="R2 storage not configured")
    try:
        resp = client.create_multipart_upload(
            Bucket=settings.R2_BUCKET_NAME,
            Key=key,
            ContentType=req.content_type or 'application/octet-stream',
        )
    except Exception:
        logger.exception("Failed to start multipart upload")
        raise HTTPException(status_code=500, detail="Failed to start multipart upload")
    media_type = 'video' if is_video else 'document' if is_doc else 'image'
    return {
        "upload_id": resp["UploadId"],
        "key": key,
        "public_url": f"{settings.R2_PUBLIC_URL}/{key}",
        "media_type": media_type,
    }


@router.post("/multipart/sign")
async def multipart_sign(req: MultipartSignReq):
    if not settings.r2_enabled:
        raise HTTPException(status_code=400, detail="R2 not configured")
    if req.part_number < 1 or req.part_number > 10000:
        raise HTTPException(status_code=400, detail="part_number must be between 1 and 10000")
    client = get_s3_client()
    if not client:
        raise HTTPException(status_code=500, detail="R2 storage not configured")
    try:
        url = client.generate_presigned_url(
            ClientMethod="upload_part",
            Params={
                "Bucket": settings.R2_BUCKET_NAME,
                "Key": req.key,
                "UploadId": req.upload_id,
                "PartNumber": req.part_number,
            },
            ExpiresIn=3600,
        )
    except Exception:
        logger.exception("Failed to sign upload part")
        raise HTTPException(status_code=500, detail="Failed to sign upload part")
    return {"url": url}


@router.post("/multipart/complete")
async def multipart_complete(req: MultipartCompleteReq):
    if not settings.r2_enabled:
        raise HTTPException(status_code=400, detail="R2 not configured")
    if not req.parts:
        raise HTTPException(status_code=400, detail="parts list is empty")
    client = get_s3_client()
    if not client:
        raise HTTPException(status_code=500, detail="R2 storage not configured")
    parts_payload = sorted(
        [{"PartNumber": p.part_number, "ETag": p.etag} for p in req.parts],
        key=lambda p: p["PartNumber"],
    )
    try:
        client.complete_multipart_upload(
            Bucket=settings.R2_BUCKET_NAME,
            Key=req.key,
            UploadId=req.upload_id,
            MultipartUpload={"Parts": parts_payload},
        )
    except Exception:
        logger.exception("Failed to complete multipart upload")
        raise HTTPException(status_code=500, detail="Failed to complete multipart upload")
    ext = os.path.splitext(req.key)[1].lower()
    is_video = ext in ALLOWED_VIDEO_EXTENSIONS
    is_doc = ext in ALLOWED_DOC_EXTENSIONS
    media_type = 'video' if is_video else 'document' if is_doc else 'image'
    return {"url": f"{settings.R2_PUBLIC_URL}/{req.key}", "media_type": media_type}


@router.post("/multipart/abort")
async def multipart_abort(req: MultipartAbortReq):
    if not settings.r2_enabled:
        return {"ok": True}
    client = get_s3_client()
    if not client:
        return {"ok": True}
    try:
        client.abort_multipart_upload(
            Bucket=settings.R2_BUCKET_NAME,
            Key=req.key,
            UploadId=req.upload_id,
        )
    except Exception:
        logger.exception("Failed to abort multipart upload")
    return {"ok": True}


@router.post("/", response_model=Dict[str, str])
async def upload_file(file: UploadFile = File(...)):
    try:
        # Security: Sanitize filename to prevent path traversal
        safe_filename = os.path.basename(file.filename)
        file_extension = os.path.splitext(safe_filename)[1].lower()

        # Security: Validate file extension
        if file_extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
            )

        # Determine file category
        is_video = file_extension in ALLOWED_VIDEO_EXTENSIONS
        is_doc = file_extension in ALLOWED_DOC_EXTENSIONS
        max_size = MAX_VIDEO_SIZE if is_video else MAX_DOC_SIZE if is_doc else MAX_IMAGE_SIZE

        # Size check via seek/tell on the SpooledTemporaryFile — avoids buffering
        # the entire body into a Python bytes object (which OOMs for 1-2GB videos).
        fileobj = file.file
        fileobj.seek(0, 2)
        size = fileobj.tell()
        fileobj.seek(0)
        if size > max_size:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size: {max_size / (1024 * 1024):.0f}MB"
            )

        # Magic byte check on the first 16 bytes only.
        if not is_doc:
            head = fileobj.read(16)
            fileobj.seek(0)
            if not _validate_magic_bytes(head, file_extension):
                raise HTTPException(
                    status_code=400,
                    detail="File content does not match declared file type"
                )

        # Generate a unique filename
        filename = f"{uuid.uuid4()}{file_extension}"

        # Upload to R2 if configured, otherwise local. Both stream without
        # materializing the full file in memory.
        if settings.r2_enabled:
            url = await upload_to_r2_stream(fileobj, filename, file.content_type or 'application/octet-stream')
        else:
            url = await upload_to_local_stream(fileobj, filename)

        # Return media type along with URL
        media_type = 'video' if is_video else 'document' if is_doc else 'image'
        return {"url": url, "media_type": media_type}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Could not upload file")
        raise HTTPException(status_code=500, detail="Could not upload file")
