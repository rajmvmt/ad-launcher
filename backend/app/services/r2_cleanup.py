"""R2 multipart orphan sweep.

Aborts multipart uploads older than `hours` so dead browser tabs don't leak
storage. Used by both the cron-style script (scripts/cleanup_r2_orphans.py)
and the in-process daily sweeper kicked off in app/main.py.
"""
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


def sweep_orphans(hours: int = 24, dry_run: bool = False) -> dict:
    """Abort R2 multipart uploads initiated more than `hours` ago.

    Returns: {"aborted": int, "skipped": int}
    """
    from app.core.config import settings

    if not settings.r2_enabled:
        logger.info("R2 not configured — skipping orphan sweep")
        return {"aborted": 0, "skipped": 0}

    import boto3

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    client = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )

    paginator = client.get_paginator("list_multipart_uploads")
    aborted = 0
    skipped = 0

    for page in paginator.paginate(Bucket=settings.R2_BUCKET_NAME):
        for upload in page.get("Uploads", []):
            initiated = upload["Initiated"]
            if initiated.tzinfo is None:
                initiated = initiated.replace(tzinfo=timezone.utc)
            if initiated > cutoff:
                skipped += 1
                continue
            key = upload["Key"]
            upload_id = upload["UploadId"]
            age_h = (datetime.now(timezone.utc) - initiated).total_seconds() / 3600
            prefix = "[DRY] " if dry_run else ""
            logger.info(f"{prefix}aborting {key} (age={age_h:.1f}h, upload_id={upload_id[:16]}…)")
            if not dry_run:
                try:
                    client.abort_multipart_upload(
                        Bucket=settings.R2_BUCKET_NAME,
                        Key=key,
                        UploadId=upload_id,
                    )
                    aborted += 1
                except Exception as e:
                    logger.warning(f"failed to abort {key}: {e}")

    logger.info(f"{'Would abort' if dry_run else 'Aborted'} {aborted} orphan(s); skipped {skipped} younger than {hours}h")
    return {"aborted": aborted, "skipped": skipped}
