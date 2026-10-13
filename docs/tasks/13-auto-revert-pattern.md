# Task 13: Unify the Auto highlight + revert pattern

## What changed

Every adjustment action with an Auto/ML button now follows one pattern:
the button highlights only while the photo holds exactly the automatic
values, a revert icon sits beside it while a pre-auto snapshot exists,
and manual edits drop the highlight but keep the revert.

- **White Balance, Lightness, Hue & Saturation** (the Task 1 ML
  buttons): the header visibility toggle is gone — the ML button is the
  one header control and the disclosure chevron alone collapses the
  section. The single `applied` flag split into highlight (`mlApplied`,
  pure auto values) and revert availability (`mlRevert`, snapshot
  exists). Any manual `change()` touching the category's owned keys
  (via the new `touchedMlCategories` core helper) clears the highlight;
  the snapshot stays. Clicking an idle or touched ML button applies
  fresh values while keeping the earliest snapshot, so revert always
  returns to pre-ML; clicking a highlighted button reverts (Task 1
  click-again behavior preserved). Touched buttons read "Re-apply
  automatic … with ML".
- **Auto Enhance + Scene Enhance**: same split. New per-photo session
  state `{ mode, pure }` drives the highlight; the persisted
  `autoEnhanced`/`sceneEnhance` recipe flags are no longer read for it.
  A revert icon sits beside the last-used mode's button (new
  `.scene-enhance-row`, `.classic-enhance` flex rows). Any look change
  (new `patchBreaksEnhancePure` core helper: everything except
  geometry/retouch/label keys) clears the highlight; crop, rotate,
  straighten, and retouching leave it alone. The toolbar Enhance dot
  follows the highlight. Enhance also gains the run-token guard the ML
  categories already had, so a revert or mode switch mid-decode cancels
  the in-flight apply. An enhance revert clears the per-category ML
  state too (its snapshots reference enhance-era values).
- **Auto straighten**: the pre-Auto snapshot moved from the control's
  local state into the `useStraighten` hook, so it survives manual
  dismisses (slider, 90° rotate) and tool switches, and a revert icon
  (`straighten-auto-revert`) shows beside the Auto pill whenever a
  snapshot exists. Failed and below-threshold runs drop the snapshot
  (nothing applied, no revert owed); photo switches still clear it.

Untouched by design (no Auto-apply-then-tweak flow, no toggle+button
pair): Details keeps its visibility toggle (no automatic action);
Black & White keeps its effect toggle (the Task 1 exception); face and
subject enhance keep their in-content bypass toggles with Rescan/Clear
(detect-style actions, per the Task 12 decision); denoise keeps its
single Auto-strength toggle (a mode, not an apply); one-click removal
and dust spots are review-then-apply with no sliders to unhighlight.

## Decisions

- **Highlight tracks owned keys, not whole sections.** Brightness,
  blacks, vibrance, and hue have sliders in ML sections but are never
  auto-computed, so dragging them keeps the highlight — the highlight
  claims exactly what the revert restores (Task 1's ownership tables,
  reused rather than duplicated). Enhance is whole-photo (it resets the
  full look to its computed base), so any look change clears it.
- **Earliest snapshot wins.** Re-applying after manual edits keeps the
  original pre-auto snapshot; revert always returns to before the auto
  episode, never to a mid-tweak state. This mirrors the existing
  enhance mode-switch behavior.
- **Auto-computed patches bypass highlight clearing** via a synchronous
  guard ref around the `change()` call; a category ML apply explicitly
  clears only the enhance highlight (whole-photo purity is broken, its
  revert stays). Reverts go through the normal unguarded path, so they
  also drop stale highlights.
- **Undo/redo still desync session flags** (the Task 1 tradeoff, now
  documented for enhance too): values move, flags stay, and the next
  click does the safe thing. Clearing on undo would equally misfire
  (undo back to pure-auto values would drop a true highlight).
- **Reload with an enhanced recipe no longer risks a DEFAULT_EDIT
  wipe.** The old revert branch keyed on the persisted `autoEnhanced`
  flag and fell back to `DEFAULT_EDIT` when the session snapshot was
  gone; the new apply branch snapshots the current recipe and
  re-applies idempotically. The persisted scene badge still shows after
  reload (it is recipe context, not highlight state).
- **No README update.** UX unification only — no architecture or feature
  change, and every README sentence about toggles, ML buttons, and the
  Enhance shortcut stays accurate.

## Files

- `packages/core/src/mlCategories.ts`: `touchedMlCategories` helper.
- `packages/core/src/data.ts`: `patchBreaksEnhancePure` helper.
- `packages/core/src/types.ts`: scene-badge comment fix.
- `packages/ui/src/hooks/useEditor.ts`: highlight/revert split for ML
  categories (`mlRevert`) and enhance (`enhanceMode`/`enhancePure`),
  manual-edit clearing in `change()`, run-token guard for enhance,
  `revertEnhance` + per-category reverts, `clearEnhance` on
  reset/preset/paste.
- `packages/ui/src/components/AdjustmentSection.tsx`: `AdjustmentMl`
  gains `canRevert` + `onRevert`; three-way button title.
- `packages/ui/src/components/Inspector.tsx`: ML sections lose their
  header toggles; classic/scene highlight + revert wiring; scene badge
  from persisted `sceneEnhance`; straighten revert icon.
- `apps/web/src/vision/useStraighten.ts`: hook-owned snapshot,
  `detect(src, value)`, `dismiss` keeps it, `revert()` clears it.
- `apps/web/src/App.tsx`: new props through; toolbar dot follows
  `enhancePure`.
- `apps/web/src/index.css`: flex rows for the enhance buttons +
  revert icons.
- Tests: `mlCategories.test.ts` (+4), `data.test.ts` (+3),
  `adjustmentMl.test.tsx` (touched states, no ML-section toggles),
  `mlSections.test.tsx` (mode/pure derivation, revert icons, row CSS),
  `straightenToggle.test.tsx` (snapshot-driven revert icon),
  `sceneEnhance.test.tsx` (persisted badge), revert-handler noops in
  all 12 Inspector suites.

## Verification

- `yarn workspace @f8/core test` — 47 files / 808 tests pass.
- `yarn workspace @f8/ui test` — 25 files / 186 tests pass.
- `typecheck` clean for `@f8/core`, `@f8/ui`, `@f8/web` (rebuilt
  core/ui `dist`, which typechecks resolve against).
- Playwright not run (per task rules); the e2e straighten spec only
  pins the kept `.straighten-auto` pill class.
