# `/videoad` Skill — Fal.ai-Powered Video Ad Creation

**Date:** 2026-04-16
**Owner:** Roly
**Status:** Design approved, ready for implementation plan

## Goal

A CLI skill that analyzes a competitor video ad, reverse-engineers the concept for one of the user's offers, generates a scene-by-scene script, and funnels it to Fal.ai to produce a real video — all from a single terminal command. Minimal human involvement. Costs tracked per offer.

## Key Insight — Almost Nothing Needs a Backend

The MVMT Printer backend is not in the critical path for this skill. The only reused piece is `fal_client` (already installed via `backend/requirements.txt==0.13.0`), and that runs locally inside the skill's own Python. Videos land on disk at `~/videos/<offer>/...`. Cost tracking is an append-only jsonl. No Railway deploys, no DB migrations, no R2 plumbing.

### Already built (reuse)
- `fal_client==0.13.0` — pattern in `backend/app/api/v1/generated_ads.py` (`fal_client.subscribe()`)
- Offer briefs — user has 5 briefs loaded at `~/.claude/offers/*.md` with YAML frontmatter (slug, name, price, target)
- Gemini vision prompt library in `backend/app/api/v1/video_analysis.py` (DR-copy framework: PAS/AIDA/BAB, 7 Laws, 10 headline formulas, tone guidance) — copy the prompt philosophy, not the FastAPI route
- `claude -p` OAuth pattern for zero-cost Claude calls (per user memory `feedback_oauth_generation.md`)
- `/spy`, `/rip`, `/redtrack`, `/uptime`, `/domain` pattern for skill structure

### What `/videoad` adds
1. Input normalizer — URL or local file → local `.mp4` (yt-dlp for YouTube/TikTok/X, FB Ad Library handler, direct download for raw URLs, pass-through for local files)
2. Gemini teardown module — analyzes competitor video for hook, pacing beats, visual style, text overlays, voiceover, copy framework, CTA
3. Claude concept module — takes teardown + offer brief, produces reverse-engineered concept for the user's offer (angle translation, hook rewrites, compliance flags)
4. Claude script module — concept → scene-by-scene script with suggested Fal model + estimated cost; user approval gate before spending money
5. Fal generator — calls selected model via `fal_client.subscribe()`, downloads output
6. Cost tracker — append-only jsonl per offer, `/videoad stats` summary command
7. Skill surface — `~/.claude/skills/videoad/SKILL.md` with command parsing

## Scope

- Input: any competitor video URL or local video file
- Context: one of the user's offer briefs from `~/.claude/offers/<slug>.md`
- Output: one generated `.mp4` per run, saved locally, with Fal URL and cost logged
- Surface: `/videoad` CLI command, no UI, no backend

## Non-Goals

- **No UI.** `frontend/src/pages/VideoAds.jsx` stubs are untouched. If later desired, the skill's stages can be lifted into `/api/v1/fal-video/*` endpoints without rewriting core logic.
- **No backend.** Zero MVMT Railway changes.
- **No multi-variant batching in v1.** One script → one video per run. Run the skill again for variants.
- **No auto-publish.** Output is a local file path. User manually uploads to Meta wherever they already do it.
- **No R2 upload of generated videos in v1.** Files live on local disk. R2 sync is a future enhancement.
- **No persistent database of runs.** Jsonl log is the source of truth.
- **No comment/copy regeneration pipelines** — those already exist in `video_analysis.py` and are not duplicated here.

## Architecture

```
User types: /videoad <competitor-url-or-file> [--offer <slug>] [--model <fal-id>] [--aspect 9:16|1:1|16:9]

┌─────────────────────────────────────────────────────────────────────────┐
│                    ~/.claude/skills/videoad/                             │
│                                                                          │
│  SKILL.md  ← command parsing, user-facing instructions                   │
│  lib/                                                                    │
│    input_fetcher.py    ← URL/file → local .mp4                           │
│    teardown.py         ← Gemini vision analysis                          │
│    concept.py          ← Claude reverse-engineer for offer               │
│    script.py           ← Claude script + Fal model suggestion            │
│    fal_runner.py       ← fal_client.subscribe() wrapper                  │
│    model_catalog.py    ← curated Fal model list + routing rules          │
│    offer_loader.py     ← read + validate ~/.claude/offers/<slug>.md      │
│    cost_tracker.py     ← append to ~/.claude/offers/<slug>.jsonl         │
│    run_dir.py          ← create/resume per-run artifact directories      │
│  cli.py                ← argparse entrypoint wired from SKILL.md         │
└─────────────────────────────────────────────────────────────────────────┘
```

