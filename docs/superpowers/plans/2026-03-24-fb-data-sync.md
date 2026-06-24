# Facebook Data Sync — Optimizer-Level Reporting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate live Facebook API calls from the Reporting page by syncing FB data to PostgreSQL on a schedule, serving reads from local DB, and only hitting FB API for writes (toggle, budget change, safe ad, etc.).

**Architecture:** A sync cron pulls campaign/adset/ad data + insights into local DB tables every 15 min. New `/reporting/*` endpoints serve data from DB. The existing `/insights/*` endpoints remain for writes/actions. Frontend switches reads to new endpoints and shows "last synced" indicator. Rate-limit retry + backend TTL cache provide additional resilience.

**Tech Stack:** PostgreSQL (existing), SQLAlchemy models, Railway cron service, existing FastAPI backend

---

## File Structure

**New files:**
- `backend/app/models.py` — add `FBSyncCampaign`, `FBSyncAdSet`, `FBSyncAd`, `FBSyncStatus` models
- `backend/app/api/v1/reporting_sync.py` — new router: DB-backed reporting endpoints + manual sync trigger
- `backend/run_fb_sync.py` — cron script that syncs FB data to DB
- `backend/app/services/fb_rate_limit.py` — rate-limit aware retry wrapper

**Modified files:**
- `backend/app/main.py` — register new `reporting_sync` router
- `backend/app/services/facebook_service.py` — add rate-limit retry decorator to all FB API calls
- `frontend/src/pages/Reporting.jsx` — switch reads to new endpoints, add sync indicator
- `frontend/src/lib/facebookApi.js` — add new reporting API functions

---

### Task 1: Rate-Limit Retry Wrapper

**Files:**
- Create: `backend/app/services/fb_rate_limit.py`
- Modify: `backend/app/services/facebook_service.py`

This is the quick win — wrap all FB API calls with automatic retry on 429 errors.

- [ ] **Step 1: Create rate-limit retry decorator**

Create `backend/app/services/fb_rate_limit.py`:

```python
"""Rate-limit aware retry for Facebook API calls."""
import time
import logging
from functools import wraps
from facebook_business.exceptions import FacebookRequestError

logger = logging.getLogger(__name__)

def fb_retry(max_retries=3, base_delay=60):
    """Decorator that retries on Facebook rate limit (error code 17/32)."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except FacebookRequestError as e:
                    error_code = e.api_error_code()
                    if error_code in (17, 32, 4) and attempt < max_retries:
                        # 17 = User request limit, 32 = App request limit, 4 = Too many calls
                        wait = base_delay * (2 ** attempt)
                        logger.warning(f"FB rate limit hit (code {error_code}), waiting {wait}s (attempt {attempt + 1}/{max_retries})")
                        time.sleep(wait)
                    else:
                        raise
            return func(*args, **kwargs)
        return wrapper
    return decorator
```

- [ ] **Step 2: Apply retry decorator to key facebook_service.py methods**

Add `from app.services.fb_rate_limit import fb_retry` to imports.

Apply `@fb_retry()` to these methods in `FacebookService`:
- `get_campaigns_with_insights`
- `get_adsets_with_insights`
- `get_ads_with_insights`
- `get_all_ads_with_insights`
- `get_all_adsets_with_insights`
- `get_account_insights`
- `get_disapproved_ads`

- [ ] **Step 3: Test by running backend**

```bash
cd backend && source venv/bin/activate
python -c "from app.services.fb_rate_limit import fb_retry; print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/fb_rate_limit.py backend/app/services/facebook_service.py
git commit -m "Add rate-limit retry wrapper for Facebook API calls"
```

---

### Task 2: Sync Database Models

**Files:**
- Modify: `backend/app/models.py`

Add 4 new models to store synced Facebook data.

- [ ] **Step 1: Add sync models to models.py**

Add these models after the existing `FacebookAd` class:

