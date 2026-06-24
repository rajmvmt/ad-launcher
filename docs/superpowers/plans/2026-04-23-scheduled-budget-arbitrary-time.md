# Scheduled Budget Changes — Arbitrary Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to schedule one-off Facebook budget changes for any time of day (EST), not just midnight.

**Architecture:** Extend existing `POST /schedule-budget` endpoint with optional `scheduled_for` ISO datetime. Bump Railway cron cadence from daily-midnight to every 10 min so arbitrary times get picked up promptly. Add a datetime-local input to the Reporting.jsx inline budget edit row. Sync identical changes to Black Printer.

**Tech Stack:** FastAPI (Python), SQLAlchemy, pytz, React 19, Vite, Railway cron (`railway.toml`).

**Spec:** `docs/superpowers/specs/2026-04-23-scheduled-budget-arbitrary-time-design.md`

---

### Task 1: Backend — accept optional `scheduled_for` with EST parsing + validation

**Files:**
- Modify: `backend/app/api/v1/facebook.py` (function `schedule_budget_change` at lines 2141-2187)
- Test: `backend/tests/unit/test_schedule_budget_parsing.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_schedule_budget_parsing.py`:

```python
"""Unit tests for scheduled-budget datetime parsing + validation."""
from datetime import datetime, timedelta
import pytest
import pytz

from app.api.v1.facebook import _parse_scheduled_for


EST = pytz.timezone('US/Eastern')


def test_none_returns_next_midnight_est():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))  # 9pm EST
    result = _parse_scheduled_for(None, now_est=now)
    assert result.tzinfo is not None
    assert result.astimezone(EST) == EST.localize(datetime(2026, 4, 24, 0, 0))


def test_naive_iso_treated_as_est():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    result = _parse_scheduled_for('2026-04-23T23:59:00', now_est=now)
    assert result.astimezone(EST) == EST.localize(datetime(2026, 4, 23, 23, 59))


def test_aware_iso_preserved():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    result = _parse_scheduled_for('2026-04-24T04:00:00+00:00', now_est=now)
    # 04:00 UTC = 00:00 EST (during EDT it's 00:00 EDT, but pytz handles offset)
    assert result.astimezone(pytz.UTC) == pytz.UTC.localize(datetime(2026, 4, 24, 4, 0))


def test_past_time_raises():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    with pytest.raises(ValueError, match="must be in the future"):
        _parse_scheduled_for('2026-04-23T20:00:00', now_est=now)


def test_too_soon_raises():
    """Must be > 60s in future to avoid race with cron."""
    now = EST.localize(datetime(2026, 4, 23, 21, 0, 0))
    target = (now + timedelta(seconds=30)).strftime('%Y-%m-%dT%H:%M:%S')
    with pytest.raises(ValueError, match="at least 60 seconds"):
        _parse_scheduled_for(target, now_est=now)


def test_malformed_raises():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    with pytest.raises(ValueError, match="Invalid"):
        _parse_scheduled_for('not a date', now_est=now)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_schedule_budget_parsing.py -v`
Expected: FAIL with `ImportError: cannot import name '_parse_scheduled_for'`

- [ ] **Step 3: Implement the helper and wire it into the endpoint**

In `backend/app/api/v1/facebook.py`, add the helper above the `schedule_budget_change` function (around line 2140):

```python
def _parse_scheduled_for(value: Optional[str], now_est: Optional[datetime] = None) -> datetime:
    """Parse optional ISO datetime as EST-localized timezone-aware datetime.

    - None → next midnight EST
    - Naive ISO string → assume EST
    - Aware ISO string → preserve tz
    Raises ValueError if past, within 60s, or malformed.
    """
    est = pytz.timezone('US/Eastern')
    if now_est is None:
        now_est = datetime.now(est)

    if value is None:
        base = datetime(now_est.year, now_est.month, now_est.day) + timedelta(days=1)
        return est.localize(base)

    try:
        parsed = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid scheduled_for: {value!r}")

    if parsed.tzinfo is None:
        parsed = est.localize(parsed)

    delta = parsed - now_est
    if delta.total_seconds() <= 0:
        raise ValueError("scheduled_for must be in the future")
    if delta.total_seconds() < 60:
        raise ValueError("scheduled_for must be at least 60 seconds in the future")
    return parsed
```

Then replace the midnight-hardcoded block in `schedule_budget_change` (currently lines 2159-2162):