Python deps: `fal-client`, `google-generativeai`, `httpx`, `python-frontmatter`, `rich` (pretty CLI). Shell-outs: `yt-dlp` (CLI invocation), `ffmpeg`/`ffprobe`, `claude -p` (OAuth-based Claude per user memory `feedback_oauth_generation.md` — avoids API credit spend). Installed in a dedicated venv at `~/.claude/skills/videoad/venv/` — decided in the plan.

## Commands

```
/videoad <input> [--offer <slug>] [--model <fal-id>] [--aspect 9:16|1:1|16:9]
         [--image <path>] [--fast] [--premium]
         [--dry-run] [--resume <run-id>] [--yes]
/videoad models [--refresh]          # list curated Fal models + costs
/videoad stats [--offer <slug>]      # total $ spent, run count, avg cost
/videoad new-offer <slug>            # opens $EDITOR on a templated ~/.claude/offers/<slug>.md
/videoad edit-offer <slug>           # opens existing offer file in $EDITOR
/videoad refresh-offer <slug>        # prints the re-export prompt, prompts for paste, overwrites
```

Flag reference:
- `--image <path>` — source image for image-to-video models (required for I2V if no `product_shots` in offer file)
- `--fast` — shortcut for `--model fal-ai/minimax/hailuo-02/standard`
- `--premium` — shortcut for `--model fal-ai/veo/3.1`
- `--dry-run` — run stages 0-3 (teardown, concept, script) and skip Fal call
- `--resume <run-id>` — resume a run from its last completed stage
- `--yes` — skip the script-approval gate (for automation)

Primary path: one-arg invocation with sensible defaults. `--yes` skips the script-approval gate (for automation).

## Pipeline

Each run creates:
```
~/videos/<offer-slug>/<YYYY-MM-DD-HHMM>-<run-id>/
  00-input/
    source.mp4
    metadata.json          ← source url, platform, duration, resolution
  01-teardown.md           ← Gemini analysis
  02-concept.md            ← Claude reverse-engineer for <offer>
  03-script.json           ← scene-by-scene script + model recommendation + cost estimate
  04-generation/
    fal-job.json           ← request + response from fal_client
    out.mp4                ← downloaded final video
  run.log                  ← chronological log
```

And appends one line to `~/.claude/offers/<offer-slug>.jsonl`.

### Stage 0 — Input fetch (`input_fetcher.py`)
| Input pattern | Handler |
|---|---|
| `https://www.facebook.com/ads/library/?id=...` | Custom FB Ad Library extractor (DOM scrape for video URL) |
| `https://www.youtube.com/...`, `youtu.be/...` | `yt-dlp` |
| `https://www.tiktok.com/...` | `yt-dlp` |
| `https://twitter.com/...`, `x.com/...` | `yt-dlp` |
| `*.mp4`, `*.mov`, `*.webm` URL | `httpx` direct download |
| Local path (absolute or `./relative`) | pass-through |

Normalizes to `.mp4`, max 60 seconds, transcodes via `ffmpeg` if larger. Probes dimensions/duration with `ffprobe`. Writes `metadata.json`.

**Failure mode:** prints the fetch error, suggests `--local <path>` fallback, exits nonzero.

### Stage 1 — Teardown (`teardown.py`)
Uploads the local `.mp4` to Gemini 2.0 Flash (`gemini-2.0-flash-exp`). Prompt extracts:
- **Hook** — first 1-3 second attention-grabber (verbatim transcript + visual description)
- **Pacing** — beat map: 0-3s / 3-8s / 8-15s / 15-30s / CTA, with what happens in each
- **Visual style** — UGC vs produced, aspect ratio, lighting, setting, color grade, on-screen text style
- **Voiceover** — full transcript, tone, pace, accent/demo
- **Copy framework** — which DR framework it uses (PAS/AIDA/BAB/open-loop/pain-mirror/etc.), scored against the 10 headline formulas from `video_analysis.py`
- **CTA** — exact words, placement timing, visual treatment

Output is a structured markdown file. Prompt reuses philosophy from `video_analysis.py` but targets teardown, not generation.

**Cost:** ~$0.01 per video (Gemini 2.0 Flash is cheap).

### Stage 2 — Concept (`concept.py`)
Takes `01-teardown.md` + `~/.claude/offers/<slug>.md`. Sends to Claude Sonnet via `claude -p` (OAuth, no API spend per user memory).

