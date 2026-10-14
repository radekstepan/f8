# Task: Subject & Background single header toggle

## Request

Subject & Background have double toggles, keep the one in the header.

## Change

The section carried two switches with split ownership: the header
toggle meant "mask stored" (clicking it destructively cleared the mask
and slider values), while a second toggle inside the content bypassed
or restored the effect. The content toggle is gone; the header switch
now owns on/off end to end:

- `packages/ui/src/components/Inspector.tsx`
  - The `selective-mask` header toggle segments when no mask is stored
    (`onDetect`) and bypasses/restores the stored params while one
    lives (`onToggle`) — the mask and slider values survive either
    way. `checked` reads the recipe's `enabled` flag via new
    `selectiveApplied`/`selectiveOn` consts (the `faceChanged`
    precedent), not just mask presence.
  - Tooltips follow the three states: "Find the subject with ML" when
    empty, "Subject & Background on — click to turn off" when active,
    "Subject & Background off — click to turn on" when bypassed.
  - `SelectiveMaskControl` drops the inner `Toggle`; the applied row
    holds only Rescan/Clear. While bypassed the container takes an
    `is-off` class so the slider groups dim (the Enhance Faces
    `is-off` precedent) and the off state reads at the values.
- `apps/web/src/index.css`: removed the dead
  `.selective-mask-row > .toggle` sizing rule; added
  `.selective-mask.is-off .selective-group { opacity: .45; }`.
- No app-side change: `toggleSelectiveMask` in `App.tsx` already
  bypassed/restored with undo + notifications, it just moves from the
  content switch to the header switch.

## Decisions

- **Header bypasses instead of clearing.** Deleting the inner toggle
  while keeping the old header semantics (toggle-off destroys the
  mask and slider values) would strand the `enabled` bypass feature
  and make off surprising. Toggle-off now bypasses; the labeled Clear
  button stays as the explicit destructive path, mirroring Enhance
  Faces' Clear.
- **Enhance Faces untouched.** It has the same header/content pairing,
  but the task names only Subject & Background — no drive-by
  redesign of the sibling section.
- **Dimming added, not just deletion.** Without the inner switch next
  to the sliders, a bypassed state would look fully active while doing
  nothing; the `.45` dim matches the existing Faces off treatment.
- **No slider-drag re-enable.** Dragging a slider while bypassed still
  only changes the stored value (same as before this change); adding
  auto re-enable would expand App.tsx behavior beyond the task.
- No README update: a control consolidation with no behavior or
  architecture change.

## Tests

- `selectiveMask.test.tsx`: header tooltip updated; applied-state test
  now asserts the header is the only switch; new test pins exactly one
  `role="switch"` in the section; row test rewritten to Rescan/Clear
  only; dead-CSS-rule pin replaced with the `is-off` dim rule pin;
  bypass test rewritten for header ownership (off shows the restore
  hint, sliders/actions stay, container dims).
- `adjustmentConsistency.test.tsx`: the one-switch-per-header test now
  asserts the subject content label is gone (faces keeps its own).
- `autoMlToggle.test.tsx`: the source-level toggle-branch pin updated
  to the bypass wiring (`onToggle` instead of `onClear`) plus the
  `selectiveOn` derivation.
- UI suite: 71 files / 556 tests pass. `typecheck` clean for `@f8/ui`
  and `@f8/web`. No Playwright, per the task rules.
