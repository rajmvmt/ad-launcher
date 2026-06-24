# OpenMontage Integration — Design Spec

**Date:** 2026-04-18
**Status:** Draft, awaiting user review
**Author:** Roly (with Claude)

## Purpose

Install [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) as-is and expose it through two surfaces — a `/openmontage` Claude Code skill for terminal use, and a new `/montage` page inside MVMT Printer for browser use. Both surfaces drive the same engine (a forked OpenMontage repo) to produce full video productions (multi-scene clips + voiceover + music + captions + title cards), not single Fal clips.

Replaces ad-hoc video generation in `/videoad` for multi-scene production work. `/videoad` remains as-is for single-clip reference rips; no shared code.

## Goals

1. Stand up a production-grade video generation system using OpenMontage's 52 tools, 11 pipelines, 7-dimension provider scoring, and all quality gates.
2. Make it reachable from two places with the same quality output:
   - Terminal via `/openmontage` skill
   - MVMT Printer UI via a new `/montage` page
3. Pipe generated videos back into MVMT's Create FB Campaigns wizard so a finished montage can become an ad creative with one click.
4. Keep the blast radius small: no changes to `/videoad`, no touching other MVMT features.

## Non-goals

- Building a parallel engine. We install OpenMontage verbatim; our code is glue + one custom pipeline.
- Replacing `/videoad`. Distinct tool for distinct job.
- Selling or productizing this publicly. Personal use only (AGPL-3.0 acceptable for this reason).
- Supporting all 11 built-in pipelines through MVMT UI on day one. MVMT UI surfaces only `facebook-ad`; skill can drive any pipeline.

## High-level architecture

```
openmontage/ (forked repo)
├── pipeline_defs/
│   ├── explainer.yaml               ← upstream, unchanged
│   ├── trailer.yaml                 ← upstream, unchanged
│   ├── ...                          ← 9 more upstream pipelines
│   └── facebook-ad.yaml             ← OUR ADDITION
├── skills/pipelines/
│   ├── explainer/                   ← upstream, unchanged
│   └── facebook-ad/                 ← OUR ADDITION
├── tools/
│   ├── (52 upstream tools)          ← unchanged
│   ├── offer_loader.py              ← OUR ADDITION
│   └── r2_storage.py                ← OUR ADDITION
├── remotion-composer/               ← upstream, unchanged
├── lib/                             ← upstream, unchanged
└── .env.example                     ← amended with our vars

offer-briefs/ (new git repo)
├── akemi-detox-tea.md
├── akemi-slim-patch.md
└── ... (migrated from ~/.claude/offers/)

~/.claude/skills/openmontage/ (local Claude Code skill)
├── SKILL.md                         ← instructions for Claude Code session
└── bin/bootstrap.sh                 ← clones fork, syncs offers, activates venv

openmontage-worker (new Railway service)
├── Dockerfile                       ← Python 3.11 + Node 20 + ffmpeg
├── worker.py                        ← polls render_jobs, spawns Agent SDK sessions
└── requirements.txt

MVMT Printer backend (existing Railway service)
├── app/api/v1/montage.py            ← NEW router: POST/GET render, POST refresh-offers
├── app/models.py                    ← NEW RenderJob model
└── alembic/versions/xxxx_render_jobs.py  ← NEW migration

MVMT Printer frontend (existing Vercel/Railway service)
├── src/pages/Montage.jsx            ← NEW brief form + job list
├── src/components/montage/BriefForm.jsx
├── src/components/montage/JobRow.jsx
└── src/components/montage/PreviewPane.jsx
```

### Data flow

**Skill path (terminal):**
1. User invokes `/openmontage <brief>` in Claude Code.
2. Skill's bootstrap script clones/pulls the fork, syncs offer-briefs repo, activates Python venv.
3. Skill prints instructions for the **current Claude Code session** to orchestrate via OpenMontage (pipeline manifest + offer context + reference URL).
4. The agent (Claude Code itself) reads `pipeline_defs/facebook-ad.yaml` and `skills/pipelines/facebook-ad/*.md`, calls `tools/` functions in order through OpenMontage's tool registry, respects all quality gates.
5. Artifacts written to `~/videos/<offer-slug>/<run-id>/` locally; final video mirrored to R2 under `openmontage/<run-id>/final.mp4`.