Prompt asks Claude to:
1. **Angle translation** — how does the competitor's angle map to the user's offer? What changes?
2. **Hook rewrites** — 3 rewrites of the competitor hook tailored to the user's offer, using hooks from the offer brief when they fit
3. **Reason-why** — what unique mechanism from the offer brief replaces the competitor's mechanism?
4. **Compliance audit** — flag any banned claims (from offer `banned_claims` section) that the competitor's copy uses and must be rewritten
5. **Visual translation** — if competitor uses product shots we can't replicate, suggest substitutions using assets the user likely has

Output: structured markdown `02-concept.md`.

### Stage 3 — Script + approval gate (`script.py`)
Claude Sonnet again. Takes concept → produces:
- Scene-by-scene shot list (timestamp, visual description, VO/dialogue, on-screen text)
- Aspect ratio recommendation (from offer target demo: 9:16 for FB/IG mobile default)
- **Suggested Fal model** (with alternatives):
  - Talking-head UGC → `fal-ai/kling-video/v2.1-master/text-to-video`
  - Product/B-roll → `fal-ai/kling-video/v2.1/image-to-video`
  - Fast/cheap — `fal-ai/minimax/hailuo-02/standard`
  - Premium/audio — `fal-ai/veo/3.1`
- **Estimated cost** (from `model_catalog.py` static table, refreshed weekly)

Writes `03-script.json`.

**Approval gate:** prints the script, model, and cost estimate to terminal. Waits for `y`/`n`/`edit`. `edit` opens `03-script.json` in `$EDITOR`, re-reads, re-prompts. `--yes` flag skips the gate.

