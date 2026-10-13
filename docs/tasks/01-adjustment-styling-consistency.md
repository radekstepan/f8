# Task 1: Adjustment styling consistency

Six complaints, one theme: every adjustment header/content pair should follow
the same contract, and every label should name what actually runs.

## What changed

1. **Honest header labels: heuristics say Auto, model runs say ML.**
   White Balance, Lightness, and Hue & Saturation carried "ML" buttons whose
   actions are pure histogram heuristics (`computeWhiteBalanceAuto` /
   `computeLightnessAuto` / `computeColorAuto` in `packages/core/src/vision/
   enhance.ts` — gray-world gains, percentile endpoints, no model import).
   The Denoise header button likewise only drafts an ISO-ladder suggestion.
   All four now render `kind: 'auto'` ("Auto" pill, `-auto` testids, "Apply …
   automatically" tooltips). "ML" remains only where a model runs on click:
   Scene Enhance (logreg classifier), Enhance Faces (YuNet), Subject &
   Background (u2netp), One-Click Removal (YOLO), Dust Spots (classifier).
   The README documented the old misnomer outright ("the ML label marks the
   automatic action, not a neural model") — updated to the new rule.
2. **Collapsing keeps the header action.** `AdjustmentSection` gated the
   ML/Auto button on `open`; it now renders whenever `ml` is set, like the
   reset. Collapsing hides sliders, never header controls — which also
   strengthens the collapse-panels invariant (header byte-identical open vs
   collapsed, modulo chevron + aria).
3. **One tight note rhythm.** `.inspector-note` was `margin: 18px 0 9px`
   while five sections overrode it to `8px 0 0` — so Auto Enhance's
   "Automatically enhance exposure…" floated in padding its siblings never
   had. Base is now `8px 0 0` and the five overrides are deleted
   (object-removal, face-enhance, selective-mask, denoise, superres-field).
   `.ml-progress .inspector-note` keeps its own flush `0 0 2px`.
   The Black & White apply button follows its note directly, so it brings
   its own `margin-top: 10px` (new `.adjustment-content > .secondary-button`
   rule — B&W is the only `.secondary-button` in adjustment content).
4. **Reset never hides.** Two causes: a `@media (max-width: 850px)` rule set
   `.section-reset { display: none; }` (re-shown at 760px, so the reset
   vanished in the 761–850px band), and Black & White had no reset at all.
   Both media rules are deleted (the 760px re-show was provably redundant
   once the hide went: flex items blockify, so `flex` == base `inline-flex`
   there), and B&W gains `onReset` → `{ blackAndWhite: false }` with
   `dirty={edit.blackAndWhite}`.
5. **Header toggles retired.** Black & White was the last `AdjustmentSection`
   `onToggle` consumer, and its switch duplicated the content button while
   offering no reset — the "is it On or reset to defaults?" confusion.
   The header toggle is gone (props `enabled`/`onToggle`/`toggleLabel`
   removed, `.section-actions .toggle*` CSS deleted with them): B&W keeps
   its explicit "Make Black & White" / "Restore Color" button plus the new
   header reset. Switches remain only where they mean bypass-without-
   deleting (faces, subject rows, each paired with Clear) or a plain
   setting (seamless light).

## Decisions

- **Internal `ml*` names stay.** `MlCategory`, `mlApplied`/`mlRevert`,
  the `ml` prop, and the `AdjustmentMl` interface still say "ml" even for
  Auto sections. Renaming that machinery through `useEditor`, `App`, core,
  and a dozen test files is high risk for zero user-visible gain; the
  user-visible label is what the task asked about. The `kind` doc comment
  now states the rule ("'ml' when a model runs, 'auto' for heuristics").
- **No revert-vs-reset label split.** The single header icon still restores
  the pre-auto snapshot while one lives, else defaults (Tasks 3/8
  convergence kept; existing `Reset {section}` pins untouched).
- **Faces/selective bypass pins kept.** The header highlight deliberately
  means "stored", the content toggle means "enabled" (explicitly pinned
  with rationale) — untouched.
- **Repair-tool sections get no resets.** Brush size/strength and
  reconstruction settings are tool prefs, not photo edits; out of scope.
- **Tests:** updated `adjustmentMl` (Auto pills, visible-when-collapsed,
  retired-toggle source pins), `denoise` (header Auto, base rhythm pin),
  `mlSections` (denoise Auto split out), `detailsToggle` (B&W reset wiring
  source pins — the section needs client state so it can't SSR),
  `collapsePanels` (actions row byte-identical open/collapsed);
  added `adjustmentConsistency.test.tsx` (6 tests: engine-honest labels
  across adjust + repair, collapsed action, one note rhythm, no reset
  hiding, no header switches, B&W default tie).

## Verification

- `yarn workspace @f8/ui test`: 36 files, 289 tests, all pass.
- `yarn workspace @f8/ui typecheck`: clean.
- Playwright not run (per brief); e2e specs don't reference the changed
  testids/labels (only `.straighten-auto`, untouched).
