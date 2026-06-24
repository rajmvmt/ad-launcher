# `/spy` Skill — Daily Meta Ad Intelligence

**Date:** 2026-04-16 (rewritten after codebase exploration)
**Owner:** Roly
**Status:** Design approved, ready for implementation plan

## Goal

A `/spy` skill that performs daily automated spying on Meta (Facebook/Instagram) ads from a watchlist of competitor Pages and a list of keyword searches, scores the results, produces a daily swipe file report, and posts a Telegram digest. Fits alongside existing `/redtrack`, `/rip`, `/domain`, `/uptime` skills.

## Key Insight — Most of the Infra Already Exists

Codebase exploration found the project already has ~80% of the required infrastructure. `/spy` is a thin layer on top, not a from-scratch build.

### Already built (reuse as-is)

| Concept | Existing table / service |
|---|---|
| Watchlist of competitor FB Pages | `Competitor` (fb_page_id, fb_ads_library_url, group_name, tags, notes) |
| Keyword searches w/ daily schedule | `SavedSearch` (query, country, `search_type='scheduled_daily'`, `is_active`, `last_run`, schedule_config) |
| Scraped ads with dedup | `ScrapedAd` (external_id, content_hash, first_seen, last_seen, seen_count, facebook_page_id FK) |
| Normalized page metadata | `FacebookPage` (page_name, page_url, total_ads, first_seen, last_seen) |
| Swipe file | `SwipeFile` (ad_library_id dedup, days_running, ai_analysis, deep_analysis, collection, is_starred, source_type) |
| Meta Ad Library client | `app/services/ad_library_scraper.py` (Graph API + Playwright fallback + R2 upload) |
| Research runner | `app/services/research_service.py` (`search_and_save`) |
| Scheduler | `app/services/scheduler_service.py` (`get_due_searches`, `execute_scheduled_search`) — runs `SavedSearch` only |
| Hourly cron | `backend/run_scheduled_searches.py` (Railway cron) |
| Per-search logging | `SearchLog` |
| Swipe auto-categorization | `app/services/swipe_analyzer.py` (`auto_categorize_swipe`) |
| API routes (existing) | `/api/v1/competitors`, `/api/v1/swipe_file`, `/api/v1/ad_library`, `/api/v1/research` |
| Asset storage | Cloudflare R2 (already wired via `ad_library_scraper.py`) |
| Telegram client | `app/services/telegram_bot.py` + `/api/v1/telegram_bot` |

### What's actually missing (what `/spy` adds)

1. **Competitor daily-scrape runner** — `SchedulerService` today only runs `SavedSearch`; it does NOT auto-scrape `Competitor` Pages. Need a companion method that iterates active `Competitor` rows and pulls their active ads via `AdLibraryScraper.search_by_page_id()`.
2. **Scoring** — longevity + variant count + novelty → score → top-N.
3. **`SpyReport` model** — daily snapshot: report_date, counts, top_scraped_ad_ids, markdown summary, telegram_message_id.
4. **Report renderer** — markdown output listing top N with "why" tags (`Running 23d`, `4 variants`, `New from @X`).
5. **Telegram digest sender** — top 5 inline + link to full report.
6. **Unified daily cron** — `backend/run_daily_spy.py` that: (a) scrapes all active `Competitor` Pages, (b) runs due `SavedSearch` items for today (reuses `SchedulerService`), (c) scores, (d) creates `SpyReport`, (e) posts Telegram digest.
7. **`/api/v1/spy/*` routes** — thin facade:
   - `POST /api/v1/spy/run` — manual trigger of the unified daily job
   - `GET /api/v1/spy/reports` — list reports
   - `GET /api/v1/spy/reports/{date}` — single report
   - `GET /api/v1/spy/top?n=20&date=latest` — top-N from latest report
   - Watchlist/keyword CRUD delegates to existing `/competitors` + `/research` endpoints (skill calls those directly; no new routes needed)
8. **Optional swipe auto-promotion** — if an ad's score exceeds `SPY_AUTO_PROMOTE_SCORE` (default 80), create a corresponding `SwipeFile` row linked to the `ScrapedAd` so it lands in the existing swipe UI. Feature-flagged (`SPY_AUTO_PROMOTE_TO_SWIPE=false` by default).
9. **Skill surface** — `~/.claude/skills/spy/SKILL.md` with command parsing matching `/redtrack` pattern.

## Scope

- Advertiser-centric watchlist (`Competitor`)
- Keyword tracker (`SavedSearch` with `search_type='scheduled_daily'`)
- Unified daily run → scored top-20 → Telegram digest
- `/spy` slash command surface

## Architecture

```
~/.claude/skills/spy/SKILL.md          → Parses intent, calls backend HTTP API
                                       ↓
backend/app/api/v1/spy.py              → /api/v1/spy/run, /reports, /reports/{date}, /top
                                       ↓
backend/app/services/spy/              → New module
  ├── competitor_runner.py             → Scrape all active Competitor.fb_page_id
  ├── scoring.py                       → Score ScrapedAd rows (longevity/variants/novelty)
  ├── report_builder.py                → Renders markdown, persists SpyReport
  └── telegram_digest.py               → Formats + sends top-5 digest
                                       ↓
backend/run_daily_spy.py               → Cron entrypoint; wires the above
                                       ↓
Existing: AdLibraryScraper, SchedulerService, ResearchService, SwipeAnalyzer,
          TelegramBot, models (Competitor, SavedSearch, ScrapedAd, FacebookPage,
          SwipeFile, SearchLog), R2 storage
```

