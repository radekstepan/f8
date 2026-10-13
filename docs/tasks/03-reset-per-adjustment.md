# 03 — Persistent per-adjustment reset; Revert folded into Reset

## Request
"Each adjustment should have a 'reset' button when we are not default.
Right now it only shows onhover in the header. And remove the 'Revert'
button. Reset does the same thing."

## Previous state
Each adjustment header rendered one of two controls left of the ML/Auto
button (`packages/ui/src/components/AdjustmentSection.tsx`): a gold
`RevertButton` (Undo2 icon, `*-ml-revert` / `*-auto-revert` test ids) while
a pre-apply snapshot lived, otherwise a grey reset `IconButton`
(RotateCcw, `aria-label="Reset …"`). The reset was hover-only in all
states (`.section-reset { opacity: 0 }`, revealed by
`.adjustment-heading:hover`), so a non-default section looked identical
to a default one until hovered. Sections with an ML action but no
sliders (Auto/Scene Enhance, Enhance Faces, Subject & Background) had no
reset at all — only the revert icon while applied.

## Change
- `packages/ui/src/components/AdjustmentSection.tsx`
  - The header now renders a single reset control whenever `onReset` is
    set. The `RevertButton` import, the `showRevert` branch, and the
    `-ml-revert` / `-auto-revert` test ids are gone from adjustment
    headers.
  - Click routing preserves both behaviors: while `ml.canRevert` the
    reset restores the pre-apply snapshot (`ml.onRevert`), otherwise it
    runs `onReset` (defaults). This matches the header comment, which
    already described one control doing both.
  - New `dirty` prop. The reset carries `is-dirty` while `dirty` or a
    snapshot lives (persistent), and renders hover-only at defaults.
    Rendering still ignores collapse state, so a dirty section shows
    its reset without expanding.
- `packages/ui/src/components/Inspector.tsx`
  - White Balance / Lightness / Hue & Saturation / Curves / Effects pass
    `dirty` computed from the same keys their `onReset` restores
    (temperature≠5500, tint/exposure/…≠0, curve/vignette/fade≠0).
    Legacy-disabled categories at default values count as clean: the
    enabled flag flips back on the first drag, so values alone decide.
  - Auto Enhance, Scene Enhance, Enhance Faces, Subject & Background
    gain `onReset` (their revert/clear handler) exactly while a
    snapshot/stored result exists, plus matching `dirty` — reset iff
    non-default, nothing to hover-tease at defaults.
  - Details and Denoise intentionally gain no header reset here: Details
    is Task 12, Denoise keeps its content-level Clear/Restore flows
    until its header rework (Tasks 4/9).
  - `RevertButton` stays for the crop-tool auto-straighten row only.
- `apps/web/src/index.css`
  - New standalone `.section-reset.is-dirty { opacity: 1; }` rule (kept
    separate for the `cssRule(selector)` test helper). The hover-only
    base and the `:hover` / `:focus-visible` reveal are untouched, so
    clean slider sections still reveal their reset on hover until
    Task 10 retires that.

## Tests
- New `packages/ui/src/components/resetPerAdjustment.test.tsx` (repo
  convention: server-rendered, no jsdom + CSS rule pinning):
  - hover-only reset on all five slider sections at defaults;
  - a 14-key dirty matrix pinning that each key persists exactly its
    own section's reset;
  - legacy-disabled-at-defaults counts as clean;
  - dirty reset stays in the header while collapsed;
  - a snapshots-everywhere sweep asserting no `ml-revert`,
    `-ml-revert"`, `-auto-revert"`, or `Revert` aria-label remains in
    the adjust tool;
  - Details/Denoise pinned without header resets (Tasks 12 / 4+9);
  - CSS contract: 14×19 box, base `opacity: 0`, dirty `opacity: 1`,
    hover reveal intact.
- Updated `adjustmentMl`, `mlSections`, `autoEnhance`, `sceneEnhance`,
  `faceEnhance`, `selectiveMask` tests to the one-reset contract
  (`section-reset is-dirty" title="Reset …"` pairings, per-section
  isolation); `sharedPrimitives` RevertButton example re-pointed at
  its remaining consumer (straighten). Straighten and collapse tests
  untouched and still green.
- Full `@f8/ui` suite (30 files / 238 tests) passes; `@f8/ui` and
  `@f8/web` typechecks pass; lint is an unconfigured no-op echo. No
  Playwright (per task rules); no e2e spec referenced the old revert
  selectors.

## Decisions
- One control, two targets (snapshot-then-defaults) rather than deleting
  revert outright: after manual edits clear the ML highlight, the
  snapshot is the only way back to pre-apply values, and the old header
  comment already specified this routing.
- `dirty` mirrors each section's reset patch keys exactly, so the reset
  can never get stuck on (dirty state its own click cannot clear).
- Enhance/face/subject sections omit `onReset` entirely when clean
  instead of rendering a no-op hover reset — there is no default to
  restore to, only a snapshot to clear.
- Hover-at-defaults kept for slider sections (Task 10 removes it) and
  the grey icon color kept (Task 8 unifies the icon): this task changes
  visibility + control count only.
- No README update: header-control consolidation, no architecture or
  feature-surface change.
