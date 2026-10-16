---
'@f8/core': patch
'@f8/ui': patch
---

Clicking the global Auto Enhance button now highlights the White Balance, Lightness, and Hue & Saturation Auto buttons it drove, matching their reset icons. Each section also gets its own revert to the pre-enhance values, so one section can be peeled back without losing the rest of the enhance.

## Task writeup (docs/tasks/31-global-auto-highlight.md)

## Request

"There is a bug where on a photo if I click the global Auto button next to
Color Adjustments, adjustments like White Balance, Lightness etc show a
reset icon (correct), but the "Auto" button is not highlighted. We turned
these on, so show them highlighted."

## Root cause

The global Auto (whole-photo enhance, classic + scene) and the per-section
Autos share one persisted action stack (`ActionStack` in
`packages/core/src/actionStack.ts`), but the enhance apply only pushed its
own `enhance` entry — after explicitly dropping every per-category entry
via `clearMl`. The section resets still showed because the enhance had
moved the sliders off their defaults (`dirty`), while the Auto pills
stayed dark because no per-category entry existed (`mlApplied` empty).
Highlight and reset disagreed about the same apply.

## What changed

- New core transition `pushEnhanceAction(stack, mode, edit, appliedAt)`
  (`packages/core/src/actionStack.ts`, exported through the `@f8/core`
  barrel): it drops stale per-category entries (the enhance overwrites
  their values), then pushes the enhance entry plus one pure entry each
  for White Balance, Lightness, and Hue & Saturation — both the classic
  and the scene patch write all three — all snapshotting the same
  pre-enhance recipe with one timestamp.
- `useEditor.runEnhance` (`packages/ui/src/hooks/useEditor.ts`) now
  routes through that transition. The old `clearMl` call is replaced by
  `invalidateMlRuns` (split out of `clearMl`): in-flight per-category
  async applies are still cancelled — the enhance overwrites their
  values — while the stack entries are pushed instead of dropped.
- No Inspector change was needed: `mlApplied`/`mlRevert` already drive
  the pills and resets, so all three sections now highlight their Auto
  and offer their own revert once an enhance lands. Labels untouched
  (Auto pills, per the task-29 audit).

Resulting behavior: after global Auto, all three per-section Autos glow
with the header Auto, each with its own revert to the pre-enhance
values; clicking a lit per-section Auto peels just that section back
(the enhance highlight drops with it through the normal manual-edit
path, the whole-photo revert stays); enhance revert still restores the
full pre-enhance look and drops the category entries with it. The stack
persists with the recipe, so the highlights and reverts survive reload.

## Decisions

- Real stack entries, not a derived highlight: deriving `mlApplied`
  from enhance-pure state would have lit buttons whose toggle contract
  ("highlighted = click to revert") had no snapshot to honor. Entries
  keep one mechanism — highlight ⟺ pure entry ⟺ revert available.
- Fresh category snapshots per enhance (not earliest-wins): a category
  auto from *before* the enhance snapshots older values than the
  enhance base, so reusing it would make a per-section revert undo more
  than the enhance did. The enhance entry itself keeps earliest-wins,
  so whole-photo revert always returns to the un-enhanced recipe while
  per-section reverts undo the latest enhance only.
- Per-section reset routing changes as a consequence: after an enhance,
  a section reset now restores the pre-enhance values (a snapshot
  exists) instead of the slider defaults. This is the established
  `AdjustmentSection` contract and the more useful target.
- Scene enhance's `vibrance` is not covered by the color revert:
  `ML_CATEGORY_KEYS.color` owns only `saturation`, so a color revert
  after scene enhance leaves vibrance at its enhanced value (the
  whole-photo revert still restores everything). Extending the category
  keys would also change manual-edit de-highlighting — out of scope
  for this fix, flagged for the task-11 toggle conversion.
- No README change: bug fix, no architecture change. One clause added
  to `docs/features.md` (Boundaries) so the documented enhance
  behavior matches.
- Changeset is `patch` for `@f8/core` + `@f8/ui`, hand-written in the
  CLI's exact format: `yarn changeset` needs an interactive TTY for
  package selection, which this session has not (same as tasks 25–29).

## Verification

- New `pushEnhanceAction` suite in
  `packages/core/src/actionStack.test.ts`: enhance + three pure
  entries with same-base snapshots, stale-entry replacement,
  re-apply snapshot semantics, single-section revert keeping the
  others lit.
- New `packages/ui/src/components/globalAutoHighlight.test.tsx`: SSR
  pins the all-lit header + three `is-active` Auto pills with
  revert tooltips and one reset per section after an enhance, and
  pins the `runEnhance → pushEnhanceAction` + `invalidateMlRuns`
  wiring from the `useEditor` source.
- `yarn test`: core 1005, server 180, UI 547 — all pass. `yarn
  typecheck`, `yarn lint`, `yarn build` green. No Playwright, per
  the task rules.
