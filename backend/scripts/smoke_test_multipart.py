"""End-to-end smoke test for the /uploads/multipart/* endpoints.

Generates a 12MB test blob, runs init → sign → PUT (×2) → complete, fetches
the public URL to verify the bytes round-tripped, then deletes the object.

    BACKEND_URL=https://backend-production-85fd.up.railway.app TOKEN=eyJ... python -m scripts.smoke_test_multipart

If TOKEN is omitted the script falls back to anonymous (works because
/uploads/multipart/* doesn't require auth in the current routes).
"""
import hashlib
import os
import sys
import time

import requests


BACKEND = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
TOKEN = os.getenv("TOKEN")
PART_SIZE = 8 * 1024 * 1024  # match frontend
BLOB_SIZE = 12 * 1024 * 1024  # forces 2 parts


def _headers():
    h = {"Content-Type": "application/json"}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    return h


def main() -> int:
    print(f"Backend: {BACKEND}")
    print(f"Generating {BLOB_SIZE / 1048576:.0f}MB test blob...")
    blob = os.urandom(BLOB_SIZE)
    blob_md5 = hashlib.md5(blob).hexdigest()
    print(f"  md5: {blob_md5}")

    # 1) init
    print("\n[1/4] POST /uploads/multipart/init")
    resp = requests.post(
        f"{BACKEND}/api/v1/uploads/multipart/init",
        headers=_headers(),
        json={"filename": "smoke.mp4", "content_type": "video/mp4", "size": BLOB_SIZE},
        timeout=30,
    )
    if not resp.ok:
        print(f"  FAIL: {resp.status_code} {resp.text[:200]}")
        return 1
    init = resp.json()
    upload_id = init["upload_id"]
    key = init["key"]
    public_url = init["public_url"]
    print(f"  upload_id={upload_id[:32]}…  key={key}")

    # 2) sign + put each part
    parts = []
    total_parts = (BLOB_SIZE + PART_SIZE - 1) // PART_SIZE
    for i in range(total_parts):
        part_number = i + 1
        start = i * PART_SIZE
        end = min(start + PART_SIZE, BLOB_SIZE)
        chunk = blob[start:end]
        print(f"\n[2/4] Part {part_number}/{total_parts}: signing + uploading {len(chunk) / 1048576:.1f}MB...")

        sign_resp = requests.post(
            f"{BACKEND}/api/v1/uploads/multipart/sign",
            headers=_headers(),
            json={"key": key, "upload_id": upload_id, "part_number": part_number},
            timeout=30,
        )
        if not sign_resp.ok:
            print(f"  sign FAIL: {sign_resp.status_code} {sign_resp.text[:200]}")
            return 1
        url = sign_resp.json()["url"]

        put_resp = requests.put(url, data=chunk, timeout=120)
        if not put_resp.ok:
            print(f"  put FAIL: {put_resp.status_code} {put_resp.text[:200]}")
            return 1
        etag = put_resp.headers.get("ETag", "").replace('"', "")
        if not etag:
            print("  put FAIL: no ETag in response")
            return 1
        parts.append({"part_number": part_number, "etag": etag})
        print(f"  ok, etag={etag[:16]}…")

    # 3) complete
    print(f"\n[3/4] POST /uploads/multipart/complete with {len(parts)} parts")
    resp = requests.post(
        f"{BACKEND}/api/v1/uploads/multipart/complete",
        headers=_headers(),
        json={"key": key, "upload_id": upload_id, "parts": parts},
        timeout=60,
    )
    if not resp.ok:
        print(f"  FAIL: {resp.status_code} {resp.text[:200]}")
        return 1
    print(f"  url={resp.json()['url']}")

    # 4) fetch & verify
    print(f"\n[4/4] GET {public_url} and verify md5")
    time.sleep(2)
    fetched = requests.get(public_url, timeout=120).content
    fetched_md5 = hashlib.md5(fetched).hexdigest()
    if fetched_md5 != blob_md5 or len(fetched) != BLOB_SIZE:
        print(f"  FAIL: got {len(fetched)} bytes md5={fetched_md5}, expected {BLOB_SIZE} bytes md5={blob_md5}")
        return 1
    print(f"  OK: {len(fetched)} bytes, md5 match")

    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
