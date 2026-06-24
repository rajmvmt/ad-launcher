"""Apply CORS rules to the R2 bucket so the browser can PUT parts directly.

Required for the multipart upload flow in /api/v1/uploads/multipart/*.
Run once after deploy (or whenever ALLOWED_ORIGINS changes).

    python -m backend.scripts.configure_r2_cors

Picks up R2_* env vars and ALLOWED_ORIGINS from the same env the API uses.
"""
import json
import os
import sys

import boto3

from app.core.config import settings


def main() -> int:
    if not settings.r2_enabled:
        print("R2 is not configured (missing R2_* env vars). Aborting.")
        return 1

    default_origins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5180",
        "http://localhost:3000",
    ]
    extra = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    origins = default_origins + extra
    if not extra:
        print("Warning: ALLOWED_ORIGINS is empty — only localhost dev origins will be permitted.")

    cors = {
        "CORSRules": [
            {
                "AllowedOrigins": origins,
                "AllowedMethods": ["PUT", "GET", "HEAD"],
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600,
            }
        ]
    }

    client = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )
    client.put_bucket_cors(Bucket=settings.R2_BUCKET_NAME, CORSConfiguration=cors)
    print(f"Applied CORS to bucket {settings.R2_BUCKET_NAME}:")
    print(json.dumps(cors, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