**MVMT path (browser):**
1. User fills brief form on `/montage` page (offer dropdown, reference URL optional, duration, aspect, platform).
2. Frontend posts to `POST /api/v1/montage/render`. Backend inserts a row into `render_jobs` with `status='queued'` and returns the job id.
3. Frontend polls `GET /api/v1/montage/render/<id>` every 3s.
4. Worker (separate Railway service) polls `render_jobs` with `SELECT FOR UPDATE SKIP LOCKED`, claims next queued row.
5. Worker spawns a Claude Agent SDK session inside the OpenMontage fork directory with the brief as the prompt.
6. Agent SDK session runs the same pipeline the skill would, writes artifacts to R2, updates `render_jobs.status='completed'` with artifact URLs.
7. Frontend's next poll shows completed status + preview. User clicks "Send to campaign" → `final.mp4` URL populates a new row in `ad_creatives` and routes to the Create FB Campaigns wizard.

## Components

### Component 1 — OpenMontage fork

**Repo:** `github.com/<user>/OpenMontage` (fork of `calesthio/OpenMontage`)

**Purpose:** Primary source of truth for the engine. Contains all upstream tools + pipelines + composer, plus four files we add.

**Interface:** Standard OpenMontage contract — agent-driven. Caller is expected to be an LLM session (Claude Code or Claude Agent SDK) that reads pipeline manifests and invokes `tools/` functions.

**Dependencies:** Python 3.11+, Node 18+ (for Remotion), FFmpeg, optional GPU for local video models. Env vars: `FAL_KEY`, `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, plus our additions `OFFER_BRIEFS_DIR`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`, `OPENMONTAGE_MAX_COST_USD` (default 5).

**Upstream discipline:** Only four file additions; no edits to upstream files. Rebases on upstream `main` when pulling updates.

### Component 2 — `facebook-ad` pipeline (new)

**Files:**
- `pipeline_defs/facebook-ad.yaml` — stages, tools, review criteria, success gates
- `skills/pipelines/facebook-ad/teardown.md` — reference-analysis stage directions (only runs if reference URL provided)
- `skills/pipelines/facebook-ad/concept.md` — differentiate-for-our-offer stage
- `skills/pipelines/facebook-ad/script.md` — scene-by-scene script with hook/CTA discipline
- `skills/pipelines/facebook-ad/asset-gen.md` — provider selection + generation
- `skills/pipelines/facebook-ad/compose.md` — Remotion composition + captions + music
- `skills/pipelines/facebook-ad/post-review.md` — post-render self-review

**Key pipeline traits:**
- Duration range 15–90s
- Aspect ratios: 9:16 (default for FB/IG feed), 1:1, 16:9
- Always loads offer context via `tools/offer_loader` before script generation
- Teardown stage is optional (only runs when reference is supplied)
- Uses OpenMontage's existing quality gates unmodified

### Component 3 — `offer_loader` tool (new)

**File:** `tools/offer_loader.py`

**Purpose:** Expose synced offer briefs as a tool the agent can call.

**Interface:**
```python
class OfferLoader(BaseTool):
    def load(self, slug: str) -> dict:
        """Returns {slug, name, price, target, primary_angle, usps, proven_hooks,
                    mechanism, banned_claims, objections, compliance_notes, ...}"""
    def list(self) -> list[str]:
        """Returns all available slugs."""
```

Reads markdown from `$OFFER_BRIEFS_DIR` (filesystem path to the synced offer-briefs git clone). Parses YAML frontmatter + markdown sections into a dict matching the shape already used in `~/.claude/offers/<slug>.md`.

### Component 4 — `r2_storage` tool (new)

**File:** `tools/r2_storage.py`

**Purpose:** Upload final artifacts to Cloudflare R2 so MVMT frontend can display them.