```python
class FBSyncStatus(Base):
    """Track last sync time per ad account."""
    __tablename__ = "fb_sync_status"

    id = Column(String, primary_key=True, default=generate_uuid)
    ad_account_id = Column(String, nullable=False, unique=True, index=True)
    connection_id = Column(String, ForeignKey("facebook_connections.id", ondelete="CASCADE"), nullable=False)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_duration_ms = Column(Integer, nullable=True)
    last_sync_error = Column(Text, nullable=True)
    campaigns_count = Column(Integer, default=0)
    adsets_count = Column(Integer, default=0)
    ads_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FBSyncCampaign(Base):
    """Locally cached Facebook campaign data + insights."""
    __tablename__ = "fb_sync_campaigns"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_campaign_id = Column(String, nullable=False, index=True)
    ad_account_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String)
    effective_status = Column(String)
    objective = Column(String)
    daily_budget = Column(String, nullable=True)
    lifetime_budget = Column(String, nullable=True)
    bid_strategy = Column(String, nullable=True)
    buying_type = Column(String, nullable=True)
    special_ad_categories = Column(JSON, nullable=True)
    start_time = Column(String, nullable=True)
    stop_time = Column(String, nullable=True)
    # Insights (for the synced date range)
    insights_since = Column(String, nullable=True)
    insights_until = Column(String, nullable=True)
    impressions = Column(String, default='0')
    clicks = Column(String, default='0')
    spend = Column(String, default='0.00')
    ctr = Column(String, default='0')
    cpc = Column(String, default='0')
    cpm = Column(String, default='0')
    reach = Column(String, default='0')
    results = Column(Integer, default=0)
    purchase_revenue = Column(Float, default=0.0)
    actions = Column(JSON, nullable=True)
    cost_per_action_type = Column(JSON, nullable=True)
    action_values = Column(JSON, nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('fb_campaign_id', 'ad_account_id', name='uq_sync_campaign'),
    )


class FBSyncAdSet(Base):
    """Locally cached Facebook ad set data + insights."""
    __tablename__ = "fb_sync_adsets"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_adset_id = Column(String, nullable=False, index=True)
    fb_campaign_id = Column(String, nullable=False, index=True)
    ad_account_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String)
    effective_status = Column(String)
    daily_budget = Column(String, nullable=True)
    lifetime_budget = Column(String, nullable=True)
    targeting = Column(JSON, nullable=True)
    optimization_goal = Column(String, nullable=True)
    bid_amount = Column(String, nullable=True)
    bid_strategy = Column(String, nullable=True)
    billing_event = Column(String, nullable=True)
    start_time = Column(String, nullable=True)
    end_time = Column(String, nullable=True)
    # Insights
    insights_since = Column(String, nullable=True)
    insights_until = Column(String, nullable=True)
    impressions = Column(String, default='0')
    clicks = Column(String, default='0')
    spend = Column(String, default='0.00')
    ctr = Column(String, default='0')
    cpc = Column(String, default='0')
    cpm = Column(String, default='0')
    reach = Column(String, default='0')
    results = Column(Integer, default=0)
    purchase_revenue = Column(Float, default=0.0)
    actions = Column(JSON, nullable=True)
    cost_per_action_type = Column(JSON, nullable=True)
    action_values = Column(JSON, nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('fb_adset_id', 'ad_account_id', name='uq_sync_adset'),
    )


class FBSyncAd(Base):
    """Locally cached Facebook ad data + insights + creative."""
    __tablename__ = "fb_sync_ads"

    id = Column(String, primary_key=True, default=generate_uuid)
    fb_ad_id = Column(String, nullable=False, index=True)
    fb_adset_id = Column(String, nullable=False, index=True)
    fb_campaign_id = Column(String, nullable=False, index=True)
    ad_account_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String)
    effective_status = Column(String)
    # Creative data (cached so we never re-fetch)
    creative_id = Column(String, nullable=True)
    creative_data = Column(JSON, nullable=True)  # thumbnail_url, image_url, page_id, etc.
    # Insights
    insights_since = Column(String, nullable=True)
    insights_until = Column(String, nullable=True)
    impressions = Column(String, default='0')
    clicks = Column(String, default='0')
    spend = Column(String, default='0.00')
    ctr = Column(String, default='0')
    cpc = Column(String, default='0')
    cpm = Column(String, default='0')
    reach = Column(String, default='0')
    results = Column(Integer, default=0)
    purchase_revenue = Column(Float, default=0.0)
    actions = Column(JSON, nullable=True)
    cost_per_action_type = Column(JSON, nullable=True)
    action_values = Column(JSON, nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('fb_ad_id', 'ad_account_id', name='uq_sync_ad'),
    )
```

- [ ] **Step 2: Run init_db to create tables**

```bash
cd backend && source venv/bin/activate
python init_db.py
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "Add FB sync models for local campaign/adset/ad data caching"
```

---

### Task 3: Sync Cron Script

**Files:**
- Create: `backend/run_fb_sync.py`

The cron script that pulls all FB data into our DB. Runs every 15 min on Railway.

- [ ] **Step 1: Create the sync script**

Create `backend/run_fb_sync.py`. The script should:

1. Loop through all active `FacebookConnection` records
2. For each connection, get all ad accounts
3. For each ad account, call:
   - `get_campaigns_with_insights()` — upsert into `FBSyncCampaign`
   - For each campaign, `get_adsets_with_insights()` — upsert into `FBSyncAdSet`
   - For each adset, `get_ads_with_insights()` — upsert into `FBSyncAd` (includes creative data)
4. Update `FBSyncStatus` with timestamp and counts
5. Use a 30-day lookback for insights (covers most reporting needs)