New Railway cron service runs `python run_daily_spy.py` daily at 06:00 America/Chicago.

Watchlist/keyword management in the skill goes straight to existing endpoints:
- `/spy watch` → `POST /api/v1/competitors`
- `/spy keyword` → `POST /api/v1/research/save-search` (creates `SavedSearch` with `search_type='scheduled_daily'`)
- `/spy list` → `GET /api/v1/competitors` + `GET /api/v1/research/searches`
- `/spy remove` → `DELETE /api/v1/competitors/{id}` or `/api/v1/research/searches/{id}`

## New Database Schema

One new table only.

### `spy_reports`
- `id` serial PK
- `report_date` date unique not null
- `total_ads_scanned` int not null default 0
- `new_ads_count` int not null default 0
- `competitors_scanned` int not null default 0
- `keywords_scanned` int not null default 0
- `top_scraped_ad_ids` text[] not null default `{}` — list of `scraped_ads.id` values, score-ordered
- `score_details` jsonb not null default `{}` — `{scraped_ad_id: {score, days_active, variant_count, novelty_bonus, reasons}}`
- `summary_markdown` text not null default `''`
- `telegram_chat_id` text nullable
- `telegram_message_id` text nullable
- `created_at` timestamptz default now()

Index on `report_date`.

## Scoring

Computed at report time over `ScrapedAd` rows where `last_seen >= today - interval '2 days'` (treated as "still observed"):

```
score = (days_active * 3) + (variant_count * 5) + novelty_bonus

where:
  days_active      = min(30, date_diff(last_seen, first_seen) in days)
  variant_count    = count of ScrapedAd rows from same facebook_page_id with
                     content_hash trigram similarity ≥0.6 on ad_copy
                     (Postgres `pg_trgm` extension, `similarity()` function)
  novelty_bonus    = 20 if first_seen::date = today AND (matches any Competitor)
                     10 if first_seen::date = today AND (matches any SavedSearch)
                     0 otherwise
```

Constants live in `services/spy/scoring.py`:
```python
WEIGHT_DAYS_ACTIVE = 3
WEIGHT_VARIANT_COUNT = 5
NOVELTY_BONUS_COMPETITOR = 20
NOVELTY_BONUS_KEYWORD = 10
DAYS_ACTIVE_CAP = 30
SIMILARITY_THRESHOLD = 0.6
TOP_N = 20
AUTO_PROMOTE_SCORE = 80   # used only if SPY_AUTO_PROMOTE_TO_SWIPE=true
```

Top 20 by score enter the daily report. Each gets a human-readable `reasons` array (e.g., `["Running 23d", "4 variants", "New from @CompetitorCo"]`).

**Note on variant detection:** The existing `content_hash` is for exact dedup. For soft-variant detection we need trigram similarity, which requires the `pg_trgm` Postgres extension. Plan enables it via migration.

## Daily Pipeline

`backend/run_daily_spy.py`:

