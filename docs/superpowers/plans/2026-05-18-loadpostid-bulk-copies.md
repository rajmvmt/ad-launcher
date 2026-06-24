# Load-Post-ID Bulk Copies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copies per post ID" multiplier (1–25) to the "Use existing post" flow so one paste of N IDs creates N×M ads in the same ad set, with backend pacing that stays under Meta rate limits.

**Architecture:** Pure frontend expansion (the textarea N×M-fans into the existing `creatives` array) plus a thin backend pacing guard inside the existing sequential batch worker. No DB migrations, no new endpoints, no new dependencies.

**Tech Stack:** React 19 + Vite (frontend), Python 3.11 + FastAPI (backend), `facebook-business` SDK. Vitest for frontend unit tests, pytest for backend, agent-browser for e2e.

**Spec:** `docs/superpowers/specs/2026-05-18-loadpostid-bulk-copies-design.md`

---

## File Structure

**Modified:**

- `frontend/src/components/AdCreativeStep.jsx` — adds `existingPostCopies` state, "Copies per post ID" input, updated label/warnings, and `flatMap` expansion in `handleNext`.
- `backend/app/api/v1/facebook.py` — adds pacing inside the batch worker's existing-post branch (lines ~2340–2402) + a hard cap validation at the batch endpoint.

**Created:**

- `frontend/src/components/__tests__/AdCreativeStep.expansion.test.jsx` — unit test for the post-ID × copies expansion helper.
- `backend/tests/test_batch_pacing.py` — unit test for the pacing helper.

**Refactor note:** `AdCreativeStep.jsx` is large (~1800 lines). To keep the expansion logic testable and avoid bloating the component further, **extract a pure helper** `expandExistingPostCreatives(ids, copies, opts)` into a new file `frontend/src/components/adCreativeHelpers.js`. The component imports and calls it; the test imports it directly.

---

## Task 1: Extract pure helper for post-ID expansion (refactor, no behavior change)

**Files:**
- Create: `frontend/src/components/adCreativeHelpers.js`
- Modify: `frontend/src/components/AdCreativeStep.jsx` (around lines 1303–1317)

- [ ] **Step 1: Create the helper file with current behavior preserved**

Create `frontend/src/components/adCreativeHelpers.js`:

```js
// Pure helpers for AdCreativeStep. Kept side-effect-free so they can be unit-tested
// in isolation without mounting the React component.

/**
 * Expand a list of existing post IDs into the `creatives` array shape consumed
 * by the batch publish endpoint.
 *
 * @param {string[]} ids        - post IDs in user-pasted order (already deduped/trimmed by caller if desired)
 * @param {number}   copies     - copies per ID, integer 1..25 (clamped here defensively)
 * @param {object}   opts
 * @param {number}   opts.ts            - timestamp seed for unique React keys
 * @param {object}   opts.previewById   - { [postId]: { thumbnail, message, ... } }
 * @param {string}   opts.creativeName  - the user-entered creative name (used as ad name base)
 * @param {string}   opts.fallbackThumbnail - prev.existingPostThumbnail
 * @returns {Array<object>} creatives ready to stash in creativeData.creatives
 */
export function expandExistingPostCreatives(ids, copies, opts) {
    const { ts, previewById, creativeName, fallbackThumbnail } = opts;
    const safeCopies = Math.max(1, Math.min(25, parseInt(copies, 10) || 1));
    const multi = ids.length > 1;

    return ids.flatMap((postId, idx) => {
        const preview = previewById[postId] || {};
        return Array.from({ length: safeCopies }, (_, copyIdx) => {
            const baseName = multi ? `${creativeName} #${idx + 1}` : creativeName;
            const name = safeCopies > 1
                ? `${baseName} (copy ${copyIdx + 1}/${safeCopies})`
                : baseName;
            return {
                id: `existing-post-${ts}-${idx}-c${copyIdx}`,
                name,
                mediaType: 'existing',
                existing_post_id: postId,
                previewUrl: preview.thumbnail || fallbackThumbnail || null,
                imageUrl: preview.thumbnail || fallbackThumbnail || null,
                headlines: [],
                bodies: [],
                description: '',
                cta: '',
            };
        });
    });
}
```

- [ ] **Step 2: Swap the inline map in AdCreativeStep.jsx to use the helper**

In `frontend/src/components/AdCreativeStep.jsx`, add the import near the other component imports (around the top of the file, alongside the other relative imports):

```js
import { expandExistingPostCreatives } from './adCreativeHelpers';
```

Replace lines 1300–1318 (the `setCreativeData(prev => ({ ...prev, creatives: ids.map(...) }))` block) with:

```js
const ts = Date.now();
setCreativeData(prev => ({
    ...prev,
    creatives: expandExistingPostCreatives(ids, 1, {
        ts,
        previewById,
        creativeName: prev.creativeName,
        fallbackThumbnail: prev.existingPostThumbnail,
    }),
}));
```

(Copies is hard-coded to `1` in this task — Task 3 wires it to user input.)

- [ ] **Step 3: Verify regression — run the frontend dev server and confirm 1 ID still produces 1 ad**

Run:
```bash
cd /home/roly/iscale-facebook-ad-builder/frontend
npm run dev
```

In a browser at `http://localhost:5173`, walk through Create Campaign → enable "Use existing post" → paste one valid post ID → click Next → confirm the bulk-ad-creation screen shows exactly 1 ad with name matching `creativeName` and no `(copy 1/1)` suffix.

