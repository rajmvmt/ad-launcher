"""
Video Sanitizer Service

Strips metadata, fingerprints, and AI watermarks from videos.

Three processing levels (map to frontend names Light / Balanced / Aggressive):
  1. Quick Clean  — container + metadata strip only (ffmpeg -map_metadata -1 -c copy), no re-encode
  2. Deep Clean   — metadata + H.264 re-encode + small crop + color nudge + trim
  3. Full Scrub   — everything in Deep + noise overlay + speed shift + stronger transforms

All randomizable parameters are randomized per job, so repeat sanitizations of the
same source don't produce matching fingerprints.
"""

import json
import logging
import math
import os
import random
import shlex
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


@dataclass
class SanitizeParams:
    """Randomized parameters for one sanitize job. Stored on the report so we
    know what actually happened to any given video."""
    level: int
    crop_percent: float = 0.0          # 0-5 pct off each edge (lvl 4 up to 5)
    saturation: float = 1.0            # 0.90-1.10 at lvl 4
    hue_shift_deg: float = 0.0         # -8 to +8 at lvl 4
    brightness: float = 0.0            # -0.04 to +0.04 at lvl 4
    contrast: float = 1.0              # 0.92-1.08 at lvl 4
    gamma: float = 1.0                 # 0.95-1.05 at lvl 4
    speed: float = 1.0                 # 0.93-1.07 at lvl 4 (setpts + atempo)
    noise_strength: float = 0.0        # 0-14 at lvl 4 (ffmpeg noise alls=)
    trim_head_ms: int = 0              # 0-500ms at lvl 4
    trim_tail_ms: int = 0              # 0-500ms at lvl 4
    flip_horizontal: bool = False      # nuclear — default off
    crf: int = 20                      # 18-26 randomized
    preset: str = "medium"             # randomized from a safe list
    gop_size: int = 60                 # 48-120

    # Level 4 Nuclear — each of these significantly breaks FB's perceptual
    # hash and/or temporal fingerprint. Zero by default.
    rotation_deg: float = 0.0          # -0.8 to +0.8 at lvl 4
    fps_shift: bool = False            # 30 -> 29.97 or 30.5 style nudge
    target_fps: Optional[float] = None # exact output fps (set when fps_shift=True)
    two_pass: bool = False             # re-encode twice with different settings
    zoom_push: float = 0.0             # 0 = none, 0.03 = slow 1.00 -> 1.03x push
    vignette: bool = False             # subtle corner darkening

    # Opt-in per-video toggles
    pitch_shift_semitones: float = 0.0 # audio pitch shift, independent of tempo
    colorspace_roundtrip: bool = False # forces chroma subsample roundtrip

    delogo: Optional[dict] = None      # {x, y, w, h} if user supplied a region

    def as_dict(self) -> dict:
        d = {
            "level": self.level,
            "crop_percent": round(self.crop_percent, 3),
            "saturation": round(self.saturation, 4),
            "hue_shift_deg": round(self.hue_shift_deg, 3),
            "brightness": round(self.brightness, 4),
            "contrast": round(self.contrast, 4),
            "gamma": round(self.gamma, 4),
            "speed": round(self.speed, 4),
            "noise_strength": round(self.noise_strength, 2),
            "trim_head_ms": self.trim_head_ms,
            "trim_tail_ms": self.trim_tail_ms,
            "flip_horizontal": self.flip_horizontal,
            "crf": self.crf,
            "preset": self.preset,
            "gop_size": self.gop_size,
            "rotation_deg": round(self.rotation_deg, 3),
            "fps_shift": self.fps_shift,
            "target_fps": self.target_fps,
            "two_pass": self.two_pass,
            "zoom_push": round(self.zoom_push, 4),
            "vignette": self.vignette,
            "pitch_shift_semitones": round(self.pitch_shift_semitones, 3),
            "colorspace_roundtrip": self.colorspace_roundtrip,
        }
        if self.delogo:
            d["delogo"] = self.delogo
        return d


