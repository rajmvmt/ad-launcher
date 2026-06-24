# LiveIntent Spy — Design

**Date:** 2026-04-27
**Status:** Approved (brainstorming complete, pending written-spec review)
**Owner:** Roly

## Purpose

Build a tool that captures live ads from LiveIntent (the email-native ad
network that places ads inside publisher newsletters), so we can see which
advertisers are spending the most, what creatives they are running, and which
publishers are carrying them.

Output is a **Telegram-first daily digest** plus a **standalone web dashboard**,
backed by a scraping pipeline that subscribes to publisher newsletters and
parses LiveIntent ad slots out of rendered emails.

## Non-Goals

- Spend estimates beyond raw frequency / impression count.
- Cross-platform attribution (matching LiveIntent advertisers to Meta etc.).
- Multi-user auth or any paid/shared SaaS surface.
- Historical backfill — capture starts at deploy time.
- Browse-style UX over thumbnails. Dashboard is functional, not a swipe file.

## Constraints / Decisions

- **Cheapest viable MVP.** Single Hetzner box, no residential proxies on day
  one. Total infra spend target: ~$6/mo.
- **Hybrid collection.** Subscriber farm (primary) + publisher web-archive
  scrape (secondary, added in v2 once primary is stable).
- **5–10 seed publishers at MVP.** Expand to 25–100 once pipeline proven.
- **Ranking signals = frequency-as-spend-proxy + vertical clustering only.**
  Other signals (longevity, newness, reach, creative diversity) are deferred.
- **Vertical tagging = Claude auto-classify + manual override.** Auto runs via
  `claude -p` OAuth (free per existing project pattern). Manual overrides
  never overwritten by reclassification jobs.
- **Standalone repo and stack.** Not folded into MVMT Printer.

## Architecture

Three deployable units:

### 1. `scraper-worker` (Hetzner box, Python + Playwright)
Long-running process. Polls IMAP for the catch-all every 5 min, renders each
new email in headless Chromium with images on, locates LiveIntent ad slots via
DOM signature, screenshots each slot, captures the click-tracker URL, and
follows it server-side to resolve the final advertiser URL. Writes raw
captures to Postgres on the same box. Future: same worker handles
publisher-side web-archive scrape once we go hybrid.

### 2. `enrichment-worker` (Hetzner box, sibling process)
On each newly seen advertiser domain: fetches landing page, sends to
`claude -p` with a fixed taxonomy, stores inferred vertical. Also runs
Tesseract OCR on creative screenshots to extract headline text. Both results
cached forever, keyed by advertiser domain and creative hash respectively.

### 3. `api` (FastAPI on Railway) + `web` (Next.js on Vercel)
- **API** exposes endpoints for `/advertisers`, `/publishers`, `/creatives`,
  `/digest/today`, `/admin/override-vertical`, `/telegram/webhook`,
  `/digest/run`. Auth = single shared admin bearer token.
- **Web** is a thin dashboard reading the API. Single shared admin token in env.
- **Telegram bot** is a route on the same FastAPI service, plus a Railway cron
  hitting `/digest/run` at 9am UTC daily.

### Why three units
The scraper requires persistent state and a real residential-ish IP — Hetzner.
The API/web fits Vercel/Railway's deploy model. Splitting them means a scraper
crash does not take the dashboard offline (and vice versa).

## Data Model

Six tables in Postgres. Tight, no premature normalization.

### `publishers`
`id`, `domain` (unique, e.g. `morningbrew.com`), `name`,
`seed_email_address` (which inbox is subscribed), `subscribed_at`,
`last_email_received_at`, `active` (bool), `notes`.

### `emails_raw`
`id`, `publisher_id` (FK), `imap_uid`, `subject`, `received_at`, `from_addr`,
`raw_html_path` (filesystem path on Hetzner disk), `processed_at` (nullable),
`processing_error` (nullable text). Indexed on `(publisher_id, received_at)`.

### `advertisers`
`id`, `domain` (unique, e.g. `newchapter.com`), `display_name` (nullable, set
by enrichment), `vertical` (enum: `supplements | finance | insurance | sweeps |
auto | solar | health | crypto | other | unclassified`), `vertical_source`
(enum: `auto | manual`), `vertical_classified_at`, `first_seen_at`,
`last_seen_at`, `notes`.