1. Load env (`DATABASE_URL`, `META_ADS_LIBRARY_TOKEN`, `TELEGRAM_BOT_TOKEN`, `SPY_TELEGRAM_CHAT_ID`, `SPY_AUTO_PROMOTE_TO_SWIPE`).
2. If `META_ADS_LIBRARY_TOKEN` missing/empty → log, send one Telegram notice, write `SpyReport` row with `summary_markdown="Token missing"`, exit 0.
3. **Competitor runner:** for each active `Competitor`, call `AdLibraryScraper.search_by_page_id(page_id, limit=100)`, upsert `ScrapedAd` (dedup on `external_id`/`content_hash`), increment `seen_count`, update `last_seen`.
4. **Keyword runner:** call `SchedulerService.run_scheduled_searches()` (reuses existing code; it handles `SavedSearch` rows with `search_type='scheduled_daily'` whose `last_run` is >24h old).
5. **Scoring:** query active ads (`last_seen >= today - 2 days`), compute score, rank, take top 20.
6. **Build report:** render markdown, insert `SpyReport` row with counts + top ids + score_details + summary.
7. **Telegram digest:** send top 5 inline (image + 2-line summary + link), append "+ 15 more in full report" link.
8. **Auto-promotion (optional):** if `SPY_AUTO_PROMOTE_TO_SWIPE=true`, for each scored ad above `AUTO_PROMOTE_SCORE` with no existing `SwipeFile` row matching `ad_library_id`, create one using `SwipeFile(source_type="ad_library", ad_library_id=..., ...)` and enqueue `auto_categorize_swipe` via `BackgroundTasks`.
9. Return exit 0 even on partial failures (scraping one competitor failing shouldn't kill the whole run); log per-step failures to `backend.log`.

**Rate limiting:** existing `AdLibraryScraper` already handles the Graph API. We add 1s between competitor calls defensively.

**Retries:** Meta API 5xx → 3x exponential backoff already in `AdLibraryScraper`. Overall cron retries: Railway handles.

## Report Format

Stored in `SpyReport.summary_markdown`:

```markdown
# Spy Report — 2026-04-16
Scanned 1,247 ads across 12 competitors + 8 keywords. 43 new today.

## Top 20 Swipe-worthy

### 1. @CompetitorCo — "The one supplement doctors..."
- Running 23 days · 4 active variants · New today
- ![creative](https://pub-xxx.r2.dev/ads/abc123.jpg)
- [View in Ad Library](https://facebook.com/ads/library/?id=...)
- **Copy:** <first 200 chars of ad_copy>
- **CTA:** Shop Now → landing.example.com

### 2. ...
```

Also returned verbatim by `GET /api/v1/spy/reports/{date}` so the skill prints it in terminal.

## Telegram Digest Format

Uses existing `telegram_bot.py` sender. One message:

```
🕵️ Spy Report — 2026-04-16
1,247 scanned · 43 new · 12 competitors · 8 keywords

Top 5:
1. @CompetitorCo — Running 23d, 4 variants — https://...
2. @AnotherCo — Running 8d, New! — https://...
...
+ 15 more: <BACKEND_URL>/api/v1/spy/reports/2026-04-16
```

Top 5 thumbnails sent as media group if they have R2 URLs.

## Skill Command Surface

`~/.claude/skills/spy/SKILL.md`:

| Command | Effect |
|---|---|
| `/spy watch <fb-ads-library-url \| page-id> [--group "..."] [--note "..."]` | `POST /api/v1/competitors` |
| `/spy keyword "<phrase>" [--country US]` | `POST /api/v1/research/save-search` with `search_type='scheduled_daily'` |
| `/spy list` | Fetch `/competitors` + `/research/searches?active=true`, format table |
| `/spy remove <id>` | Try `DELETE /api/v1/competitors/{id}`; on 404 fallback to `DELETE /api/v1/research/searches/{id}` |
| `/spy run` | `POST /api/v1/spy/run` (manual trigger); stream logs |
| `/spy report [YYYY-MM-DD]` | `GET /api/v1/spy/reports/{date}` (default = latest); prints markdown |
| `/spy top [N]` | `GET /api/v1/spy/top?n=N` from latest report |

Follows the exact pattern of `~/.claude/skills/redtrack/SKILL.md`.

## Environment Variables

Add to Railway (backend + new cron service):
- `META_ADS_LIBRARY_TOKEN` — Meta access token. Placeholder at install; fill in later. **This already lives somewhere for `AdLibraryScraper` — reuse existing env var name if one exists.**
- `SPY_TELEGRAM_CHAT_ID` — reuse the chat id from `/uptime` setup
- `SPY_AUTO_PROMOTE_TO_SWIPE` — `true`/`false`, default `false`
- `SPY_DAILY_RUN_HOUR` — default `6` (hour-of-day in `America/Chicago`)
- `SPY_REPORT_CRON_TZ` — default `America/Chicago`

Plan verifies the existing Meta token env var name by reading `ad_library_scraper.py` usage before adding anything new.

## Out of Scope for v1

- React frontend UI for spy reports (existing `SwipeFile` UI serves day-to-day; add a `/spy` page in v2)
- Apify fallback (revisit if Graph API + Playwright combo proves too flaky)
- AdPlexity CSV import path
- Video frame extraction / OCR on creatives
- Cross-account creative similarity (same creative from different Pages)
- Trend analysis over time

## Testing Strategy

- **Unit:** `scoring.py` (pure function, deterministic fixtures), `report_builder.py` (markdown rendering snapshot)
- **Integration:** `competitor_runner.py` with `AdLibraryScraper` mocked; verify `ScrapedAd` upsert + `seen_count` increment
- **End-to-end (manual):** `POST /api/v1/spy/run` with a seeded `Competitor` + `SavedSearch`, verify `SpyReport` row inserted, verify Telegram message (if token set)
- **Cron:** Railway cron logs show successful run + row count

## Implementation Plan Sketch

Phase 1 — scoring + report core (no new infra):
1. DB migration: `spy_reports` table + enable `pg_trgm` extension
2. `services/spy/scoring.py` + unit tests
3. `services/spy/report_builder.py` + unit tests

Phase 2 — runners:
4. `services/spy/competitor_runner.py` + integration test
5. Extend `SchedulerService` or leave as-is (decide in plan)

Phase 3 — wiring:
6. `services/spy/telegram_digest.py`
7. `backend/run_daily_spy.py` — unified cron entrypoint
8. `backend/app/api/v1/spy.py` routes + register in `main.py`

Phase 4 — skill + deploy:
9. `~/.claude/skills/spy/SKILL.md`
10. Railway cron service config (`Dockerfile.cron` already exists — add daily schedule)
11. Env vars in Railway
12. Smoke test end-to-end; update `CLAUDE.md` + memory
