"""Verify hook-frame sampling lands the first seconds in the candidate pool."""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

repo_root = Path(__file__).resolve().parent.parent
load_dotenv(repo_root / ".env.local")
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Stub out Gemini so the test stays fast and doesn't burn quota.
import app.services.thumbnail_scorer as _ts
_ts.score_thumbnails_with_ai = lambda paths: {}

from app.services.facebook_service import FacebookService

video_url = "/uploads/e2e_hook_test.mp4"
import hashlib
out_id = hashlib.md5(video_url.encode("utf-8")).hexdigest()[:16]
out_dir = Path(__file__).resolve().parent / "uploads" / "thumbnails" / out_id
if out_dir.exists():
    import shutil
    shutil.rmtree(out_dir)

svc = FacebookService.__new__(FacebookService)
import subprocess

# We want to see the actual timestamps ffmpeg extracted. Monkey-patch
# subprocess.run to log the -ss values used in ffmpeg calls.
original_run = subprocess.run
observed_timestamps = []

def run_spy(*args, **kwargs):
    cmd = args[0] if args else kwargs.get("args", [])
    if isinstance(cmd, list) and "ffmpeg" in cmd[0] and "-ss" in cmd:
        ss_idx = cmd.index("-ss")
        try:
            observed_timestamps.append(float(cmd[ss_idx + 1]))
        except Exception:
            pass
    return original_run(*args, **kwargs)

subprocess.run = run_spy

frames = svc.extract_video_frames(video_url, n=12)

subprocess.run = original_run

print(f"Total ffmpeg extractions: {len(observed_timestamps)}")
print(f"First 8 timestamps (sorted): {sorted(observed_timestamps)[:8]}")
print(f"Early-second samples (< 3s): {[t for t in observed_timestamps if t < 3]}")
print(f"Returned {len(frames)} frames")

early = [t for t in observed_timestamps if t < 3]
assert len(early) >= 4, f"Expected >=4 hook samples < 3s, got {len(early)}: {early}"
assert min(observed_timestamps) <= 0.5, f"Earliest sample should be <=0.5s, got {min(observed_timestamps)}"
print("\n✓ Hook-frame sampling is working — first 3s of video is well represented")
