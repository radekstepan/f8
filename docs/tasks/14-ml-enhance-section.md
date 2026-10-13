# Task 14: ML Enhance section in the Adjust sidebar

## What changed
- The Adjust sidebar top (previously a loose mix of a raw Auto Enhance
  label + toggle switch, a raw Scene Enhance row, and two full-width
  secondary buttons for Enhance Faces / Brighten Subject Only) is now:
  - One classic **Auto Enhance** slim toggle-button (`is-active` +
    `aria-pressed` when the classic mode is on). Clicking it still calls
    the same `onAuto` handler, which already toggles, so the old label
    button + switch pair collapsed into a single control with no
    behavior change.
  - One collapsible **ML Enhance** `AdjustmentSection` (Sparkles icon +
    ML badge in the heading) grouping Scene Enhance, Enhance Faces, and
    Brighten Subject Only, separated by hairline dividers.
- Every ML action button is now the 27px `slim-button` established for
  the Repair ML sections (task 11): Scene Enhance detect, Enhance Faces
  detect/apply, Brighten detect/apply. Added a `.slim-button.is-active`
  pressed state so the two mutually exclusive enhance modes (classic vs
  scene, see `useEditor`) show which one is on.
- The face/selective controls lost their top-level padding/borders when
  nested inside the section (`.ml-enhance` overrides); all `data-testid`
  hooks and handlers are unchanged, so the scene/face/selective tests
  pass unmodified.

## Decisions
- Classic Auto Enhance stays outside the ML section: the codebase never
  presents classic results as ML, so a non-ML action must not live
  under an "ML Enhance" heading.
- "Toggleable" is the standard section disclosure (collapse/expand),
  not a header on/off switch: the three grouped actions are
  independent flows (scene is a mode toggle, faces/subject are
  detect-then-apply), so one master switch would be ambiguous.
- Faces progress/toggle UX and Brighten live-preview UX are left for
  tasks 15/16; this task only regroups and unifies the buttons.

## Tests
- New `packages/ui/src/components/mlEnhanceSection.test.tsx` (6 tests):
  section grouping/order/badge, omission without assists, lone-assist
  rendering, classic slim toggle with no switch, exactly-one pressed
  mode, slim-only buttons.
- `yarn workspace @f8/ui test`: 132/132 pass. `yarn typecheck`: 6/6 ok.