Key implementation details:
- Use `INSERT ... ON CONFLICT UPDATE` (SQLAlchemy merge pattern) for upserts
- Wrap in try/except per account so one failure doesn't block others
- Log progress and timing
- The sync should use `_extract_results()` and `_extract_purchase_revenue()` helpers from facebook_service.py to pre-compute results/revenue
- Time range: last 30 days (configurable via env var `FB_SYNC_LOOKBACK_DAYS`)

- [ ] **Step 2: Test sync script locally**

```bash
cd backend && source venv/bin/activate
python run_fb_sync.py
```

Verify data in DB:
```bash
python -c "
from app.database import SessionLocal
from app.models import FBSyncStatus, FBSyncCampaign
db = SessionLocal()
print('Sync status:', db.query(FBSyncStatus).count())
print('Campaigns:', db.query(FBSyncCampaign).count())
db.close()
"
```

- [ ] **Step 3: Commit**

```bash
git add backend/run_fb_sync.py
git commit -m "Add FB sync cron script — pulls campaigns/adsets/ads into local DB"
```

---

### Task 4: DB-Backed Reporting Endpoints

**Files:**
- Create: `backend/app/api/v1/reporting_sync.py`
- Modify: `backend/app/main.py`

New endpoints that serve data from local DB instead of hitting FB API.

- [ ] **Step 1: Create reporting_sync.py**

Endpoints to create (all return the same shape as the existing live endpoints):

```
GET /api/v1/reporting/campaigns?ad_account_id=X
GET /api/v1/reporting/adsets?ad_account_id=X&campaign_id=Y
GET /api/v1/reporting/ads?ad_account_id=X&adset_id=Y
GET /api/v1/reporting/all-ads?ad_account_id=X
GET /api/v1/reporting/all-adsets?ad_account_id=X
GET /api/v1/reporting/sync-status?ad_account_id=X
POST /api/v1/reporting/sync-now?ad_account_id=X  (manual trigger)
```

Each endpoint:
- Queries the `fb_sync_*` tables
- Reconstructs the same JSON shape the frontend expects (with `insights` nested object)
- Returns instantly from DB — zero FB API calls
- The `sync-now` endpoint spawns a background thread to run sync for one account

Important: The response format must match exactly what the existing `insights/*` endpoints return, so the frontend can switch with minimal changes.

Campaign endpoint example response shape:
```json
[{
  "id": "123",
  "name": "Campaign Name",
  "status": "ACTIVE",
  "effective_status": "ACTIVE",
  "objective": "OUTCOME_SALES",
  "daily_budget": "5000",
  "insights": {
    "impressions": "1234",
    "clicks": "56",
    "spend": "12.34",
    "results": 3,
    "purchase_revenue": 45.67,
    ...
  }
}]
```

- [ ] **Step 2: Register router in main.py**

Add to `backend/app/main.py`:
```python
from app.api.v1 import reporting_sync
app.include_router(reporting_sync.router, prefix="/api/v1/reporting", tags=["reporting-sync"])
```

- [ ] **Step 3: Test endpoints**

```bash
cd backend && source venv/bin/activate
uvicorn app.main:app --reload --port 8000 &
# After sync has run at least once:
curl -s http://localhost:8000/api/v1/reporting/sync-status?ad_account_id=YOUR_ACCOUNT | python -m json.tool
curl -s http://localhost:8000/api/v1/reporting/campaigns?ad_account_id=YOUR_ACCOUNT | python -m json.tool
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/reporting_sync.py backend/app/main.py
git commit -m "Add DB-backed reporting endpoints — zero FB API calls for reads"
```

---

### Task 5: Frontend — Switch Reads to Synced Data

**Files:**
- Modify: `frontend/src/lib/facebookApi.js`
- Modify: `frontend/src/pages/Reporting.jsx`

Switch the Reporting page to read from the new DB-backed endpoints and add a sync status indicator.

- [ ] **Step 1: Add new API functions in facebookApi.js**

```javascript
// ── Synced Reporting (DB-backed, no FB API calls) ──

export async function getSyncedCampaigns(adAccountId, connectionId = null) {
    let url = `${API_BASE_URL}/reporting/campaigns?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch synced campaigns');
    return response.json();
}

