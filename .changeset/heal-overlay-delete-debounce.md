---
'@f8/web': patch
'@f8/ui': patch
'@f8/core': patch
---

Dragging unrelated sliders (Vignette, Fade) no longer fires repeated DELETE heal-overlay requests: orphaned heal overlays are now purged exactly once per photo instead of being re-deleted on every slider tick.

## Task writeup (docs/tasks/25-heal-overlay-delete.md)

## Request

Noticing calls to `DELETE /api/photos/<id>/heal-overlays/1` while
dragging sliders in Vignette, Fade, and possibly other tools. Asked
for (1) a debounce and (2) an explanation of why a vignette drag
deletes a heal overlay at all. Explain or fix.

## Diagnosis

The DELETEs are real, and they are a bug — not missing debounce.

Every slider tick re-renders the canvas pipeline (`PhotoCanvas`
effect depends on the whole `edit`), and every run sweeps "orphan"
heal overlays: server-side healed patches whose stroke no longer
exists in the edit. The sweep itself is legitimate — it purges
pixels for deleted strokes so the server never keeps stale work.

The photo in the report has a persisted overlay (group 1) but no
live repair stroke for it (heal → delete stroke / reset leaves the
server file behind until the next sweep). Steady state should be:
first paint purges it once, then silence. Instead each tick did:

1. `overlayPromise.current.then(...)` — the photo-open overlay
   fetch is a shared, never-cleared promise, so every tick
   re-seeded `overlayStore` from the same stale list;
2. `sweepOrphanOverlays(empty live set)` — immediately evicted the
   re-seeded entries and fired DELETE for each.

Reseed-then-sweep per tick = one DELETE per slider tick, forever
(the promise still resolves the old list after the server file is
gone, so the loop never settles). Overlapping runs in the repairs
branch had the same flaw: all runs merge one shared fetched list,
so a second run could resurrect and re-delete an id the first run
had just purged.

On the debounce half of the request: slider persistence is already
debounced — `useEditor.schedulePersist` coalesces ticks into one
`PUT /api/photos/<id>/edit` 500ms after the drag settles
(`packages/ui/src/hooks/useEditor.ts`), and `saveEdit` only runs
from there. The heal-overlay PUTs only fire on geometry changes
(rotate/straighten), never on Vignette/Fade. So no timer was
missing; the DELETE spam was purely the reseed loop.

## Change

- `packages/core/src/vision/heal-cache.ts`: two new pure helpers
  next to the other overlay helpers —
  `mergeFetchedHealOverlays(fetched, session, purged)` (session
  entries win per group; already-purged ids are dropped so a stale
  shared fetch can never resurrect them) and
  `planHealOrphanSweep(store, live, purged)` (splits the store into
  entries to keep vs ids to DELETE; purged ids are evicted locally
  without re-firing). Both are re-exported through `@f8/core`.
- `packages/ui/src/components/PhotoCanvas.tsx`:
  - New `purgedOverlayIds` ref (cleared on photo change): each
    overlay id is DELETEed at most once per photo.
  - Effect and queue sweeps go through the planner; merges go
    through the filtered merge.
  - The zero-repairs branch consumes the photo-open fetch one
    shot per photo (ref cleared on settle; the promise object is
    captured so a run cancelled before settle still leaves every
    waiter holding the data).
  - The repairs-branch sweep is guarded to the current
    generation, so a stale run can't purge with a predated live
    set.
  - Fresh PUT paths (re-persist, drift persist, group done)
    re-arm their id, since undo can restore a swept stroke.
- `packages/core/src/vision/heal-cache.test.ts`: five tests for
  the merge + planner, including the regression (repeat sweep
  after a stale-fetch replay issues no DELETE).

Net behavior: dragging Vignette/Fade now issues zero
heal-overlay requests in steady state; a genuine orphan is still
purged exactly once.

## Decisions

- **Change-gating instead of a timer debounce.** Delaying the
  sweep would only postpone the spam; making it idempotent
  (purge each orphan once, never resurrect) removes it. No new
  timers, so no unmount/photo-change flush paths to get wrong.
- **Helpers in `heal-cache.ts`, not component state tests.**
  Component tests here render statically (no effects), so the
  sweep decision logic moved into pure, unit-testable core
  functions following the file's existing idiom.
- **Left as-is:** the explicit reset purge in `App.tsx` still
  overlaps the canvas sweep by one idempotent DELETE on reset
  (pre-existing, harmless); LRU cache evictions stay memory-only
  by design.

## Verification

- `yarn workspace @f8/core build`, `test` — 963 passed (55
  files), including the 5 new merge/planner tests (confirmed via
  `-t` filters: 3 + 2 pass).
- `yarn workspace @f8/ui typecheck` — clean; `build`, `test` —
  534 passed (67 files).
- `yarn workspace @f8/server test` — 180 passed (untouched area,
  sanity only).
- Playwright not run per task rules.