def _roll_params(
    level: int,
    flip_horizontal: bool,
    delogo: Optional[dict],
    pitch_shift: bool = False,
    colorspace_roundtrip: bool = False,
    source_fps: Optional[float] = None,
) -> SanitizeParams:
    """Randomize per-job parameters within safe ranges. Same source sanitized
    twice will produce two different output fingerprints."""
    p = SanitizeParams(level=level, flip_horizontal=flip_horizontal, delogo=delogo)

    if level == 1:
        # Opt-in toggles work at any level
        if pitch_shift:
            p.pitch_shift_semitones = random.choice([-2.0, -1.5, -1.0, 1.0, 1.5, 2.0])
        if colorspace_roundtrip:
            p.colorspace_roundtrip = True
        return p

    if level >= 2:
        p.crop_percent = random.uniform(1.0, 2.5)
        p.saturation = random.uniform(0.96, 1.04)
        p.hue_shift_deg = random.uniform(-3.0, 3.0)
        p.brightness = random.uniform(-0.02, 0.02)
        p.contrast = random.uniform(0.98, 1.02)
        p.gamma = random.uniform(0.98, 1.02)
        p.trim_head_ms = random.randint(50, 200)
        p.trim_tail_ms = random.randint(50, 200)
        p.crf = random.choice([19, 20, 21, 22])
        p.preset = random.choice(["medium", "slow"])
        p.gop_size = random.choice([48, 60, 72, 90])

    if level >= 3:
        p.crop_percent = random.uniform(1.5, 3.0)
        p.saturation = random.uniform(0.94, 1.06)
        p.hue_shift_deg = random.uniform(-4.0, 4.0)
        p.brightness = random.uniform(-0.03, 0.03)
        p.contrast = random.uniform(0.96, 1.04)
        p.gamma = random.uniform(0.97, 1.03)
        p.speed = random.uniform(0.97, 1.03)
        p.noise_strength = random.uniform(4.0, 9.0)
        p.trim_head_ms = random.randint(100, 300)
        p.trim_tail_ms = random.randint(100, 300)
        p.crf = random.choice([21, 22, 23, 24])
        p.preset = random.choice(["medium", "slow"])

    if level >= 4:
        # Nuclear: everything wider + rotation + fps shift + two-pass + zoom + vignette
        p.crop_percent = random.uniform(3.5, 5.0)   # needs to cover rotation artifacts
        p.saturation = random.uniform(0.90, 1.10)
        p.hue_shift_deg = random.uniform(-8.0, 8.0)
        p.brightness = random.uniform(-0.04, 0.04)
        p.contrast = random.uniform(0.92, 1.08)
        p.gamma = random.uniform(0.95, 1.05)
        p.speed = random.uniform(0.93, 1.07)
        p.noise_strength = random.uniform(8.0, 14.0)
        p.trim_head_ms = random.randint(200, 500)
        p.trim_tail_ms = random.randint(200, 500)
        p.crf = random.choice([22, 23, 24, 25, 26])
        # Slight rotation — pick a non-zero direction + magnitude
        sign = random.choice([-1, 1])
        p.rotation_deg = sign * random.uniform(0.3, 0.8)
        p.fps_shift = True
        # Pick a target fps near source: +/- 0.5 fps, or land on 29.97 if source is 30
        if source_fps and abs(source_fps - 30.0) < 0.5:
            p.target_fps = random.choice([29.97, 30.5])
        else:
            base = source_fps if source_fps else 30.0
            p.target_fps = round(base + random.choice([-0.5, 0.5]), 3)
        p.two_pass = True
        p.zoom_push = random.uniform(0.015, 0.030)  # ~1.5-3% zoom over duration
        p.vignette = True

    # Opt-in toggles
    if pitch_shift:
        p.pitch_shift_semitones = random.choice([-2.0, -1.5, -1.0, 1.0, 1.5, 2.0])
    if colorspace_roundtrip:
        p.colorspace_roundtrip = True

    return p