### `creatives`
`id`, `advertiser_id` (FK), `creative_hash` (sha256 of normalized image bytes
— dedupes across captures, unique), `headline` (OCR'd text, nullable),
`screenshot_path`, `click_tracker_url`, `final_landing_url` (post-redirect),
`final_landing_url_resolved_at`, `first_seen_at`, `last_seen_at`.

### `impressions` (fact table)
`id`, `creative_id` (FK), `publisher_id` (FK), `email_id` (FK to
`emails_raw`), `seen_at`. Indexed on `(creative_id, seen_at)` and
`(publisher_id, seen_at)`. One row per ad slot we capture. All ranking queries
are `GROUP BY` over this table.

### `digest_runs`
`id`, `ran_at`, `window_start`, `window_end`, `top_advertisers_json`,
`telegram_message_id`. Audit trail of what got sent.

### Why this shape
- `advertisers`/`creatives` are dimensional; `impressions` is the fact table.
  All "top advertisers in last N days" queries are a single `GROUP BY` —
  fast, cheap, no precomputed rollups needed at MVP scale.
- `creative_hash` is critical: same ad shown across 10 publishers stays one
  creative row + 10 impression rows.
- `vertical_source` distinguishes auto-classified rows (overwriteable) from
  manually-corrected ones (sticky), so reclassification jobs never clobber
  manual fixes.

## Data Flow

### A. Onboard a publisher (manual, one-time)
1. Pick a publisher (e.g. `morningbrew.com`).
2. `liveintent-spy add-publisher morningbrew.com --email mb@<catchall>` — CLI
   inserts a `publishers` row, prints the publisher's signup URL.
3. Sign up manually using the catch-all address (most publishers require
   captcha + double opt-in; this is a one-time human step).
4. Once double opt-in completes, scraper picks up future newsletters
   automatically.

### B. Capture (every 5 min, automated)
1. `scraper-worker` connects to IMAP catch-all, fetches new messages since
   last UID per inbox.
2. For each email: lookup matching publisher by `to:` address. Unknown → log + skip.
3. Insert `emails_raw` row, persist HTML to disk (gzipped).
4. Render HTML in headless Chromium with images on, wait for network idle so
   LiveIntent's pixel + ad-call resolves.
5. Query DOM for LiveIntent ad slots. Initial selector candidates:
   `a[href*="li/r/"]`, `a[href*="track.liveintent.com"]`,
   `img[src*="liveintent"]`. Refined once real emails are inspected.
6. For each slot: screenshot the rendered `<a>` element, hash the image bytes
   (`creative_hash`), capture the click-tracker URL.
7. Mark `emails_raw.processed_at`.

### C. Resolve + dedupe (synchronous after Capture)
1. For each slot found: compute `creative_hash`. If exists, fetch its
   `creative_id`. Else, follow the click-tracker URL with server-side GET (max
   10 redirects, 10s timeout), capture the final landing URL, parse eTLD+1 as
   `advertiser_domain`. Upsert `advertisers` (insert if new; otherwise update
   `last_seen_at`). Insert `creatives` row with `advertiser_id`.
2. Insert one `impressions` row regardless: `(creative_id, publisher_id,
   email_id, seen_at)`.

### D. Enrichment (async, debounced)
1. After C: if `advertisers.vertical` is null and `vertical_classified_at` is
   null, enqueue a one-shot enrichment job.
2. Enrichment worker fetches the advertiser landing page (10s timeout), strips
   to text, sends to `claude -p` with prompt:
   `"Classify this advertiser into one of: supplements, finance, insurance,
   sweeps, auto, solar, health, crypto, other. Respond with one word."`
   Stores result, sets `vertical_source=auto`, `vertical_classified_at=now()`.
3. Separately, for any unprocessed `creatives.headline`, runs Tesseract on
   the screenshot, stores extracted text. Errors fall back to `null`
   (non-blocking).

### E. Daily digest (cron 9am UTC)
1. Cron in Railway hits `/digest/run`.
2. Query: top 10 advertisers by `COUNT(impressions.id)` over last 24h, grouped
   by `vertical`.
3. Format Telegram message: per-vertical sections, top advertisers with
   impression counts and 1–2 sample creative thumbnails (Telegram supports
   image attachments).
4. Send via Telegram bot API. Insert `digest_runs` row with rendered payload +
   returned message_id.
5. On-demand commands (`/topadvertisers`, `/advertiser <domain>`, `/vertical
   supplements`) hit the same query layer with custom windows.

## Error Handling

| Failure | Behavior |
|---|---|
| IMAP connection drop | Reconnect with exponential backoff. No data loss — UIDs persist. |
| Playwright render timeout (>30s) | Mark `emails_raw.processed_at=now()` with `processing_error`, move on. CLI can rerun later. |
| Click-tracker resolution fails | Store `final_landing_url=null`. Daily retry job for unresolved creatives <7 days old. |
| Claude classification fails | Leave `vertical=unclassified`, retry next day. |
| Telegram API down | Log + skip. No backfill — yesterday's "top 10" is stale by next day. |

## Infra

### Hetzner box (paid, the only paid component)
- CX22 or similar: 2 vCPU / 4GB RAM / 40GB disk, ~$5/mo.
- Two systemd services: `scraper-worker.service` (handles IMAP poll +
  capture + resolve as one process) and `enrichment-worker.service`
  (classification + OCR).
- Postgres 16 installed locally (no managed DB at MVP volume — <100k
  impressions/month).
- Disk holds gzipped raw HTML emails (~5KB each) and PNG screenshots (~30KB
  each). Estimated ~225MB/month at 50 emails/day × 5 ads. Fine on 40GB for
  years.
- Tesseract installed via apt. Playwright Chromium downloaded once.
- Outbound only — only SSH inbound.

### Catch-all email
- Domain: a fresh `.com`, ~$10/yr.
- ImprovMX free tier: forwards `*@<domain>` to a single IMAP-accessible inbox.
  Each publisher gets its own subscribe alias (`r.alvarez@`, `j.chen@`,
  innocuous-looking names — see Risk R2). All land in one inbox; scraper
  routes by `to:` header.

### Railway (premium plan already paid)
- One service: `api` (FastAPI).
- One cron: hits `/digest/run` at 9am UTC.
- **Postgres NOT on Railway** — co-located with scraper on Hetzner to avoid
  network round-trips on every impression insert.
- API connects to Hetzner Postgres via Tailscale **or** Hetzner firewall rule
  whitelisting Railway's static egress IP (premium-tier feature). Pick at
  implementation time.

### Vercel (free)
- One project: `web` (Next.js App Router). Reads from `api` over HTTPS.
  Env: `NEXT_PUBLIC_API_URL`, admin token.

### Telegram bot
- Same pattern as `/spy` in MVMT Printer. New bot token. Webhook to
  `https://<api>.up.railway.app/telegram/webhook`. Single chat ID env var.

### Secrets / env
- `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`
- `DATABASE_URL` (Hetzner Postgres via Tailscale or whitelisted IP)
- `ADMIN_TOKEN` (single shared bearer)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `CLAUDE_OAUTH_REFRESH_TOKEN` (for `claude -p`)

### Total monthly cost
~$5 (Hetzner) + ~$1 (domain amortized) = **~$6/mo**.

## Repo Layout

```
liveintent-spy/
├── packages/
│   ├── scraper/          # Python — Playwright + IMAP + parsers
│   ├── enrichment/       # Python — Claude classify + Tesseract OCR
│   ├── api/              # Python FastAPI
│   └── shared/           # Python — DB models (SQLAlchemy), config
├── apps/
│   └── web/              # Next.js dashboard
├── cli/                  # Click-based admin CLI
├── tests/
│   └── fixtures/         # Real .eml samples for parser tests
├── infra/
│   ├── systemd/          # Service unit files
│   └── deploy.sh         # Hetzner provisioning script
└── docker-compose.yml    # Local dev (Postgres + scraper + api)
```

## Testing

Three layers, scaled to ROI:

1. **Parser unit tests (highest ROI).** Real `.eml` fixtures in
   `tests/fixtures/` for every onboarded publisher. Each fixture has expected
   JSON of `[{slot_index, click_tracker_url, image_hash}]`. LiveIntent DOM
   signatures will drift — these tests are how we catch silent breakage. Run
   on every commit.
2. **Resolver unit tests.** Mock HTTP for click-tracker → final-URL chain.
   Verifies redirect handling (max 10 hops), timeout behavior, eTLD+1 parsing.
3. **End-to-end smoke (nightly, not per-commit).** One fixture email runs
   capture → resolve → enrichment → digest query. Asserts impression row
   exists and digest query returns expected advertiser. Claude and outbound
   HTTP both stubbed.

**Not tested:** dashboard (read-only over a stable API; manual verification
fine for v1), Telegram message formatting (eyeball it), Tesseract OCR quality
(output is in a nullable column, never blocking).

## Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | LiveIntent's DOM may obfuscate slot signatures (random class names, iframes). | Selectors live in a config table (`liveintent_selectors`) for hot-update without redeploy. If full iframe lockdown, fallback is whole-email screenshot + Claude vision detection (~10× more expensive — flag if reached). |
| R2 | Publishers detect catch-all subscriber pattern, unsubscribe us. | Use innocuous human-looking aliases (`r.alvarez@`, `j.chen@`), rotate slowly. Non-issue at 5–10 publishers; becomes an issue at scale. |
| R3 | Click-tracker resolution rate-limited from one IP. | Throttle to 1 req/sec per advertiser domain. If blocked at scale, defer resolution to next-day batch via residential proxies (the $75/mo tier we declined). |
| R4 | Claude vertical classifier drift over time. | Periodic re-classify job for `vertical_source=auto` rows >90 days old. Manual overrides (`vertical_source=manual`) never overwritten. |
| R5 | Hetzner Postgres = single point of failure. | Nightly `pg_dump` to Backblaze B2 (~$1/mo) from day one. Recovery: boot new Hetzner box, restore dump, restart services — ~30 min. Acceptable for v1. |

## Open Questions (Defer to Implementation)

- Exact LiveIntent DOM selectors — only knowable after capturing a few real
  emails.
- Whether `claude -p` OAuth works reliably in a long-running headless service.
  May need API-key fallback for the enrichment worker if OAuth refresh is
  flaky outside an interactive terminal.
- Whether to keep raw HTML emails forever or rotate after 30 days. Disk is
  cheap; default to keep-forever for now.

## Out of Scope for v1

- Spend estimates beyond raw frequency.
- Cross-platform attribution (matching to Meta presence).
- Multi-user auth.
- Public sharing / paid SaaS surface.
- Historical backfill.