**Interface:**
```python
class R2Storage(BaseTool):
    def upload(self, local_path: str, key: str) -> str:
        """Returns public URL."""
```

Uses `boto3` with R2 S3-compatible endpoint. Reuses the R2 bucket MVMT already uses (`R2_BUCKET_NAME` env var), prefixes keys with `openmontage/<run-id>/`.

### Component 5 — `offer-briefs` git repo (new)

**Location:** `github.com/<user>/offer-briefs` (private)

**Content:** One markdown file per offer, migrated verbatim from `~/.claude/offers/*.md`.

**Sync behavior:**
- Local: user keeps editing files under `~/offer-briefs/` (clone of the repo), commits when happy. `/videoad` and `/openmontage` both read from this path.
- Railway worker: clones on container build, pulls on demand when MVMT's `POST /api/v1/montage/refresh-offers` endpoint is called. Webhook from GitHub push → backend hits refresh endpoint → worker gets updated briefs within seconds.

**Migration:** One-time script copies `~/.claude/offers/*.md` into the new repo, pushes, then replaces the old `~/.claude/offers/` directory with a symlink to `~/offer-briefs/` so `/videoad` keeps working unchanged.

### Component 6 — `/openmontage` Claude Code skill (new)

**Location:** `~/.claude/skills/openmontage/`

**Files:**
- `SKILL.md` — instructions for the agent (current Claude Code session) on how to orchestrate
- `bin/bootstrap.sh` — idempotent: clones fork if missing, `git pull` if present, clones/pulls offer-briefs, activates venv, checks env vars, prints ready

**Runtime behavior:** When invoked as `/openmontage <brief>`:
1. Skill loads, bootstrap.sh runs to ensure repo + offers + venv ready.
2. Skill's `SKILL.md` instructs the agent to: cd into fork, read `pipeline_defs/facebook-ad.yaml`, follow stage director skills in order, use tool registry, respect all quality gates, write artifacts to `~/videos/<offer>/<run-id>/`, mirror to R2.
3. Current Claude Code session IS the orchestrator. OpenMontage's design requires this.

**No CLI.** No Python wrapper. The skill is a manifest + bootstrap.

### Component 7 — `openmontage-worker` Railway service (new)

**Location:** New directory in MVMT Printer repo at `worker/openmontage/` OR new standalone repo (decide during planning).

**Files:**
- `Dockerfile` — `python:3.11-slim` base, installs Node 20 (for Remotion), ffmpeg, Piper TTS, clones OpenMontage fork into `/opt/openmontage`
- `worker.py` — main loop
- `requirements.txt` — `anthropic[agent-sdk]`, `psycopg2-binary`, `boto3`

**Main loop:**
```python
while True:
    job = claim_next_job()  # SELECT FOR UPDATE SKIP LOCKED LIMIT 1
    if not job:
        sleep(5); continue
    try:
        refresh_offer_briefs()  # git pull on offer-briefs clone
        result = run_agent_sdk_session(
            workdir='/opt/openmontage',
            prompt=build_prompt(job),
            max_cost_usd=float(os.getenv('OPENMONTAGE_MAX_COST_USD', '5')),
            timeout_s=1800,
        )
        update_job(job.id, status='completed', artifacts=result.artifacts)
    except Exception as e:
        update_job(job.id, status='failed', error=str(e))
```

**Prompt shape:** `build_prompt(job)` produces something like:
```
You are operating inside the OpenMontage repo. Produce a {aspect} video of
{duration}s for offer {offer_slug}. {optional: Reference video at {url}}.
Use the facebook-ad pipeline (pipeline_defs/facebook-ad.yaml). Follow all
stage director skills in order. Respect all quality gates. Do not ask for
approval — proceed if cost estimate is under ${max_cost_usd}. Upload final
artifacts via the r2_storage tool with key prefix openmontage/{job.id}/.
Exit when post-render self-review passes.
```