def _run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    logger.info("ffmpeg run: %s", shlex.join(cmd))
    return subprocess.run(
        cmd,
        check=True,
        capture_output=True,
        timeout=timeout,
    )


def analyze_video(input_path: str) -> dict:
    """ffprobe the video and report every metadata field + stream info we can see."""
    try:
        result = subprocess.run(
            [
                FFPROBE, "-v", "quiet", "-print_format", "json",
                "-show_format", "-show_streams", "-show_chapters",
                input_path,
            ],
            check=True, capture_output=True, timeout=30,
        )
        data = json.loads(result.stdout)
    except Exception as e:
        logger.warning("ffprobe failed: %s", e)
        return {"error": str(e)}

    fmt = data.get("format", {})
    streams = data.get("streams", [])
    format_tags = fmt.get("tags", {}) or {}

    metadata_found: list[str] = []
    suspicious: list[str] = []

    # Container-level tags
    for k, v in format_tags.items():
        metadata_found.append(f"format:{k}={v}")
        kl = k.lower()
        vl = str(v).lower()
        if "facebook" in kl or "facebook" in vl:
            suspicious.append(f"Facebook tag: {k}={v}")
        if "com.apple" in kl or "com.android" in kl:
            suspicious.append(f"Device tag: {k}={v}")
        if "uuid" in kl or kl == "major_brand":
            suspicious.append(f"Identifier: {k}={v}")
        if "handler_name" in kl and v not in ("VideoHandler", "SoundHandler", ""):
            suspicious.append(f"Custom handler_name: {v}")

    # Stream-level tags
    for s in streams:
        s_tags = s.get("tags", {}) or {}
        for k, v in s_tags.items():
            metadata_found.append(f"stream{s.get('index', '?')}:{k}={v}")

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    return {
        "format_name": fmt.get("format_name"),
        "duration_s": float(fmt.get("duration", 0) or 0),
        "size_bytes": int(fmt.get("size", 0) or 0),
        "bit_rate": int(fmt.get("bit_rate", 0) or 0),
        "video_codec": (video_stream or {}).get("codec_name"),
        "audio_codec": (audio_stream or {}).get("codec_name"),
        "width": (video_stream or {}).get("width"),
        "height": (video_stream or {}).get("height"),
        "fps": (video_stream or {}).get("r_frame_rate"),
        "metadata_found": metadata_found,
        "suspicious_tags": suspicious,
        "metadata_count": len(metadata_found),
    }