export async function getSyncedAdSets(campaignId, adAccountId, connectionId = null) {
    let url = `${API_BASE_URL}/reporting/adsets?ad_account_id=${adAccountId}&campaign_id=${campaignId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch synced ad sets');
    return response.json();
}

export async function getSyncedAds(adsetId, adAccountId, connectionId = null) {
    let url = `${API_BASE_URL}/reporting/ads?ad_account_id=${adAccountId}&adset_id=${adsetId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch synced ads');
    return response.json();
}

export async function getSyncedAllAds(adAccountId, connectionId = null) {
    let url = `${API_BASE_URL}/reporting/all-ads?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch all synced ads');
    return response.json();
}

export async function getSyncStatus(adAccountId, connectionId = null) {
    let url = `${API_BASE_URL}/reporting/sync-status?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch sync status');
    return response.json();
}

export async function triggerSync(adAccountId, connectionId = null) {
    let url = `${API_BASE_URL}/reporting/sync-now?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to trigger sync');
    return response.json();
}
```

- [ ] **Step 2: Update Reporting.jsx fetchData to use synced endpoints**

Replace the `fetchData` function's API calls:
- `getCampaignInsights(...)` → `getSyncedCampaigns(selectedAccount.id, connId)`
- `getAdSetInsights(...)` → `getSyncedAdSets(campaignId, selectedAccount.id, connId)`
- `getAdInsights(...)` → `getSyncedAds(adsetId, selectedAccount.id, connId)`
- `getAllAdInsights(...)` → `getSyncedAllAds(selectedAccount.id, connId)`

Remove the `since`/`until` params from the synced calls (the sync cron handles the date range — it syncs last 30 days). The frontend date picker now filters the synced data client-side, or we pass the date range as filter params to the DB query.

**Decision:** Pass `since`/`until` to the new endpoints so the DB query filters by `insights_since`/`insights_until`. This keeps the existing date picker working.

- [ ] **Step 3: Add sync status indicator to Reporting.jsx**

Add a small indicator near the top of the reporting page:
- Shows "Synced X min ago" with a green dot
- Shows "Syncing..." with a spinner when sync is in progress
- "Sync Now" button that calls `triggerSync()`
- If last sync > 30 min ago, show amber warning

```jsx
// Near the date range picker / account selector area:
<div className="flex items-center gap-2 text-xs text-gray-500">
    {syncStatus?.last_synced_at ? (
        <>
            <span className={`w-2 h-2 rounded-full ${minutesAgo < 30 ? 'bg-green-500' : 'bg-amber-500'}`} />
            Synced {minutesAgo}m ago ({syncStatus.campaigns_count} campaigns, {syncStatus.ads_count} ads)
        </>
    ) : (
        <span className="text-amber-600">Not synced yet</span>
    )}
    <button onClick={handleSyncNow} disabled={syncing} className="text-amber-600 hover:text-amber-700 font-medium">
        {syncing ? 'Syncing...' : 'Sync Now'}
    </button>
</div>
```

- [ ] **Step 4: Remove frontend cache (no longer needed)**

The frontend `cache` Map and `CACHE_TTL` can be removed — the DB is the cache now. Reads are instant.

- [ ] **Step 5: Test the full flow**

1. Run sync: `cd backend && python run_fb_sync.py`
2. Open Reporting page — should load instantly from DB
3. Click through campaigns → ad sets → ads — all instant, zero FB API calls
4. Click "Sync Now" — should trigger background sync
5. Toggle ad status — should still hit FB API directly (write path unchanged)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/facebookApi.js frontend/src/pages/Reporting.jsx
git commit -m "Switch Reporting to DB-backed reads — instant load, zero FB API calls for browsing"
```

---

### Task 6: Deploy Sync Cron to Railway

**Files:**
- May need: `backend/Dockerfile` or Railway config

- [ ] **Step 1: Deploy backend (models + new endpoints)**

Push to main — Railway auto-deploys. The new tables auto-create via init_db.

- [ ] **Step 2: Create Railway cron service for sync**

Use Railway API or dashboard to create a cron service:
- Name: `fb-sync`
- Schedule: `*/15 * * * *` (every 15 minutes)
- Command: `python run_fb_sync.py`
- Same env vars as backend

- [ ] **Step 3: Verify cron runs**

Check Railway logs for the sync cron. Verify `fb_sync_status` table has entries.

- [ ] **Step 4: Commit any deployment config changes**

```bash
git add -A && git commit -m "Configure FB sync cron service for Railway deployment"
```

---

### Task 7: Sync to Black Printer

- [ ] **Step 1: Copy all changed files to Black Printer**
- [ ] **Step 2: Push Black Printer**

---

## Summary of API Call Reduction

| Action | Before | After |
|--------|--------|-------|
| Load campaigns | 2 FB API calls | 0 (DB read) |
| Drill into ad sets | 2 FB API calls | 0 (DB read) |
| Drill into ads | 2-4 FB API calls | 0 (DB read) |
| Browse 5 campaigns + ad sets + ads | 10-20 FB API calls | 0 (DB read) |
| Toggle ad status | 1 FB API call | 1 FB API call (unchanged) |
| Change budget | 1 FB API call | 1 FB API call (unchanged) |
| Background sync (every 15 min) | ~10-20 FB API calls | ~10-20 FB API calls |

**Net result:** User browsing generates ZERO FB API calls. The only FB calls happen during the 15-min cron sync (controlled, predictable, never rate-limited because it's spread over time).