### Stage 4 — Fal generation (`fal_runner.py`)
Calls `fal_client.subscribe(model_id, arguments={...}, with_logs=True)`. Supports both text-to-video (prompt only) and image-to-video (needs a source image — for product shots, uses the first image in the offer's `product_shots` directory if defined, else prompts user to provide `--image <path>`).

Streams Fal progress logs to terminal via `rich.progress`. On completion, downloads the video to `04-generation/out.mp4`. Writes `fal-job.json` with full request + response.

**Failure modes:**
- `FAL_KEY` missing → print setup instructions, exit
- Fal safety rejection (NSFW etc.) → surface Fal's reason, suggest script edits, log as `status:"rejected"` with `cost_usd: 0`
- Fal API error → log as `status:"failed"` with `cost_usd: 0`, print error, exit nonzero

### Stage 5 — Cost tracking (`cost_tracker.py`)
Appends one line to `~/.claude/offers/<slug>.jsonl`:
```json
{
  "ts": "2026-04-16T19:30:00Z",
  "run_id": "ab12cd",
  "run_dir": "~/videos/akemi-slim-patch/2026-04-16-1930-ab12cd/",
  "offer": "akemi-slim-patch",
  "competitor_source": "https://facebook.com/ads/library/?id=...",
  "model": "fal-ai/kling-video/v2.1-master/text-to-video",
  "aspect": "9:16",
  "duration_s": 8,
  "cost_usd": 1.40,
  "status": "completed",
  "output_path": "~/videos/akemi-slim-patch/2026-04-16-1930-ab12cd/04-generation/out.mp4",
  "fal_url": "https://fal.media/files/..."
}
```

`/videoad stats --offer <slug>` → reads the jsonl, prints total $, run count, avg cost, last 10 runs, success rate, breakdown by model.

## Fal Model Catalog

Static catalog in `lib/model_catalog.py`, refreshable via `/videoad models --refresh`:

| Model ID | Category | Input | Default Duration | Est. Cost | Notes |
|---|---|---|---|---|---|
| `fal-ai/kling-video/v2.1-master/text-to-video` | UGC/human | text | 5s | $1.40 | Best human realism, use for talking-head |
| `fal-ai/kling-video/v2.1/image-to-video` | Product | image+text | 5s | $0.95 | Animates a still |
| `fal-ai/kling-video/v2.1-master/image-to-video` | Product premium | image+text | 5s | $2.00 | Higher fidelity I2V |
| `fal-ai/minimax/hailuo-02/standard` | Fast/cheap | text | 6s | $0.28 | Iteration workhorse |
| `fal-ai/minimax/hailuo-02/pro` | Balanced | text | 6s | $0.48 | Better than standard |
| `fal-ai/veo/3.1` | Premium + audio | text | 8s | $6.00 | Native audio track |
| `fal-ai/runway-gen4` | Cinematic | text/image | 5s | $2.25 | Strong B-roll |
| `fal-ai/luma-dream-machine` | Creative | text/image | 5s | $1.00 | Artsy, good I2V |
| `fal-ai/bytedance/seedance-pro` | New cinematic | text/image | 5s | $0.80 | Competitive newcomer |

`--model` accepts any Fal video model ID; catalog only gates the *default* routing and cost-estimate display. Unknown models fall back to `cost_usd: null` in the log.

Auto-routing rules (overridable):
- Detected talking-head UGC + no product image → `kling-v2.1-master text-to-video`
- Product/B-roll + has `product_shots` in offer → `kling-v2.1 image-to-video`
- User passes `--fast` → `minimax/hailuo-02/standard`
- User passes `--premium` → `veo/3.1`

## Offer File Format

Frozen as of 2026-04-16 (already in use). Required frontmatter: `slug`, `name`, `target`. Optional: `price`, `language`, `landing_url`, `product_shots` (list of absolute paths to product images for I2V runs).

Required markdown sections (validated at load):
- `## Primary angle`
- `## USPs (3)`
- `## Proven hooks (5-8)`
- `## Mechanism (the "because")`
- `## Banned claims`

Optional but recommended:
- `## Pain points (sensory specifics)`
- `## Common objections + counters`
- `## Compliance notes`
- `## Visual / tone notes`
- `## Proven competitor refs`

Missing required sections → `offer_loader.py` prints which ones are missing + which slug, exits nonzero.

## Error Handling

| Failure point | Behavior |
|---|---|
| Missing `FAL_KEY` | Print setup: `export FAL_KEY=...` + link to fal.ai dashboard. Exit. |
| Offer slug not found | List available slugs from `~/.claude/offers/*.md`, exit. |
| Offer file invalid | Name missing sections + line numbers, exit. |
| Input fetch fails | Show error, suggest `--local <path>`, exit. |
| Transcoding fails | Check `ffmpeg` installed, suggest fix, exit. |
| Gemini quota/error | Save stage 0 output, show error, suggest `--resume <run-id>`. |
| Claude quota/OAuth lapsed | Suggest `claude login`, `--resume <run-id>`. |
| Fal generation fails | Log jsonl with `status:"failed"`, `cost_usd: 0`. Print Fal error. |
| Fal safety rejection | Log jsonl with `status:"rejected"`. Suggest script edits. |
| User aborts at approval gate | Save all stages up to script, log `status:"aborted"`. `--resume` supported. |

`--resume <run-id>` finds the run dir and skips to the first incomplete stage.

## Testing

Minimal — this is a dev tool, not a product.

- **Unit:** `offer_loader` validation, `cost_tracker` jsonl append, `model_catalog` routing rules. Pytest-based, lives in `~/.claude/skills/videoad/tests/`.
- **Smoke:** `/videoad <sample-local-mp4> --offer akemi-slim-patch --dry-run` — runs stages 0-3, skips Fal call, asserts `03-script.json` is valid JSON with required keys. Documented in SKILL.md. Fixture video checked into skill dir.

No end-to-end Fal test in CI (costs money).

## Security / Privacy

- `FAL_KEY`, `GEMINI_API_KEY` read from user env or `~/.claude/.env`. Never committed, never logged.
- Offer briefs may contain proprietary angles — files are user-local only.
- Fal job URLs returned in jsonl are Fal-hosted and eventually expire; local `.mp4` is the durable copy.
- No telemetry.

## Open Questions (resolved)

All clarifying questions answered during brainstorming:
- Entry point → CLI skill only (not UI, not /spy-integrated)
- Offer source → `~/.claude/offers/*.md`
- Input types → any (URL or local file)
- Backend → none
- Model selection → auto-routed with `--model` override, full Fal catalog supported
- Output → one video per run, local disk
- Cost tracking → append-only jsonl per offer
- Approval gate → script-level, skippable with `--yes`

## Implementation Plan

To be produced by the `superpowers:writing-plans` skill after this design is approved.

Anticipated structure:
1. Scaffold skill dir + SKILL.md + venv
2. `offer_loader.py` (+ unit tests) — no external deps, smallest isolated unit first
3. `cost_tracker.py` (+ unit tests)
4. `model_catalog.py` (+ unit tests)
5. `input_fetcher.py` — yt-dlp + httpx + FB Ad Library
6. `teardown.py` — Gemini wrapper
7. `concept.py` + `script.py` — Claude wrappers via `claude -p`
8. `fal_runner.py` — fal_client wrapper
9. `cli.py` — argparse wiring all stages together
10. `SKILL.md` — user-facing command docs
11. End-to-end smoke test with dry-run
12. Live test against a real FB Ad Library video for one offer

Stages 2-9 are mostly independent; subagents can parallelize where sensible.