```python
    # OLD:
    #   est = pytz.timezone('US/Eastern')
    #   now_est = datetime.now(est)
    #   next_midnight = est.localize(datetime(now_est.year, now_est.month, now_est.day) + timedelta(days=1))

    # NEW:
    try:
        scheduled_for_dt = _parse_scheduled_for(data.get('scheduled_for'))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

Rename the variable used on line 2174 (`scheduled_for=next_midnight`) to `scheduled_for=scheduled_for_dt` and the return value on line 2185 (`"scheduled_for": next_midnight.isoformat()`) to `"scheduled_for": scheduled_for_dt.isoformat()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_schedule_budget_parsing.py -v`
Expected: all 6 tests PASS.

- [ ] **Step 5: Smoke the existing endpoint shape hasn't regressed**

Run: `cd backend && python -c "from app.api.v1.facebook import schedule_budget_change, _parse_scheduled_for; print('ok')"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/facebook.py backend/tests/unit/test_schedule_budget_parsing.py
git commit -m "feat(budget): accept optional scheduled_for with EST parsing + validation"
```

---

### Task 2: Backend — cron cadence every 10 min

**Files:**
- Modify: `railway.toml:59`

- [ ] **Step 1: Edit railway.toml**

Change line 59 from:
```toml
cronSchedule = "0 5 * * *"
```
to:
```toml
cronSchedule = "*/10 * * * *"
```

Also update the comment on line 48 from `# Cron: Scheduled Budget Changes (midnight EST = 5 UTC)` to `# Cron: Scheduled Budget Changes (every 10 min — applies any that are due)`.

- [ ] **Step 2: Verify toml parses**

Run: `cd /home/roly/iscale-facebook-ad-builder && python -c "import tomllib; tomllib.load(open('railway.toml','rb')); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add railway.toml
git commit -m "feat(budget): cron every 10 min so arbitrary scheduled times apply promptly"
```

---

### Task 3: Frontend — datetime input + updated pill/toast

**Files:**
- Modify: `frontend/src/lib/facebookApi.js` (function `scheduleBudgetChange` around line 1155)
- Modify: `frontend/src/pages/Reporting.jsx` (inline budget edit row around 2418 + handler around 815 + pending pill around 2447)

- [ ] **Step 1: Extend `scheduleBudgetChange` API wrapper**

In `frontend/src/lib/facebookApi.js`, update `scheduleBudgetChange` to accept a 6th arg:

```javascript
export async function scheduleBudgetChange(objectId, objectType, newBudgetDollars, adAccountId, connectionId, scheduledForISO) {
    let url = `${API_BASE_URL}/schedule-budget`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const body = {
        object_id: objectId,
        object_type: objectType,
        new_budget_cents: Math.round(newBudgetDollars * 100),
        ad_account_id: adAccountId,
        connection_id: connectionId,
    };
    if (scheduledForISO) body.scheduled_for = scheduledForISO;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to schedule budget change');
    }
    return response.json();
}
```

- [ ] **Step 2: Add datetime state + input in Reporting.jsx**

Near `editBudgetValue` state declaration (search for `setEditBudgetValue`), add a sibling state:

```javascript
const [editBudgetScheduledAt, setEditBudgetScheduledAt] = useState(''); // local "YYYY-MM-DDTHH:MM" interpreted as EST
```

Find the inline budget edit `<input>` (around line 2418, the one with `onKeyDown={e => { if (e.key === 'Enter') handleScheduleBudget(...) }}`) and add a datetime-local input immediately after it within the same flex container:

```jsx
<input
    type="datetime-local"
    value={editBudgetScheduledAt}
    onChange={e => setEditBudgetScheduledAt(e.target.value)}
    className="text-xs px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
    title="Scheduled time (EST)"
/>
<span className="text-[10px] text-gray-500">EST</span>
```

Also add a default value when entering edit mode. Find where `setEditingBudgetId(item.id)` is called with `setEditBudgetValue('...')` and add:

```javascript
// Default: tonight 23:59 EST (user can override)
const nowEst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
const tonight = `${nowEst.getFullYear()}-${String(nowEst.getMonth()+1).padStart(2,'0')}-${String(nowEst.getDate()).padStart(2,'0')}T23:59`;
setEditBudgetScheduledAt(tonight);
```

- [ ] **Step 3: Pass datetime into `handleScheduleBudget`**

Replace the function at ~line 815:

```javascript
const handleScheduleBudget = async (itemId, objectType) => {
    const dollars = parseFloat(editBudgetValue);
    if (!dollars || dollars <= 0) { showError('Enter a valid budget amount'); return; }
    if (!editBudgetScheduledAt) { showError('Pick a scheduled time'); return; }
    // datetime-local gives "YYYY-MM-DDTHH:MM" with no tz — backend treats naive as EST
    const scheduledForISO = editBudgetScheduledAt + ':00';
    setSchedulingBudget(true);
    try {
        const result = await scheduleBudgetChange(itemId, objectType, dollars, selectedAccount?.id, selectedConnection?.id, scheduledForISO);
        const whenLabel = new Date(result.scheduled_for).toLocaleString('en-US', {
            timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        showSuccess(`$${dollars.toFixed(2)}/day scheduled for ${whenLabel} EST`);
        setEditingBudgetId(null);
        setEditBudgetValue('');
        setEditBudgetScheduledAt('');
        getScheduledBudgets(selectedAccount?.id, selectedConnection?.id).then(setScheduledBudgets).catch(() => {});
    } catch (e) {
        showError('Failed to schedule budget: ' + e.message);
    } finally {
        setSchedulingBudget(false);
    }
};
```

