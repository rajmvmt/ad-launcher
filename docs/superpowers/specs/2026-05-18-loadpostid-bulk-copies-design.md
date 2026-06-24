# Load-Post-ID Bulk Copies — Design

**Date:** 2026-05-18
**Component:** MVMT Printer — Ad Creative Step ("Use existing post" flow)
**Status:** Approved by Roly, ready for implementation plan

---

## Problem

The "Use existing post" toggle in `AdCreativeStep.jsx` currently maps **N post IDs → N ads** (one ad per ID, all in the same ad set). Roly needs to spin up multiple **duplicate** ads from a single (or small set of) post ID(s) — e.g. 10 copies of one freshly-loaded post ID, sometimes 2, 3, 4, 6+. A variable copy count.

Today this requires pasting the same post ID N times into the textarea — clumsy and easy to lose count.

## Goal

Add a "Copies per post ID" multiplier to the existing-post flow that:

1. Expands `N IDs × M copies → N×M ads` in the same ad set.
2. Names each duplicate uniquely (so Meta doesn't auto-suffix `(1)`, `(2)` and break tracking).
3. Paces backend submission to stay under Meta's rate limits (no 429s like the Vital launch).
4. Causes zero regression when `copies = 1` (today's behavior).

## Non-Goals

- Spreading copies across multiple ad sets (Bahiana-style scale launch). That's a separate workflow.
- Per-line copy counts (`123_456 x10`). One multiplier applies uniformly to all pasted IDs.
- Variable creative per copy. All copies reference the same post ID; the only differences are ad name and Meta ad ID.

---

## Design

### 1. Frontend — UI

**File:** `frontend/src/components/AdCreativeStep.jsx`

Inside the existing `Use existing post` panel (`creativeData.useExistingPost === true`), directly **below the post-ID textarea and above the preview cards**, add a small inline number input:

```
┌─────────────────────────────────────────────────────┐
│ Existing Post ID(s) *  (2 posts → 20 ads in this ad set) │
│ ┌────────────────────────────────────────────────┐  │
│ │ 123_456                                        │  │
│ │ 789_012                                        │  │
│ └────────────────────────────────────────────────┘  │
│                                                     │
│ Copies per post ID: [ 10 ]   (range 1–25)           │
│                                                     │
│ ⚠ 20 ads is large — Meta will be paced automatically│
└─────────────────────────────────────────────────────┘
```

- **Input:** `<input type="number" min={1} max={25} value={copies} />`
- **Default:** `1` (zero regression)
- **State:** new field `creativeData.existingPostCopies` (integer, defaults to `1`)
- **Live counter** in the textarea label updates from `({idCount} posts → {idCount} ads)` to `({idCount} posts × {copies} copies → {idCount * copies} ads in this ad set)`
- **Yellow warning** when `idCount * copies > 20`: "Meta may rate-limit large batches; backend will pace automatically."
- **Red block** when `idCount * copies > 250`: submit button disabled, error: "Max 250 ads per submission. Reduce IDs or copies."

### 2. Frontend — Creatives Array Expansion

**File:** `frontend/src/components/AdCreativeStep.jsx` (around line 1303)

Current:
```js
creatives: ids.map((postId, idx) => { ... })
```

Replace with:
```js
const copies = Math.max(1, Math.min(25, parseInt(creativeData.existingPostCopies, 10) || 1));
creatives: ids.flatMap((postId, idx) => {
    const preview = previewById[postId] || {};
    return Array.from({ length: copies }, (_, copyIdx) => ({
        id: `existing-post-${ts}-${idx}-c${copyIdx}`,
        existing_post_id: postId,
        // unique name so Meta doesn't auto-suffix
        name: copies > 1
            ? `Existing Post Ad ${postId} (copy ${copyIdx + 1}/${copies})`
            : `Existing Post Ad ${postId}`,
        previewUrl: preview.thumbnail || prev.existingPostThumbnail || null,
        imageUrl:   preview.thumbnail || prev.existingPostThumbnail || null,
        // ...other existing fields unchanged
    }));
})
```

Each entry keeps the same `existing_post_id`, preview, and downstream payload shape — only `id` and `name` differ across copies.

### 3. Backend — Pacing

**File:** `backend/app/api/v1/facebook.py` (batch worker, around line 2382)

The batch worker already iterates `creatives` sequentially and creates one ad per entry via `service.create_ad(...)`. Today it sleeps 2s between ads for post propagation. For bulk-copy submissions:

- **Inter-ad sleep:** 1s (down from 2 — duplicates of the same post don't need propagation time, the post already exists).
- **Wave sleep:** every 5 ads created, sleep an additional 4s (total 5s gap). Matches the validated pattern in `feedback_meta_avoid_rate_limits.md` ("cap parallelism to 5/wave, sleep 3 between phases").
- **No new concurrency.** Sequential only. Existing retry/backoff in `facebook_service.py:1008–1073` already handles 429s with exponential backoff; we just feed slower.
- **Skip the immediate verify-GET.** The worker already does this; just don't reintroduce it for the duplicate path.

Pacing is gated on `len(creatives) > 5` — sub-5 submissions use today's 2s rhythm with no wave sleep (zero regression).

### 4. Backend — Validation

**File:** `backend/app/api/v1/facebook.py` (batch endpoint that accepts the creatives array)

- Reject any creative entry where `existing_post_id` is set but `name` is missing or duplicated within the same submission.
- Hard cap total creatives per submission at 250. Return `400` with clear error.
- The frontend already blocks above 250, so this is a defense-in-depth check.

### 5. State Shape Changes

`creativeData` (in `CampaignContext.jsx` or local AdCreativeStep state) gains:
```js
existingPostCopies: 1  // integer, 1–25
```

No backend model changes — `existingPostCopies` is purely a frontend expansion knob. The backend never sees it; it just receives the expanded `creatives` array.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `copies = 0` or negative | Clamp to 1 on input change |
| `copies > 25` | Clamp to 25; show "Max 25 copies per ID" inline hint |
| `idCount × copies > 250` | Disable submit; show red error message |
| One post ID is invalid (preview failed) | Submission still proceeds; backend reports per-ad failure as today. With copies > 1, all N copies of the bad ID will fail with the same error — surface a single grouped error in the result panel, not N identical toasts. |
| Meta returns 429 mid-batch | Existing retry/backoff catches it; if it exhausts retries on ad K of N, return partial success: "Created 7 of 10 ads. Failed: [...]" |

---

## Testing Plan (End-to-End, post-build)

Tested live against an MVMT FB ad account with a real (cheap, paused-after) ad set.

1. **Regression:** 1 post ID × 1 copy → 1 ad created, named `Existing Post Ad {id}` (no `(copy 1/1)` suffix).
2. **Basic bulk:** 1 post ID × 5 copies → 5 ads in same ad set, names `(copy 1/5)` through `(copy 5/5)`, all referencing the same post.
3. **Multi-ID × copies:** 3 post IDs × 4 copies → 12 ads, correctly grouped (4 per source ID), all named uniquely.
4. **Pacing under load:** 1 post ID × 15 copies → all 15 land within ~30s, no 429s in backend logs.
5. **Invalid ID handling:** 1 invalid ID × 3 copies → 3 failed ads, single grouped error message (not 3 toasts).
6. **Hard cap:** Attempt 11 IDs × 25 copies (275) → frontend blocks submit before request fires.
7. **Cap edge:** 10 IDs × 25 copies (250) → backend accepts, full batch paced over ~5 min, no rate limits.

---

## Out of Scope (Future Work)

- "Spread copies across N ad sets" toggle (Bahiana-style).
- Per-line copy syntax (`postId × 10`).
- Renaming convention customization (e.g., suffix variants beyond `(copy K/N)`).
- Async/background job for >100-ad batches with progress UI.

---

## Files Touched

- `frontend/src/components/AdCreativeStep.jsx` — UI input, state, creatives expansion
- `frontend/src/context/CampaignContext.jsx` — if `existingPostCopies` lives in shared state (decide during implementation; local state is fine if not needed elsewhere)
- `backend/app/api/v1/facebook.py` — pacing + validation in batch worker

No DB migrations. No new endpoints. No new dependencies.
