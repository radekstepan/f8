# Task 7: Scene Enhance ML stays enabled across reload

## Symptom

Apply Scene Enhance, reload the UI: the section still shows the persisted
scene label (`Night · 90%`), but the header ML button renders idle instead
of enabled. Same for classic Auto Enhance (its `autoEnhanced` flag also
persists while its highlight does not).

## Root cause

The enhance highlight (`enhanceUiByPhoto`: mode + pure) in
`packages/ui/src/hooks/useEditor.ts` was session-only `useState`,
initialized empty. The server seed restores the recipe — including the
`sceneEnhance` / `autoEnhanced` bookkeeping flags — but nothing restored
the highlight, so `Inspector` derived `sceneActive = false` from the null
mode. The scene label survived because `SceneEnhanceControl` reads the
persisted `edit.sceneEnhance` directly.

## Fix

- `packages/core/src/data.ts`
  - New `enhanceModeForRecipe(present)`: stored scene → `'scene'`,
    auto flag alone → `'classic'`, else `null`. Both flags are look
    bookkeeping (label-only), so the highlight can reseed from them.
- `packages/ui/src/hooks/useEditor.ts`
  - New `seedEnhanceUi(seed)` maps every seeded recipe through the
    helper (`{ mode, pure: true }`). Applied in the `useState`
    initializer (synchronous seed) and in the seed effect (async
    arrival, same wholesale replace as `setHistories`).
  - `runEnhance` toggles a highlighted mode back only while its
    pre-enhance snapshot exists. A reload-seeded highlight has none, so
    clicking it falls through to a fresh apply (snapshotting the current
    recipe first) instead of a flag-only revert that would leave
    enhanced values behind while claiming idle.
  - New `enhanceCanRevert` return: mode set AND snapshot present. Every
    snapshot write rides with an `enhanceUi` setState, so the ref read
    is fresh on each render.
- `packages/ui/src/components/Inspector.tsx`
  - New optional `enhanceCanRevert` prop (default: mode presence, which
    preserves the in-session "mode implies snapshot" contract). The
    revert icon / dirty state now need the snapshot signal, so after a
    reload the ML shows enabled with no reset icon promising a value
    restore it cannot perform.
- `packages/ui/src/components/AdjustmentSection.tsx`
  - Applied-without-snapshot tooltips no longer promise a revert:
    `ML scene enhance applied — click to re-apply`
    (`Auto Enhance applied — click to re-apply` for kind `auto`). Only
    reload-seeded enhance reaches this combo: denoise overrides its
    title, faces/subject tie applied to canRevert, and the WB/lightness/
    color flags keep an applied→revert invariant.
- `apps/web/src/App.tsx` — passes `editor.enhanceCanRevert` through.
- `packages/core/src/types.ts` — `sceneEnhance` doc updated: the
  highlight seeds from persisted flags on reload; only the revert
  snapshot stays session-only.

Scope notes (deliberately unchanged):

- Per-category ML (white balance / lightness / color) highlights stay
  session-only — the task names Scene Enhance only, and those sections
  have no persisted applied flag to reseed from.
- The revert snapshot itself is not persisted (server schema change);
  after a reload there is intentionally no per-section revert — Reset
  All Adjustments remains the way back.
- In-session semantics untouched: manual look edits still drop `pure`
  while keeping the snapshot revert; seeded entries behave the same
  from the first manual edit on.

## Tests

- `packages/core/src/data.test.ts`
  - New `enhanceModeForRecipe` block: scene wins with/without the auto
    flag, auto flag alone → classic, default/reverted/tweaked → null.
- `packages/ui/src/components/sceneEnhance.test.tsx`
  - New `scene enhance reload` block. An SSR probe pins the hook's
    synchronous seed path (initializers run, effects do not): scene
    seed → `scene/true/false`, classic seed → `classic/true/false`,
    default recipe and unknown photo → no mode. Plus the reload markup
    contract: persisted scene + seeded highlight + `canRevert: false`
    renders ML `is-active`/`aria-pressed`, the scene badge, the
    re-apply tooltip, and no reset icon.
- `packages/ui/src/components/autoEnhance.test.tsx`
  - Classic reload case: seeded classic highlight without a snapshot
    renders Auto `is-active`, the re-apply tooltip, and no reset icon.

## Verification

- `yarn workspace @f8/core test` — 47 files / 815 tests pass.
- `yarn workspace @f8/ui test` — 30 files / 251 tests pass.
- `yarn workspace @f8/core typecheck`, `@f8/ui typecheck`,
  `@f8/web typecheck` (after `@f8/ui build` — web resolves ui from
  dist) — clean.
- `lint` scripts are no-ops (`(no lint configured)`) in all three
  workspaces, same as before.
- Playwright not run (per task rules).