def _build_video_filter(params: SanitizeParams, src_w: int, src_h: int) -> str:
    """Build the ffmpeg -vf filter chain for the given params."""
    filters: list[str] = []

    # delogo (user-supplied region, applied first so transforms don't shift it)
    if params.delogo:
        d = params.delogo
        filters.append(f"delogo=x={int(d['x'])}:y={int(d['y'])}:w={int(d['w'])}:h={int(d['h'])}")

    # horizontal flip (only if explicitly enabled)
    if params.flip_horizontal:
        filters.append("hflip")

    # rotation (applied before crop so crop removes black corners)
    if params.rotation_deg != 0.0:
        angle_rad = math.radians(params.rotation_deg)
        filters.append(f"rotate=angle={angle_rad:.6f}:ow=iw:oh=ih:bilinear=1:fillcolor=black")

    # crop (pct off each edge) + scale back to original to keep dimensions stable.
    # When rotation is applied, crop must also remove the black corners. The inscribed
    # rectangle shrink factor is approximately |sin(θ)| * max_dim/min_dim, so bumping
    # crop_percent to cover that is handled in _roll_params for level 4.
    if params.crop_percent > 0:
        cx = params.crop_percent / 100.0
        crop_w = max(16, int(src_w * (1 - 2 * cx)))
        crop_h = max(16, int(src_h * (1 - 2 * cx)))
        # ensure even dimensions (H.264 requires)
        crop_w -= crop_w % 2
        crop_h -= crop_h % 2
        filters.append(f"crop={crop_w}:{crop_h}")
        filters.append(f"scale={src_w}:{src_h}")

    # Kinetic zoom push — slow constant zoom over the full clip duration.
    # zoompan needs FPS + frame count; we approximate with a slow per-frame step.
    if params.zoom_push > 0:
        # 0.0001 per frame ≈ 0.3% over 30 frames ≈ ~1% per second at 30fps.
        # Step chosen so the total push lands near zoom_push over ~5-10 seconds typical.
        step = params.zoom_push / 200.0
        max_zoom = 1.0 + params.zoom_push
        filters.append(
            f"zoompan=z='min(zoom+{step:.6f},{max_zoom:.4f})':d=1:s={src_w}x{src_h}:fps=30"
        )

    # color transforms
    eq_parts = []
    if params.brightness != 0.0:
        eq_parts.append(f"brightness={params.brightness:.4f}")
    if params.contrast != 1.0:
        eq_parts.append(f"contrast={params.contrast:.4f}")
    if params.saturation != 1.0:
        eq_parts.append(f"saturation={params.saturation:.4f}")
    if params.gamma != 1.0:
        eq_parts.append(f"gamma={params.gamma:.4f}")
    if eq_parts:
        filters.append("eq=" + ":".join(eq_parts))

    # hue shift
    if params.hue_shift_deg != 0.0:
        filters.append(f"hue=h={params.hue_shift_deg:.2f}")

    # vignette — subtle corner darkening
    if params.vignette:
        filters.append("vignette=angle=PI/5")

    # noise (levels 3 + 4, heavier at 4)
    if params.noise_strength > 0:
        filters.append(f"noise=alls={params.noise_strength:.1f}:allf=t")

    # Colorspace roundtrip (opt-in) — forces chroma subsample roundtrip for extra
    # pixel-level perturbation. Kept subtle.
    if params.colorspace_roundtrip:
        filters.append("format=yuv444p,format=yuv420p")

    # fps shift (target_fps set by level 4 roll)
    if params.fps_shift and params.target_fps:
        filters.append(f"fps={params.target_fps}")

    # speed change (via setpts)
    if params.speed != 1.0:
        filters.append(f"setpts={1.0 / params.speed:.6f}*PTS")

    return ",".join(filters) if filters else "null"


def _build_audio_filter(params: SanitizeParams, src_sample_rate: int = 44100) -> Optional[str]:
    filters: list[str] = []

    # Pitch shift (opt-in) — asetrate trick, independent of tempo.
    # Shift factor: 2^(semitones/12). asetrate changes both pitch and tempo;
    # we re-tempo back to 1.0× so only pitch changes.
    if params.pitch_shift_semitones != 0.0:
        factor = 2.0 ** (params.pitch_shift_semitones / 12.0)
        shifted_rate = int(src_sample_rate * factor)
        filters.append(f"asetrate={shifted_rate}")
        filters.append(f"aresample={src_sample_rate}")
        # Undo the tempo change asetrate introduced. atempo range is 0.5-2.0,
        # safe at our semitone ranges (±2 semitones -> factor ~0.89 to 1.12).
        filters.append(f"atempo={1.0/factor:.6f}")

    if params.speed != 1.0:
        # atempo accepts 0.5-2.0; within our 0.93-1.07 range always fine
        filters.append(f"atempo={params.speed:.6f}")

    return ",".join(filters) if filters else None


