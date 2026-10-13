# Task 4: Reloaded Auto enhance reopens idle instead of enabled-without-a-reset

Task: If I apply Auto adjustments and reload the UI, the button is
enabled, but there is no reset button anymore.

## What changed

- `packages/ui/src/hooks/useEditor.ts`
  - Removed `seedEnhanceUi`: enhance highlights are no longer restored
    from the persisted recipe on load. The hook's `enhanceUiByPhoto`
    starts empty and the seed effect only restores recipes, so a
    reloaded photo reopens with both enhance buttons idle
    (`enhanceMode: null`, `enhancePure: false`,
    `enhanceCanRevert: false`).
  - The persisted recipe is untouched: the auto flag, the stored
    values, and the scene badge all survive the reload. Only the
    highlight — which promised a revert the session cannot deliver,
    since the pre-enhance snapshot is session-only — is gone.
  - Updated the `enhanceUiByPhoto`, seed-effect, and `runEnhance`
    comments that described the seeded-highlight behavior.
- `packages/core/src/data.ts`
  - Removed `enhanceModeForRecipe`: its sole caller was the deleted
    seed helper, so it is dead code after this fix.
- `packages/core/src/data.test.ts`
  - Removed the `enhanceModeForRecipe` describe block with it.
- `packages/ui/src/components/Inspector.tsx`
  - Comment-only: the `enhanceCanRevert` doc no longer describes the
    retired "highlight stays, revert hides" reload state. No rendering
    logic changed — the header Auto and scene ML still highlight with
    a reset beside them for in-session applies, and keep the reset
    after manual edits clear the highlight.
- `packages/ui/src/components/sceneEnhance.test.tsx`
  - The `scene enhance reload` block now pins the fixed behavior: a
    persisted scene / auto flag seeds `mode: none`, the reloaded ML
    button renders idle with the plain apply tooltip and no reset
    while the scene badge persists, and a new test pins that reloaded
    enhance values still offer per-section resets (`Reset lightness`,
    `Reset details`).
- `packages/ui/src/components/autoEnhance.test.tsx`
  - The reload test now pins the header Auto idle with the apply
    tooltip, no `Reset auto enhance`, and a surviving per-section
    reset.

No README update: behavior fix, no architecture change.

## Decisions

- **Dropped the stale highlight instead of restoring a post-reload
  reset.** The revert icon promises "restore my exact pre-Auto
  recipe", and that snapshot cannot be reconstructed after a reload.
  A reload reset that merely cleared flags would leave values behind;
  one that reset to defaults could destroy manual edits made before
  Auto. The toolbar reset-to-original and the per-section resets
  already cover "undo these values", so the honest minimal fix is to
  stop presenting the button as enabled. Clicking Auto after a reload
  snapshots the current recipe and applies fresh, with a working
  revert from then on.
- **Removed `enhanceModeForRecipe` rather than leaving it exported.**
  It existed only to seed the highlight; keeping a tested-but-unused
  helper would invite the next reader to reintroduce the bug.
- **Updated tests that pinned the buggy state.** The old reload tests
  asserted the exact reported behavior (enabled + no reset) as
  intentional. The task explicitly invalidates that contract, so the
  assertions were rewritten to the fixed behavior rather than worked
  around; the in-session highlight/revert tests are untouched and
  still pass verbatim.

## Verification

- `yarn workspace @f8/ui test`: 354/354 pass (46 files).
- `yarn workspace @f8/core test`: 841/841 pass (49 files).
- `tsc --noEmit` in `packages/ui` and `packages/core`: clean.

## Learnings

- A highlight that implies an available action must share that
  action's lifetime: persisting the "applied" flag while the revert
  snapshot stayed session-only split one UI state across two
  lifetimes and stranded the button. When session-only state backs a
  control, the control's persisted half must reopen idle.
- A test pinning buggy behavior as intentional (with comments
  rationalizing it) still has to change when the behavior is reported
  as a bug — but say so explicitly in the writeup and keep every
  neighboring in-session assertion verbatim to show the blast radius.
