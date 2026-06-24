# Opening-Frame Thumbnail Picker

## Problem

The video thumbnail picker (`AdCreativeStep.jsx` modal, fed by `facebook_service.extract_video_frames`) never samples t=0 — earliest sample is t=0.4s — and applies PIL hard-rejects (brightness <15 or >240, contrast <18) before the UI sees any frame. Opening frames are frequently the clickbaity hook clip the user wants as the feed thumbnail, but they're routinely culled (black fade-ins, title cards, white flashes) or never sampled in the first place.

## Change

Force-include the first 4 early-video frames in the picker, bypassing all filters.

### Backend (`backend/app/services/facebook_service.py`)

`extract_video_frames` changes:

- Add `forced_timestamps = [0.0, 0.1, 0.25, 0.5]`, filtered to `t < duration`.
- Extract those frames via ffmpeg the same way as the rest.
- **Bypass** PIL brightness/contrast hard-rejects and Gemini scoring for forced frames. They always ship.
- Returned list: forced frames first (chronological), then existing AI-ranked survivors. Filenames use a distinct prefix (`opening_00.jpg`, `opening_01.jpg` …) so they don't collide with `frame_NN.jpg` in the cache folder or the `ai_scores_v2.json` cache.
- Return shape: keep `list[str]` for backward-compat; add a sibling `opening_count` field in the API response.

### API (`backend/app/api/v1/facebook.py` `extract_video_frames` endpoint)

Response JSON changes from `{frames: string[]}` to `{frames: string[], opening_count: int}`. Existing callers that only read `frames` still work.

### Frontend

- `frontend/src/lib/facebookApi.js` `extractVideoFrames()`: pass through `opening_count` alongside `frames`.
- `frontend/src/components/AdCreativeStep.jsx`:
  - Store `openingCount` next to `thumbFrames` in state.
  - In the picker modal grid, tiles with `index < openingCount` get an "Opening" badge (replacing the numeric frame index on those tiles).
  - No layout change — just badge text.

## Out of scope

- Separate row/section for opening frames (user chose mixed grid).
- Configurable opening-frame count.
- Changing AI scoring or Gemini behavior.
- Retroactive re-extraction for videos already cached (next picker open re-extracts naturally since forced filenames don't exist yet).

## Cache behavior

- `uploads/thumbnails/<video_id>/` already exists per video. Adding `opening_*.jpg` files is additive.
- `ai_scores_v2.json` is keyed by filename; opening frames aren't scored so they never enter the cache. No invalidation needed.
- Re-opening the picker for an already-cached video re-runs ffmpeg extraction for opening frames (4 extra ffmpeg calls, ~1s total). Acceptable.

## Success criteria

- Picker modal shows ~16 frames, with the first 4 visibly tagged "Opening."
- Selecting an opening frame sets `creative.thumbnailUrl` identically to any other frame (no downstream changes).
- Black-intro videos (previously "no useful opening frame") now have pickable t=0/0.1/0.25/0.5 tiles.
- No regression in current AI-ranked frames.
