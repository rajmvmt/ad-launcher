# Scheduled Budget Changes — Arbitrary Time (EST)

**Date:** 2026-04-23
**Status:** Approved (pending user spec review)

## Problem

Current `POST /api/v1/schedule-budget` hardcodes the scheduled time to "next midnight EST". Users want to schedule a one-off budget change for any specific time of day (e.g., 11:59 PM tonight, 3 AM tomorrow), interpreted in EST.

## Scope

Unlock arbitrary-time scheduling with minimum change. Keep the existing one-pending-change-per-object semantics. No auto-revert, no recurring schedules, no presets.

## Changes

### 1. Backend — `POST /api/v1/schedule-budget`

File: `backend/app/api/v1/facebook.py`

Accept a new optional field in the request body:

- `scheduled_for`: ISO 8601 datetime string (e.g., `"2026-04-24T00:00:00"`). Interpreted as EST (America/New_York) if no timezone is provided. If omitted, default to next midnight EST (preserves current behavior).

Validation:
- Must parse as datetime.
- Must be in the future (> now by at least 60 seconds to avoid race with cron).

Response shape unchanged (`scheduled_for` is already returned).

### 2. Cron cadence

File: Railway cron config for `run_scheduled_budgets.py`

Change schedule from `0 5 * * *` (once daily at 05:00 UTC = midnight EST) to `*/10 * * * *` (every 10 min). Script query (`scheduled_for <= now`) already supports this — no script change needed.

Latency: scheduled change applies within 10 min of target time. Acceptable for "go live at midnight" use case.

### 3. Frontend — Reporting.jsx

File: `frontend/src/pages/Reporting.jsx`, `frontend/src/lib/facebookApi.js`

- Add a small `<input type="datetime-local">` next to the budget edit input. Default value: tonight at 23:59 (local). Label: "at (EST)".
- `scheduleBudgetChange(...)` gains an optional `scheduledForISO` arg; appended to request body.
- When submitting, treat the datetime-local value as EST wall-clock: send as ISO without timezone suffix (e.g., `"2026-04-24T23:59:00"`). Backend interprets as EST.
- Pending-change pill updates from hardcoded "at midnight EST" to `→ $X.XX at {formatted scheduled_for in EST}`.
- Toast success message: `"$X.XX/day scheduled for {time} EST"`.

### 4. Black Printer sync

After MVMT changes merge, port identical changes to `/home/roly/black-printer/` (model, endpoint, cron config, UI). Black Printer has the same file structure.

## Out of Scope

- Auto-revert after N hours (user confirmed: one-off)
- Multiple pending changes per object (existing cancel-prior behavior kept)
- Preset buttons (tonight / +1 hr / etc.)
- Per-user timezone preference (EST hardcoded)

## Migration

No DB migration needed — `ScheduledBudgetChange.scheduled_for` already stores a full datetime.

## Rollout

1. Merge + deploy backend → frontend on Railway (auto-deploy from main).
2. Update Railway cron schedule manually (or via API) for both backend cron services.
3. Sync to Black Printer.
4. Smoke test: schedule a $0.01 budget change for +5 min; verify cron applies it.