Stop the dev server when done (`Ctrl+C`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/adCreativeHelpers.js frontend/src/components/AdCreativeStep.jsx
git commit -m "refactor: extract expandExistingPostCreatives helper

Pure helper for existing-post creative expansion, no behavior change.
Sets up Task 2/3 to add copies multiplier with unit-testable logic."
```

---

## Task 2: Unit test the helper (TDD baseline)

**Files:**
- Create: `frontend/src/components/__tests__/AdCreativeStep.expansion.test.jsx`

- [ ] **Step 1: Write failing tests covering current + future behavior**

Create the file with:

```jsx
import { describe, it, expect } from 'vitest';
import { expandExistingPostCreatives } from '../adCreativeHelpers';

const baseOpts = {
    ts: 1700000000000,
    previewById: { '123_456': { thumbnail: 'http://t/1.jpg' }, '789_012': { thumbnail: 'http://t/2.jpg' } },
    creativeName: 'My Ad',
    fallbackThumbnail: null,
};

describe('expandExistingPostCreatives', () => {
    it('1 id × 1 copy → 1 creative, no copy suffix', () => {
        const out = expandExistingPostCreatives(['123_456'], 1, baseOpts);
        expect(out).toHaveLength(1);
        expect(out[0].existing_post_id).toBe('123_456');
        expect(out[0].name).toBe('My Ad');
        expect(out[0].name).not.toMatch(/copy/);
    });

    it('1 id × 5 copies → 5 creatives with (copy N/5) suffix', () => {
        const out = expandExistingPostCreatives(['123_456'], 5, baseOpts);
        expect(out).toHaveLength(5);
        out.forEach((c, i) => {
            expect(c.existing_post_id).toBe('123_456');
            expect(c.name).toBe(`My Ad (copy ${i + 1}/5)`);
        });
    });

    it('3 ids × 4 copies → 12 creatives, grouped by source id in order', () => {
        const out = expandExistingPostCreatives(['a', 'b', 'c'], 4, {
            ...baseOpts, previewById: {},
        });
        expect(out).toHaveLength(12);
        // First 4 are id "a", next 4 "b", next 4 "c"
        expect(out.slice(0, 4).every(c => c.existing_post_id === 'a')).toBe(true);
        expect(out.slice(4, 8).every(c => c.existing_post_id === 'b')).toBe(true);
        expect(out.slice(8, 12).every(c => c.existing_post_id === 'c')).toBe(true);
        // Multi-ID naming includes "#N" + "(copy K/M)"
        expect(out[0].name).toBe('My Ad #1 (copy 1/4)');
        expect(out[7].name).toBe('My Ad #2 (copy 4/4)');
    });

    it('produces unique React keys across all expanded creatives', () => {
        const out = expandExistingPostCreatives(['a', 'b'], 10, baseOpts);
        const ids = out.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('clamps copies to [1, 25]', () => {
        expect(expandExistingPostCreatives(['a'], 0, baseOpts)).toHaveLength(1);
        expect(expandExistingPostCreatives(['a'], -5, baseOpts)).toHaveLength(1);
        expect(expandExistingPostCreatives(['a'], 100, baseOpts)).toHaveLength(25);
        expect(expandExistingPostCreatives(['a'], 'garbage', baseOpts)).toHaveLength(1);
        expect(expandExistingPostCreatives(['a'], null, baseOpts)).toHaveLength(1);
    });

    it('uses preview thumbnail when available, falls back otherwise', () => {
        const out = expandExistingPostCreatives(['123_456', 'unknown'], 1, {
            ...baseOpts, fallbackThumbnail: 'http://fallback.jpg',
        });
        expect(out[0].imageUrl).toBe('http://t/1.jpg');
        expect(out[1].imageUrl).toBe('http://fallback.jpg');
    });
});
```

- [ ] **Step 2: Run tests — expect all to PASS (Task 1 already implements the behavior)**

Run:
```bash
cd /home/roly/iscale-facebook-ad-builder/frontend
npx vitest run src/components/__tests__/AdCreativeStep.expansion.test.jsx
```

Expected: 6 tests pass. If any fail, fix the helper in `adCreativeHelpers.js` until they pass — the helper is the spec, the tests pin it down.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/AdCreativeStep.expansion.test.jsx
git commit -m "test: unit cover expandExistingPostCreatives helper

6 cases: 1×1, 1×5, 3×4, key uniqueness, clamping, preview fallback."
```

---

## Task 3: Wire the "Copies per post ID" input into the UI

**Files:**
- Modify: `frontend/src/components/AdCreativeStep.jsx` (around lines 1565–1598 — the existing-post panel, plus lines 1300–1310 in `handleNext`)

- [ ] **Step 1: Add the input + updated label + warnings inside the existing-post panel**

In `frontend/src/components/AdCreativeStep.jsx`, find the IIFE label block at lines 1567–1577 (the `{(() => { const idCount = parsePostIds(...).length; ... })()}` block) and replace the entire `{creativeData.useExistingPost && (...)}` body up to and including the helper text at line 1598. Replace with:

```jsx
{creativeData.useExistingPost && (
    <div className="mt-3">
        {(() => {
            const idCount = parsePostIds(creativeData.existingPostId).length;
            const copies = Math.max(1, Math.min(25, parseInt(creativeData.existingPostCopies, 10) || 1));
            const totalAds = idCount * copies;
            return (
                <>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                        Existing Post ID(s) *
                        {idCount > 0 && (
                            <span className="ml-2 text-blue-600">
                                ({idCount} post{idCount === 1 ? '' : 's'}
                                {copies > 1 ? ` × ${copies} copies` : ''}
                                {' → '}
                                {totalAds} ad{totalAds === 1 ? '' : 's'} in this ad set)
                            </span>
                        )}
                    </label>
                    <div className="flex gap-2 items-start">
                        <textarea
                            rows={3}
                            value={creativeData.existingPostId || ''}
                            onChange={(e) => handleInputChange('existingPostId', e.target.value)}
                            onBlur={fetchPostPreview}
                            placeholder={"One ID per line, or comma-separated:\n122134499684981797\n120239876543210123"}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
                        />
                        <button
                            type="button"
                            onClick={fetchPostPreview}
                            disabled={postPreviewLoading || !creativeData.existingPostId?.trim()}
                            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                        >
                            {postPreviewLoading ? <Loader size={14} className="animate-spin" /> : 'Load'}
                        </button>
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                        <label className="text-xs font-medium text-gray-700 whitespace-nowrap">
                            Copies per post ID:
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={25}
                            value={creativeData.existingPostCopies ?? 1}
                            onChange={(e) => {
                                const raw = parseInt(e.target.value, 10);
                                const clamped = Math.max(1, Math.min(25, Number.isFinite(raw) ? raw : 1));
                                handleInputChange('existingPostCopies', clamped);
                            }}
                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <span className="text-[11px] text-gray-500">(1–25; same post duplicated)</span>
                    </div>

                    <p className="text-[11px] text-gray-500 mt-1">
                        Paste one or many post IDs (one per line, or comma-separated). Format: <code className="bg-white px-1 rounded">pageId_postId</code> or just <code className="bg-white px-1 rounded">postId</code>. Each ID is duplicated by the copies count above.
                    </p>

                    {totalAds > 20 && totalAds <= 250 && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                            ⚠ {totalAds} ads is a large batch — backend will pace automatically to avoid Meta rate limits (~{Math.ceil(totalAds * 1.2)}s).
                        </p>
                    )}
                    {totalAds > 250 && (
                        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
                            ✗ Max 250 ads per submission. Reduce post IDs or copies. (Currently: {idCount} × {copies} = {totalAds})
                        </p>
                    )}
                </>
            );
        })()}

        {postPreviewError && (
            <p className="text-[11px] text-red-600 mt-2">{postPreviewError}</p>
        )}
        {postPreviews.length > 0 && (
            <div className="mt-3 space-y-2">
                {postPreviews.map((p, idx) => (
                    <div key={`${p.id}-${idx}`} className="flex gap-3 p-3 bg-white border border-gray-200 rounded-lg">
                        {p.error ? (
                            <div className="w-20 h-20 bg-red-50 border border-red-200 rounded flex items-center justify-center text-xs text-red-500 flex-shrink-0">error</div>
                        ) : p.thumbnail ? (
                            <img src={p.thumbnail} alt="Post thumbnail" className="w-20 h-20 object-cover rounded flex-shrink-0" />
                        ) : (
                            <div className="w-20 h-20 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400 flex-shrink-0">No image</div>
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-gray-400 font-mono mb-0.5">{p.id}</div>
                            <div className="text-xs text-gray-500 mb-1">
                                {p.error ? 'failed to load' : p.isDarkPost ? 'dark / unpublished post' : (p.type || 'post')}
                            </div>
                            {p.error ? (
                                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{p.error}</div>
                            ) : p.isDarkPost ? (
                                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                    {p.previewNote || 'Preview unavailable, but post ID is valid for ad creation.'}
                                </div>
                            ) : (
                                <div className="text-sm text-gray-800 line-clamp-3">{p.message || <span className="text-gray-400 italic">(no caption)</span>}</div>
                            )}
                            {p.permalink && (
                                <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline mt-1 inline-block">View on Facebook ↗</a>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        )}
    </div>
)}
```

- [ ] **Step 2: Wire copies into the `handleNext` expansion + add 250 guard**

In the same file, in `handleNext` (around line 1289), replace the existing-post block (lines 1289–1321) with:

```jsx
if (creativeData.useExistingPost) {
    const ids = parsePostIds(creativeData.existingPostId);
    if (ids.length === 0) {
        showWarning('Please enter at least one existing post ID');
        return;
    }
    if (!creativeData.pageId) {
        showWarning('Please select or enter a Facebook Page');
        return;
    }
    const copies = Math.max(1, Math.min(25, parseInt(creativeData.existingPostCopies, 10) || 1));
    const totalAds = ids.length * copies;
    if (totalAds > 250) {
        showWarning(`Max 250 ads per submission. Currently ${ids.length} × ${copies} = ${totalAds}. Reduce post IDs or copies.`);
        return;
    }
    const previewById = Object.fromEntries(postPreviews.map(p => [p.id, p]));
    const ts = Date.now();
    setCreativeData(prev => ({
        ...prev,
        creatives: expandExistingPostCreatives(ids, copies, {
            ts,
            previewById,
            creativeName: prev.creativeName,
            fallbackThumbnail: prev.existingPostThumbnail,
        }),
    }));
    onNext();
    return;
}
```

- [ ] **Step 3: Default `existingPostCopies` in CampaignContext (if needed) or rely on `?? 1` fallback**

Check `frontend/src/context/CampaignContext.jsx` for the default `creativeData` shape:

```bash
grep -n "creativeData\|existingPostId" /home/roly/iscale-facebook-ad-builder/frontend/src/context/CampaignContext.jsx
```

If there's an explicit `creativeData` initial state with `existingPostId: ''`, add `existingPostCopies: 1` alongside it. If the initial state is empty/spread-based, the `?? 1` fallback in the input + the clamp in `handleNext` are sufficient — skip this step.

- [ ] **Step 4: Manual smoke test in the browser**

Run:
```bash
cd /home/roly/iscale-facebook-ad-builder/frontend
npm run dev
```

In a browser at `http://localhost:5173`:
1. Create Campaign → enable "Use existing post"
2. Paste 1 post ID, copies=1 → label reads `(1 post → 1 ad in this ad set)`, no warnings
3. Change copies to 5 → label reads `(1 post × 5 copies → 5 ads in this ad set)`
4. Paste 3 post IDs (comma-separated), copies=10 → label reads `(3 posts × 10 copies → 30 ads in this ad set)`, **yellow warning** appears
5. Set copies to 25 with 11 IDs → **red error** appears, Next button still shows warning when clicked
6. Type "abc" into copies input → clamps to 1
7. Type "99" → clamps to 25

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdCreativeStep.jsx frontend/src/context/CampaignContext.jsx
git commit -m "feat: add 'Copies per post ID' input to existing-post flow

Frontend-only expansion: N IDs × M copies (1-25) → N×M creatives in same ad set.
Live counter, yellow warning >20, red block >250. Unique (copy K/M) naming."
```

---

## Task 4: Backend pacing helper (TDD)

**Files:**
- Create: `backend/tests/test_batch_pacing.py`
- Create: `backend/app/services/pacing.py`

- [ ] **Step 1: Write failing test for the pacing helper**

Create `backend/tests/test_batch_pacing.py`:

```python
"""Tests for the bulk-ad pacing helper used by the existing-post batch worker."""
from app.services.pacing import compute_sleep_for_index


def test_no_sleep_at_index_zero():
    # First ad never sleeps.
    assert compute_sleep_for_index(0, total=10) == 0


def test_short_sleep_between_ads_in_a_wave():
    # 1s between ads inside a wave of 5.
    assert compute_sleep_for_index(1, total=10) == 1
    assert compute_sleep_for_index(2, total=10) == 1
    assert compute_sleep_for_index(4, total=10) == 1


def test_long_sleep_at_wave_boundary():
    # Every 5th ad (index 5, 10, 15) gets a 5s wave-end sleep.
    assert compute_sleep_for_index(5, total=10) == 5
    assert compute_sleep_for_index(10, total=20) == 5
    assert compute_sleep_for_index(15, total=20) == 5


def test_small_batches_use_legacy_2s_rhythm():
    # ≤5 ads: keep today's 2s rhythm, no waves (zero regression for non-bulk).
    assert compute_sleep_for_index(0, total=3) == 0
    assert compute_sleep_for_index(1, total=3) == 2
    assert compute_sleep_for_index(2, total=3) == 2
    assert compute_sleep_for_index(4, total=5) == 2


def test_boundary_at_total_equals_5():
    # total=5 is the threshold — still legacy rhythm.
    assert compute_sleep_for_index(1, total=5) == 2
    assert compute_sleep_for_index(4, total=5) == 2


def test_boundary_at_total_equals_6():
    # total=6 switches to bulk pacing.
    assert compute_sleep_for_index(1, total=6) == 1
    assert compute_sleep_for_index(5, total=6) == 5
```

- [ ] **Step 2: Run tests to verify they fail (module not found)**

Run:
```bash
cd /home/roly/iscale-facebook-ad-builder/backend
source venv/bin/activate
pytest tests/test_batch_pacing.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.services.pacing'`.

- [ ] **Step 3: Implement the helper**

Create `backend/app/services/pacing.py`:

```python
"""
Pacing helpers for bulk Meta ad creation.

Meta's Marketing API throttles aggressive ad creation with 429 errors. The
validated pattern (see feedback_meta_avoid_rate_limits.md) is sequential
creation, sleep 1s between ads, and a longer 5s pause every 5 ads (one "wave").

For small batches (≤5 ads) we preserve the legacy 2s inter-ad rhythm so nothing
changes for non-bulk submissions.
"""

WAVE_SIZE = 5
BULK_THRESHOLD = 5  # batches > 5 enable wave pacing
LEGACY_INTER_AD_SLEEP = 2
BULK_INTER_AD_SLEEP = 1
WAVE_END_SLEEP = 5


def compute_sleep_for_index(index: int, total: int) -> int:
    """How many seconds to sleep BEFORE creating the ad at `index` (0-based).

    Args:
        index: 0-based index of the ad about to be created.
        total: total number of ads in this batch.

    Returns:
        Sleep duration in seconds. Always 0 for index 0.
    """
    if index == 0:
        return 0
    if total <= BULK_THRESHOLD:
        return LEGACY_INTER_AD_SLEEP
    # Bulk mode: wave end gets the long sleep, otherwise short.
    if index % WAVE_SIZE == 0:
        return WAVE_END_SLEEP
    return BULK_INTER_AD_SLEEP
```

- [ ] **Step 4: Run tests to verify all pass**

Run:
```bash
cd /home/roly/iscale-facebook-ad-builder/backend
source venv/bin/activate
pytest tests/test_batch_pacing.py -v
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pacing.py backend/tests/test_batch_pacing.py
git commit -m "feat: add compute_sleep_for_index pacing helper

Sequential pacing for bulk Meta ad creation: 1s between ads, 5s every 5 ads.
≤5-ad batches keep the legacy 2s rhythm (zero regression)."
```

---

## Task 5: Wire pacing into the existing-post batch worker

**Files:**
- Modify: `backend/app/api/v1/facebook.py` (around lines 2340–2402 — the existing-post branch inside the batch worker loop; plus the top of the worker for tracking total count)

- [ ] **Step 1: Add import + count existing-post ads up front**

In `backend/app/api/v1/facebook.py`, near the other `from app.services...` imports at the top of the file:

```python
from app.services.pacing import compute_sleep_for_index
```

(Verify the import path matches existing style — `grep -n "from app.services" backend/app/api/v1/facebook.py | head -3`.)

- [ ] **Step 2: Find existing-post ad count + track index, sleep before each create**

The worker loop processes `ads_data` mixing video/image/existing-post entries. Pacing should apply to **existing-post ads specifically** (they're the bulk-copy case). Count them once before the loop and maintain a per-existing-post counter inside the loop.

Locate the worker function (it's the one containing the lines you already saw at 2340–2402 — `for i, ad in enumerate(ads_data):`). **Before** that `for` loop, add:

```python
# Count existing-post ads up-front so the pacing helper knows the total
# (mixed batches: video/image/existing-post; pacing only applies to existing-post).
existing_post_total = sum(
    1 for a in ads_data
    if a.get('publishStatus') != 'created' and any(
        (c.get('id') == a.get('creativeId') and c.get('existing_post_id'))
        for c in (creative_data.get('creatives') or [])
    )
) or sum(
    # Fallback: count by creative_data.existing_post_id (legacy single-post path)
    1 for a in ads_data
    if a.get('publishStatus') != 'created' and creative_data.get('existing_post_id')
)
existing_post_seen = 0
```

Then **inside** the existing-post branch (right after `if existing_post_id and str(existing_post_id).strip():` and the `print(...)` line), add the pacing sleep BEFORE `service.create_creative_from_post(...)`:

```python
# Pace bulk-copy submissions to avoid Meta 429s.
import time as _pacing_time
sleep_s = compute_sleep_for_index(existing_post_seen, existing_post_total)
if sleep_s > 0:
    print(f"[batch_worker] Pacing sleep {sleep_s}s before existing-post ad {existing_post_seen + 1}/{existing_post_total}")
    _pacing_time.sleep(sleep_s)
existing_post_seen += 1
```

- [ ] **Step 3: Verify the rest of the existing-post branch is unchanged**

Read lines 2360–2402 to confirm `create_creative_from_post`, `create_ad`, and the DB update block are untouched. Pacing is additive only.

```bash
grep -n "create_creative_from_post\|compute_sleep_for_index\|existing_post_seen" backend/app/api/v1/facebook.py
```

Expected: 1 import, 1 declaration + 1 counter increment, 1 call to `compute_sleep_for_index`, original `create_creative_from_post` call intact.

- [ ] **Step 4: Smoke-test the import + counter logic with a tiny script**

```bash
cd /home/roly/iscale-facebook-ad-builder/backend
source venv/bin/activate
python -c "
from app.services.pacing import compute_sleep_for_index
# Simulate a 12-existing-post batch
delays = [compute_sleep_for_index(i, 12) for i in range(12)]
print('Per-ad delays:', delays)
print('Total wall time (s):', sum(delays))
"
```

Expected output:
```
Per-ad delays: [0, 1, 1, 1, 1, 5, 1, 1, 1, 1, 5, 1]
Total wall time (s): 19
```

(12 ads → ~19s of pacing overhead — well under Meta's rate-limit windows.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/facebook.py
git commit -m "feat: pace existing-post batch worker to avoid Meta 429s

Calls compute_sleep_for_index before each existing-post ad creation.
1s between ads, 5s every 5 (one wave). Legacy 2s rhythm for batches ≤5."
```

---

## Task 6: Backend defense-in-depth — hard cap at 250 + reject duplicate ad names

**Files:**
- Modify: `backend/app/api/v1/facebook.py` (the endpoint that accepts the publish batch — find it via grep)

- [ ] **Step 1: Locate the batch publish endpoint**

```bash
grep -n "def.*publish\|def.*batch\|@router.post.*batch\|PublishBatch" backend/app/api/v1/facebook.py | head -20
```

Expected: an endpoint like `@router.post("/publish-batch")` or similar that constructs the `PublishBatch` row and kicks off the worker. Note its line number.

- [ ] **Step 2: Add validation at the top of the endpoint handler (before the batch row is created)**

In the endpoint function body, immediately after the request body is parsed and before any DB writes:

```python
# Hard cap: max 250 ads per submission (defense in depth; frontend also blocks).
creatives = (creative_data.get('creatives') or [])
existing_post_creatives = [c for c in creatives if c.get('existing_post_id')]
if len(existing_post_creatives) > 250:
    raise HTTPException(
        status_code=400,
        detail=f"Too many existing-post ads in one submission: {len(existing_post_creatives)} (max 250). Reduce post IDs or copies.",
    )

# Each existing-post creative must have a unique name (Meta would silently
# auto-suffix duplicates and break tracking).
names = [c.get('name') for c in existing_post_creatives if c.get('name')]
if len(names) != len(set(names)):
    duplicates = sorted({n for n in names if names.count(n) > 1})
    raise HTTPException(
        status_code=400,
        detail=f"Duplicate ad names in submission: {duplicates}. Each copy must have a unique name.",
    )
```

(If `HTTPException` isn't already imported, add `from fastapi import HTTPException` to the imports.)

- [ ] **Step 3: Manual sanity check — start backend, send a malformed payload**

```bash
cd /home/roly/iscale-facebook-ad-builder/backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

In another terminal (replace `<endpoint>` with the exact path from Step 1):

```bash
# Should return 400 with the duplicate-name message
curl -X POST http://localhost:8000/api/v1/facebook/<endpoint> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <a valid dev token, or skip auth if endpoint is open>" \
  -d '{
    "creative_data": {
      "creatives": [
        {"id": "x1", "name": "dup", "existing_post_id": "123_456"},
        {"id": "x2", "name": "dup", "existing_post_id": "123_456"}
      ]
    },
    "ads_data": []
  }'
```

Expected response: HTTP 400 with `"Duplicate ad names in submission: ['dup']..."`.

Stop the backend (`Ctrl+C`).

(If auth is required and you don't have a dev token handy, skip the curl test and rely on Task 7's end-to-end test to validate. Note that as a TODO in commit message.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/facebook.py
git commit -m "feat: validate existing-post batch — max 250 ads, unique names

Defense-in-depth: rejects oversized submissions and duplicate ad names
before they reach Meta (which would silently auto-suffix and break tracking)."
```

---

## Task 7: End-to-end live test against a real FB ad account

**Files:** none (manual e2e against the live MVMT backend + Meta API)

**Prereq:** You need a cheap test post ID on an active MVMT FB page and a test ad set you can target. Use an existing low-spend ad set; pause it immediately after creation if needed.

- [ ] **Step 1: Start backend + frontend**

```bash
# Terminal 1
cd /home/roly/iscale-facebook-ad-builder/backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Terminal 2
cd /home/roly/iscale-facebook-ad-builder/frontend && npm run dev
```

- [ ] **Step 2: Regression — 1 post ID × 1 copy → 1 ad**

In browser, go through Create Campaign → existing post mode → paste 1 valid post ID → copies=1 → Next → Publish. Verify in Meta Ads Manager: 1 ad created, name matches `creativeName`, no `(copy 1/1)` suffix.

- [ ] **Step 3: Basic bulk — 1 post ID × 5 copies → 5 ads**

Same flow, copies=5. Verify:
- 5 ads in the same ad set
- Names are `My Ad (copy 1/5)` … `My Ad (copy 5/5)` (or matching your `creativeName`)
- All 5 reference the same post (open one in Ads Manager → preview shows the same image/copy)
- Backend log shows pacing: `Pacing sleep 1s before existing-post ad 2/5` etc.

- [ ] **Step 4: Multi-ID × copies — 3 post IDs × 4 copies → 12 ads**

Paste 3 post IDs, copies=4. Verify:
- 12 ads, grouped 4-4-4 by source post ID
- Names like `My Ad #1 (copy 1/4)`, `My Ad #1 (copy 2/4)` … `My Ad #3 (copy 4/4)`
- Backend log shows wave sleeps at ads 6 and 11 (5s each)

- [ ] **Step 5: Pacing under load — 1 post ID × 15 copies → 15 ads, no 429**

Paste 1 post ID, copies=15. Verify:
- All 15 ads land within ~25s (4 short sleeps × 1s + 2 wave sleeps × 5s + ~15 API calls)
- Backend log shows wave sleeps at indexes 5 and 10
- No `429` or `rate limit` strings in backend log
- Meta Ads Manager shows 15 ads, no auto-suffixed `(2)` `(3)` names

- [ ] **Step 6: Invalid ID handling — 1 invalid ID × 3 copies**

Paste a bogus ID like `999999999999_999999999999`, copies=3. Verify:
- 3 failed-ad entries returned, all with the same error (Meta says "object not found" or similar)
- Single grouped error surfaces in the UI (acceptable: 3 identical error toasts as today; ideal: deduped — note as follow-up if not deduped)
- No partial Meta side-effects (no orphan creatives left dangling)

- [ ] **Step 7: Hard cap — frontend block**

In the UI, set up 11 post IDs × 25 copies. Verify:
- Red error message appears in the existing-post panel
- Clicking Next shows a warning toast
- No network request fires to the backend

- [ ] **Step 8: Hard cap — backend block (if frontend bypass possible)**

Open browser devtools and manually fire a fetch to the publish-batch endpoint with 251 existing-post creatives (or use curl). Verify HTTP 400 with the "Too many existing-post ads" message.

- [ ] **Step 9: Run unit tests one final time**

```bash
cd /home/roly/iscale-facebook-ad-builder/frontend && npx vitest run src/components/__tests__/AdCreativeStep.expansion.test.jsx
cd /home/roly/iscale-facebook-ad-builder/backend && source venv/bin/activate && pytest tests/test_batch_pacing.py -v
```

Expected: all green.

- [ ] **Step 10: Invoke vercel-plugin:react-best-practices for the JSX changes**

Run the Skill tool with `vercel-plugin:react-best-practices` to review `AdCreativeStep.jsx` for hook usage, key uniqueness, accessibility, and performance regressions introduced by the new input. Fix any flagged issues; commit fixes.

- [ ] **Step 11: Final commit + push**

```bash
# Any uncommitted UI tweaks from Steps 6/10
git status
git add -p  # review hunks one-by-one — NEVER use -A or -am per workflow rules
git commit -m "fix: e2e test polish for bulk-copies feature"
git push
```

---

## Self-Review Notes

**Spec coverage:**
- §1 UI input + label + warnings → Task 3 Step 1 ✓
- §2 Creatives array expansion → Tasks 1 + 3 ✓
- §3 Backend pacing → Tasks 4 + 5 ✓
- §4 Validation gates (250 cap, unique names) → Tasks 3 Step 2 (client) + Task 6 (server) ✓
- §5 State shape (`existingPostCopies`) → Task 3 Step 3 ✓
- Error handling table (clamping, partial failures) → Tasks 2, 3, 5, 7 ✓
- E2E test plan #1–#7 → Task 7 Steps 2–8 ✓

**Type consistency:** `expandExistingPostCreatives` signature is identical across Tasks 1, 2, 3. `compute_sleep_for_index(index, total)` identical across Tasks 4, 5. `existingPostCopies` field name identical across Tasks 3, 3-step-2, 3-step-3.

**No placeholders:** every code step has full code; every command has expected output; no "implement later" entries.

**One known soft spot:** Task 6 Step 3 (`<endpoint>` placeholder for curl) — engineer must `grep` for the exact path in Step 1 and substitute. This is unavoidable without reading more of `facebook.py` than necessary at plan time; flagged in the step text itself.