- [ ] **Step 4: Update pending-change pill to show actual time**

Find the pill at ~line 2447-2449. Replace the hardcoded title + arrow label with:

```jsx
<span
    className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
    title={`Scheduled: $${(scheduled.new_daily_budget / 100).toFixed(2)}/day at ${new Date(scheduled.scheduled_for).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} EST`}
>
    → ${(scheduled.new_daily_budget / 100).toFixed(2)} @ {new Date(scheduled.scheduled_for).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
    <button onClick={(e) => { e.stopPropagation(); handleCancelScheduledBudget(scheduled.id); }} className="p-0.5 text-gray-400 hover:text-red-500" title="Cancel scheduled change">
```

(Keep the existing `<button>` and closing tags untouched — only the outer `<span>` attrs and inner display text change.)

- [ ] **Step 5: Verify build passes**

Run: `cd frontend && npm run build 2>&1 | tail -20`
Expected: build succeeds, no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/facebookApi.js frontend/src/pages/Reporting.jsx
git commit -m "feat(budget): datetime picker for arbitrary scheduled budget time"
```

---

### Task 4: Push MVMT changes and deploy

**Files:** none (deploy action)

- [ ] **Step 1: Push and merge per CLAUDE.md workflow**

```bash
git push origin main
```

Railway auto-deploys backend, frontend, and cron service (the cron service picks up the new `cronSchedule` on next deploy).

- [ ] **Step 2: Verify deploy + cron cadence**

Wait for Railway deploy (check with `railway logs --service cron-scheduled-budgets --tail 10` if CLI available, else Railway dashboard). Confirm new cron schedule shows as `*/10 * * * *`.

---

### Task 5: Sync to Black Printer

**Files (in `/home/roly/black-printer`):**
- Modify: `backend/app/api/v1/facebook.py` — mirror Task 1 changes
- Create: `backend/tests/unit/test_schedule_budget_parsing.py` — mirror Task 1 test
- Modify: `railway.toml` — mirror Task 2
- Modify: `frontend/src/lib/facebookApi.js` — mirror Task 3 Step 1
- Modify: `frontend/src/pages/Reporting.jsx` — mirror Task 3 Steps 2-4

- [ ] **Step 1: Diff Black Printer state vs MVMT to confirm parity of touch points**

Run:
```bash
for f in backend/app/api/v1/facebook.py frontend/src/lib/facebookApi.js frontend/src/pages/Reporting.jsx railway.toml; do
  echo "=== $f ==="
  diff /home/roly/iscale-facebook-ad-builder/$f /home/roly/black-printer/$f | head -40
done
```
Note divergences — if Black Printer already lacks `schedule_budget_change` entirely, fall back to copying the function block whole.

- [ ] **Step 2: Apply the same diffs**

For each file, apply the same edits as Tasks 1-3 above. Source-of-truth is `/home/roly/iscale-facebook-ad-builder/` after Task 1-3 commits; copy the exact new code blocks from there into Black Printer.

- [ ] **Step 3: Run backend unit test in Black Printer**

Run: `cd /home/roly/black-printer/backend && pytest tests/unit/test_schedule_budget_parsing.py -v`
Expected: 6 tests PASS.

- [ ] **Step 4: Build frontend in Black Printer**

Run: `cd /home/roly/black-printer/frontend && npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 5: Commit + push**

```bash
cd /home/roly/black-printer
git add backend/app/api/v1/facebook.py backend/tests/unit/test_schedule_budget_parsing.py railway.toml frontend/src/lib/facebookApi.js frontend/src/pages/Reporting.jsx
git commit -m "feat(budget): arbitrary-time scheduled budget changes (sync from MVMT)"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (endpoint `scheduled_for`) → Task 1 ✅
- Spec §2 (cron cadence) → Task 2 ✅
- Spec §3 (frontend datetime input + pill + toast) → Task 3 ✅
- Spec §4 (Black Printer sync) → Task 5 ✅
- Spec rollout step 4 (smoke test via $0.01 budget for +5 min) → implicit UAT after Task 4; owner runs live.

**Placeholder scan:** no TBDs. All code shown literally. Exact file paths + line ranges given.

**Type consistency:** `_parse_scheduled_for` signature (`value: Optional[str], now_est: Optional[datetime]`) used consistently in test + caller. Request field name `scheduled_for` matches between API doc, test, frontend `body.scheduled_for`, and response `result.scheduled_for`. State var `editBudgetScheduledAt` used consistently in all 3 frontend steps.