**Cost enforcement:** Agent SDK session includes a tool-call interceptor that aborts if cumulative provider cost (tracked via OpenMontage's cost logger) would exceed `OPENMONTAGE_MAX_COST_USD`.

**Concurrency:** One worker instance, one job at a time (serial). Scale up later only if queue depth warrants.

### Component 8 — MVMT backend montage router (new)

**File:** `backend/app/api/v1/montage.py`

**Routes:**
- `POST /api/v1/montage/render` — body: `{offer_slug, reference_url?, duration_s, aspect, platform}` → inserts `render_jobs` row, returns `{job_id, status: 'queued'}`
- `GET /api/v1/montage/render/{job_id}` → returns current job row including artifact URLs when completed
- `GET /api/v1/montage/renders` → paginated list of user's jobs, newest first
- `POST /api/v1/montage/refresh-offers` → worker-only endpoint; triggers git pull on offer-briefs clone
- `POST /api/v1/montage/send-to-campaign/{job_id}` → creates `ad_creatives` row from final artifact, returns redirect URL into Create FB Campaigns wizard

**Mounted in `main.py`:** `app.include_router(montage.router, prefix='/api/v1/montage', tags=['montage'])`.

### Component 9 — `render_jobs` table (new)

**Migration:** `alembic/versions/xxxx_add_render_jobs.py`

**Columns:**
- `id` UUID PK
- `status` TEXT (queued/running/completed/failed)
- `offer_slug` TEXT
- `reference_url` TEXT NULLABLE
- `duration_s` INT
- `aspect` TEXT
- `platform` TEXT
- `brief_json` JSONB (full brief object for replay)
- `artifact_urls` JSONB NULLABLE (final.mp4, scene clips, script.json, etc.)
- `cost_usd` NUMERIC NULLABLE
- `error` TEXT NULLABLE
- `created_at`, `updated_at`, `claimed_at`, `completed_at`

**Indexes:** `(status, created_at)` for fast worker polling.

### Component 10 — MVMT frontend `/montage` page (new)

**Files:**
- `frontend/src/pages/Montage.jsx` — main page, combines BriefForm + JobList
- `frontend/src/components/montage/BriefForm.jsx` — controlled form: offer dropdown, reference URL, duration slider, aspect, platform
- `frontend/src/components/montage/JobRow.jsx` — per-job card: status badge, thumbnail, "preview" / "send to campaign" buttons
- `frontend/src/components/montage/PreviewPane.jsx` — inline mp4 player
- `frontend/src/hooks/useRenderJobs.js` — polling hook

**Route added to `App.jsx`:** `<Route path="/montage" element={<Montage />} />`

**Navigation:** Add "Montage" entry to existing sidebar.

## Non-functional requirements

- **Cost cap per run:** Hard fail if estimated spend > `$OPENMONTAGE_MAX_COST_USD` (default $5). Environment-tunable.
- **Timeout per run:** 30 minutes. Worker kills session, marks `failed` with timeout reason.
- **Retries:** 1 retry on transient failures (provider timeout, network). No retry on quality-gate failures or cost caps.
- **Concurrency:** Single worker, serial processing. Acceptable for personal use; revisit if queue grows.
- **Observability:** All runs logged to stdout (Railway logs); cost breakdowns persisted to `render_jobs.cost_usd` and `artifact_urls.cost_log_json`.
- **Offer brief sync lag:** ≤ 60 seconds from git push to worker seeing new content (via webhook-triggered refresh endpoint).

## Error handling

- **Missing env var:** worker + skill bootstrap both fail fast with clear message listing missing vars.
- **Offer slug not found:** backend returns 400 with available slugs; worker marks job failed.
- **Quality gate failure:** OpenMontage's gates already handle this — worker logs gate name + reason into `render_jobs.error`.
- **Cost overrun:** agent SDK session aborts mid-run; partial artifacts retained for debugging but job marked failed.
- **Railway container OOM:** single-worker concurrency keeps this rare; if it happens, job stays `running` until claimed_at is stale (>30 min) → reaper marks failed.

## Testing approach

- **Unit tests:** Only for our four additions (`offer_loader`, `r2_storage`, `facebook-ad.yaml` schema validation, backend routes). Don't test upstream OpenMontage code — trust their test suite.
- **Integration test:** End-to-end dry run using OpenMontage's `--dry-run` mode (no Fal spend) against a known offer slug. Asserts job lifecycle works from POST → worker → completed.
- **Manual UAT:** First three real runs through both surfaces, compared side-by-side against a `/videoad` baseline.

## Rollout plan

Ship in layers. Each layer is independently useful — don't wait for the next.

**Layer 0 — engine stands up (next 30 min):**
1. Fork OpenMontage, clone locally, run `make setup`.
2. Add required API keys to `.env` (FAL, Gemini, ElevenLabs, Anthropic).
3. Open the fork in this Claude Code session, run one built-in pipeline end-to-end (e.g., `explainer`) to confirm Remotion + Piper + Fal all work.
4. If output is a real video file — ship achieved for layer 0.

**Layer 1 — offers wired + facebook-ad pipeline:**
5. Migrate `~/.claude/offers/` → `offer-briefs` repo, symlink back so `/videoad` stays working.
6. Write `tools/offer_loader.py` + `tools/r2_storage.py`.
7. Write `pipeline_defs/facebook-ad.yaml` + `skills/pipelines/facebook-ad/*.md`.
8. Run once end-to-end for a real offer; tune prompts.

**Layer 2 — `/openmontage` skill:**
9. Write `SKILL.md` + `bootstrap.sh` under `~/.claude/skills/openmontage/`.
10. First `/openmontage <brief>` invocation.

**Layer 3 — MVMT backend + worker:**
11. `render_jobs` migration + model.
12. `/api/v1/montage/*` router.
13. `openmontage-worker` service on Railway.
14. Curl-driven end-to-end test.

**Layer 4 — MVMT frontend:**
15. `/montage` page + BriefForm + JobRow + PreviewPane.
16. Wire "send to campaign" into Create FB Campaigns flow.
17. First browser-driven render.

## Open questions (resolve during implementation)

- **Worker repo location:** subdirectory of MVMT Printer repo (simpler Railway deploy, tighter coupling) vs. standalone repo (cleaner separation, independent deploys). Default to subdirectory unless Railway has a constraint that forces separate.
- **Warm worker container:** Should we keep one always running to avoid cold-start Remotion bundles? Start with cold, measure, warm only if needed.
- **Agent SDK vs. `claude -p`:** for the worker, Agent SDK gives programmatic control but `claude -p` uses OAuth (no API credits). Try `claude -p` first since user prefers OAuth; fall back to Agent SDK if headless reliability is poor.

## Risks

- **AGPL-3.0 contamination:** worker is separate process, communicates with MVMT over DB/HTTP. MVMT backend does not import OpenMontage. Stays compliant. Closes the door on ever closed-sourcing MVMT — acceptable per user decision.
- **Agent orchestration unreliability:** agent may loop, fail gates indefinitely, or consume Claude credits faster than expected. Mitigations: timeout, cost cap, retries=1, per-run cost logged for trend analysis.
- **Upstream OpenMontage churn:** they may change pipeline manifest format or tool registry API. Mitigations: pin to a specific commit of the fork; upgrade deliberately via explicit rebase sessions.
- **Cloudflare R2 quota:** final videos can be 50–200MB each. Monitor bucket usage.
- **Editor bias for `/videoad`:** habit of running `/videoad` may prevent adoption of `/openmontage`. Not an engineering risk — user discipline only.

## Success criteria

1. One command (`/openmontage <brief>`) produces a full multi-scene production with VO + captions + music, end-to-end, from terminal, in under 30 minutes.
2. MVMT wizard can render the same production from browser, poll to completion, and one-click send to Create FB Campaigns.
3. Cost per render tracked in `render_jobs.cost_usd`; median run stays under $5.
4. All OpenMontage quality gates enforced — no raw slideshow output ships.
5. Offer briefs edit → commit → push → worker sees update within 60 seconds.
