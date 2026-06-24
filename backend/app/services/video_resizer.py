"""
Video Resizer Service

Re-exports a source video into Facebook-ready placement ratios so a single
upload covers Vertical (9:16), Square (1:1), Portrait (4:5), and Horizontal
(16:9) without FB's "won't show on certain placements" warning.

Two fit modes:
  - "crop"       — scale to fill, then center-crop the overflow.
  - "letterbox"  — scale to fit, pad the gap with a blurred copy of the same
                   frame (no black bars). Best for vertical→horizontal where
                   center-crop would chop on-screen text.

The sanitizer pipeline owns metadata stripping + fingerprinting. Resize is
intentionally narrow: dimensions + encode only.
"""

import logging
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

FFMPEG = "ffmpeg"

# (label, target width, target height) — long edge ≥ 1080 so FB won't upscale.
RATIO_PRESETS: dict[str, tuple[int, int]] = {
    "9:16": (1080, 1920),
    "1:1":  (1080, 1080),
    "4:5":  (1080, 1350),
    "16:9": (1920, 1080),
}

FIT_MODES = ("crop", "letterbox")


@dataclass
class ResizeJob:
    ratio: str
    width: int
    height: int
    fit_mode: str
    output_path: Path


def _run(cmd: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    logger.info("ffmpeg resize: %s", shlex.join(cmd))
    return subprocess.run(cmd, check=True, capture_output=True, timeout=timeout)


def _build_crop_filter(target_w: int, target_h: int) -> str:
    """Scale source to fully cover target, then center-crop overflow.

    Strategy: if source aspect > target aspect, source is wider than target —
    scale by height (set height=target, width=auto). Else scale by width.
    Then crop to exact target. Output dimensions are guaranteed even (libx264
    requires this) because target_w/target_h are even by construction.
    """
    target_aspect = target_w / target_h
    return (
        f"scale=w='if(gt(a,{target_aspect}),-2,{target_w})':"
        f"h='if(gt(a,{target_aspect}),{target_h},-2)',"
        f"crop={target_w}:{target_h}"
    )


def _build_letterbox_filter(target_w: int, target_h: int, blur_sigma: int = 30) -> str:
    """Scale source to fit inside target, fill remainder with a blurred copy.

    Splits the input into two streams: a blurred "background" scaled to cover
    the whole frame, and a "foreground" scaled to fit inside it. Overlays
    the foreground centered. No black bars, no cropping.
    """
    return (
        f"split=2[bg][fg];"
        f"[bg]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
        f"crop={target_w}:{target_h},gblur=sigma={blur_sigma}[bgblur];"
        f"[fg]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease[fgfit];"
        f"[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2"
    )


def resize_one(
    input_path: str,
    output_path: str,
    ratio: str,
    fit_mode: str = "crop",
    crf: int = 20,
    preset: str = "medium",
) -> dict:
    """Render one ratio variant. Returns a small report dict."""
    if ratio not in RATIO_PRESETS:
        raise ValueError(f"Unknown ratio: {ratio}. Allowed: {list(RATIO_PRESETS)}")
    if fit_mode not in FIT_MODES:
        raise ValueError(f"Unknown fit_mode: {fit_mode}. Allowed: {FIT_MODES}")

    target_w, target_h = RATIO_PRESETS[ratio]

    if fit_mode == "letterbox":
        vf = _build_letterbox_filter(target_w, target_h)
    else:
        vf = _build_crop_filter(target_w, target_h)

    cmd = [
        FFMPEG, "-y",
        "-i", input_path,
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", preset,
        "-crf", str(crf),
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ac", "2",
        "-movflags", "+faststart",
        output_path,
    ]
    _run(cmd)

    return {
        "ratio": ratio,
        "width": target_w,
        "height": target_h,
        "fit_mode": fit_mode,
        "output_path": output_path,
    }


def resize_to_ratios(
    input_path: str,
    workspace: Path,
    ratios: list[str],
    fit_mode: str = "crop",
    horizontal_fit_mode: Optional[str] = None,
    base_name: str = "output",
    crf: int = 20,
    preset: str = "medium",
) -> list[dict]:
    """Render multiple ratio variants from a single source.

    horizontal_fit_mode lets the caller override fit_mode for 16:9 only —
    common case is "letterbox" on 16:9 (where center-crop on a vertical source
    eats text) and "crop" everywhere else.
    """
    if not ratios:
        return []
    for r in ratios:
        if r not in RATIO_PRESETS:
            raise ValueError(f"Unknown ratio: {r}")
    if fit_mode not in FIT_MODES:
        raise ValueError(f"Unknown fit_mode: {fit_mode}")
    if horizontal_fit_mode and horizontal_fit_mode not in FIT_MODES:
        raise ValueError(f"Unknown horizontal_fit_mode: {horizontal_fit_mode}")

    workspace.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []

    for ratio in ratios:
        # 16:9 from a vertical source center-crops badly — let caller force letterbox.
        active_mode = horizontal_fit_mode if (ratio == "16:9" and horizontal_fit_mode) else fit_mode
        # ratio "9:16" -> "9x16" for filename safety
        ratio_slug = ratio.replace(":", "x")
        out_path = workspace / f"{base_name}_{ratio_slug}.mp4"
        report = resize_one(
            input_path=input_path,
            output_path=str(out_path),
            ratio=ratio,
            fit_mode=active_mode,
            crf=crf,
            preset=preset,
        )
        results.append(report)

    return results