def sanitize_video(
    input_path: str,
    output_path: str,
    level: int = 2,
    flip_horizontal: bool = False,
    delogo: Optional[dict] = None,
    pitch_shift: bool = False,
    colorspace_roundtrip: bool = False,
) -> dict:
    """Main entry point. Reads input_path, writes sanitized output to output_path,
    returns a report dict. Raises on ffmpeg failure."""
    if level not in (1, 2, 3, 4):
        raise ValueError(f"Invalid level: {level}")

    probe = analyze_video(input_path)
    src_w = probe.get("width") or 1080
    src_h = probe.get("height") or 1920
    duration = probe.get("duration_s") or 0.0

    # Parse source fps from probe (e.g. "30/1" -> 30.0, "30000/1001" -> 29.97)
    source_fps: Optional[float] = None
    fps_str = probe.get("fps")
    if fps_str and "/" in str(fps_str):
        try:
            num, den = fps_str.split("/", 1)
            source_fps = float(num) / float(den) if float(den) else None
        except (ValueError, ZeroDivisionError):
            source_fps = None

    params = _roll_params(
        level,
        flip_horizontal=flip_horizontal,
        delogo=delogo,
        pitch_shift=pitch_shift,
        colorspace_roundtrip=colorspace_roundtrip,
        source_fps=source_fps,
    )
    actions: list[str] = []

    # ---- Level 1: container/metadata strip only, no re-encode ----
    if level == 1:
        cmd = [
            FFMPEG, "-y",
            "-i", input_path,
            "-map", "0",
            "-map_metadata", "-1",
            "-map_chapters", "-1",
            "-metadata:s:v", "handler_name=",
            "-metadata:s:a", "handler_name=",
            "-c", "copy",
            "-movflags", "+faststart",
            output_path,
        ]
        _run(cmd)
        actions.append("Stripped all container + stream metadata (no re-encode)")
        actions.append("Cleared handler_name tags")
        actions.append("Rewrote moov atom with faststart")
        return {
            "level": 1,
            "preset_name": "Quick Clean",
            "actions": actions,
            "params": params.as_dict(),
            "probe": probe,
        }

    # ---- Level 2 + 3 + 4: re-encode with transforms ----
    trim_head_s = params.trim_head_ms / 1000.0
    trim_tail_s = params.trim_tail_ms / 1000.0
    out_duration = max(0.5, duration - trim_head_s - trim_tail_s) if duration else 0

    vf = _build_video_filter(params, src_w, src_h)
    af = _build_audio_filter(params)

    # Two-pass re-encode (level 4): first encode to a lossless intermediate
    # (ffv1 in matroska) applying all transforms, then re-encode to final H.264.
    # This fully resets the encoder signature twice.
    if params.two_pass:
        workspace = Path(output_path).parent
        intermediate = workspace / f"intermediate-{uuid.uuid4().hex[:8]}.mkv"

        # Pass 1: apply all transforms -> lossless intermediate (no trim yet to keep simple)
        cmd1 = [FFMPEG, "-y"]
        if trim_head_s > 0:
            cmd1 += ["-ss", f"{trim_head_s:.3f}"]
        cmd1 += ["-i", input_path]
        if out_duration > 0:
            cmd1 += ["-t", f"{out_duration:.3f}"]
        cmd1 += ["-vf", vf]
        if af:
            cmd1 += ["-af", af]
        cmd1 += [
            "-c:v", "ffv1",
            "-level", "3",
            "-c:a", "pcm_s16le",
            "-map_metadata", "-1",
            str(intermediate),
        ]
        _run(cmd1, timeout=900)

        # Pass 2: fresh encode from lossless intermediate to H.264/AAC
        cmd2 = [
            FFMPEG, "-y",
            "-i", str(intermediate),
            "-c:v", "libx264",
            "-preset", params.preset,
            "-crf", str(params.crf),
            "-profile:v", "high",
            "-pix_fmt", "yuv420p",
            "-g", str(params.gop_size),
            "-c:a", "aac",
            "-b:a", "128k",
            "-map_metadata", "-1",
            "-map_chapters", "-1",
            "-metadata:s:v", "handler_name=",
            "-metadata:s:a", "handler_name=",
            "-movflags", "+faststart",
            output_path,
        ]
        _run(cmd2, timeout=900)

        try:
            intermediate.unlink()
        except OSError:
            pass
    else:
        # Single-pass encode (levels 2 + 3)
        cmd = [FFMPEG, "-y"]
        if trim_head_s > 0:
            cmd += ["-ss", f"{trim_head_s:.3f}"]
        cmd += ["-i", input_path]
        if out_duration > 0:
            cmd += ["-t", f"{out_duration:.3f}"]

        cmd += ["-vf", vf]
        if af:
            cmd += ["-af", af]

        cmd += [
            "-c:v", "libx264",
            "-preset", params.preset,
            "-crf", str(params.crf),
            "-profile:v", "high",
            "-pix_fmt", "yuv420p",
            "-g", str(params.gop_size),
            "-c:a", "aac",
            "-b:a", "128k",
            "-map_metadata", "-1",
            "-map_chapters", "-1",
            "-metadata:s:v", "handler_name=",
            "-metadata:s:a", "handler_name=",
            "-movflags", "+faststart",
            output_path,
        ]
        _run(cmd, timeout=900)

    # Build action log
    if params.two_pass:
        actions.append("Two-pass re-encode (ffv1 intermediate → H.264/AAC)")
    else:
        actions.append("Re-encoded H.264/AAC with fresh encoder state")
    actions.append(f"Preset {params.preset} / CRF {params.crf} / GOP {params.gop_size}")
    if params.crop_percent > 0:
        actions.append(f"Cropped {params.crop_percent:.2f}% per edge + rescaled")
    if params.rotation_deg != 0:
        actions.append(f"Rotation {params.rotation_deg:+.2f}°")
    if params.flip_horizontal:
        actions.append("Horizontal flip applied")
    if params.zoom_push > 0:
        actions.append(f"Kinetic zoom push +{params.zoom_push * 100:.1f}%")
    if params.vignette:
        actions.append("Subtle vignette overlay")
    if params.saturation != 1.0 or params.hue_shift_deg != 0.0 or params.contrast != 1.0:
        actions.append(
            f"Color shift: sat {params.saturation:.3f}, hue {params.hue_shift_deg:+.2f}°, "
            f"contrast {params.contrast:.3f}, gamma {params.gamma:.3f}"
        )
    if params.colorspace_roundtrip:
        actions.append("Chroma subsample roundtrip (yuv444p → yuv420p)")
    if trim_head_s or trim_tail_s:
        actions.append(f"Trimmed {params.trim_head_ms}ms head / {params.trim_tail_ms}ms tail")
    if params.fps_shift and params.target_fps:
        actions.append(f"Frame rate shifted to {params.target_fps} fps")
    if params.speed != 1.0:
        actions.append(f"Speed {params.speed:.3f}× (video + audio)")
    if params.pitch_shift_semitones != 0.0:
        actions.append(f"Audio pitch shift {params.pitch_shift_semitones:+.1f} semitones (tempo preserved)")
    if params.noise_strength > 0:
        actions.append(f"Grain overlay at strength {params.noise_strength:.1f}")
    if params.delogo:
        d = params.delogo
        actions.append(f"delogo mask at {d['x']},{d['y']} {d['w']}×{d['h']}")
    actions.append("Stripped all metadata + handler names")
    actions.append("Rewrote moov atom with faststart")

    preset_name = {2: "Deep Clean", 3: "Full Scrub", 4: "Nuclear"}.get(level, "Custom")
    return {
        "level": level,
        "preset_name": preset_name,
        "actions": actions,
        "params": params.as_dict(),
        "probe": probe,
    }


def make_temp_workspace(prefix: str = "vidsan-") -> Path:
    """Make a fresh temp dir for one sanitize job. Caller is responsible for cleanup."""
    return Path(tempfile.mkdtemp(prefix=prefix))


def cleanup_workspace(workspace: Path) -> None:
    try:
        shutil.rmtree(workspace, ignore_errors=True)
    except Exception as e:
        logger.warning("Failed to cleanup workspace %s: %s", workspace, e)
