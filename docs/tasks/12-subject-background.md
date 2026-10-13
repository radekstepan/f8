# Task 12: Explode ML enhance actions into their own sections

## What changed

The single "ML Enhance" inspector section (Scene + Faces + Subject /
Background + Denoise stacked in one collapsible panel) is exploded into
four own `AdjustmentSection` panels — the shared collapse component from
Task 9 — sitting above the histogram in the same order as before:

- **Scene Enhance** (Sparkles icon) — unchanged single-button toggle
  plus the detected-scene label.
- **Enhance Faces** (ScanFace icon) — unchanged detect → apply flow
  with its badge, bypass toggle, rescan, and clear.
- **Subject & Background** (Layers icon) — reworked (below).
- **Denoise** (Waves icon) — unchanged except its inner "Denoise"
  heading is gone; the section header carries the title + ML badge now.

Every section header carries an ML badge, like the Repair tool's
One-Click Removal / Dust Spots sections. The `.ml-enhance` wrapper div,
its sibling-spacing rule (the Task 10 divider fix — obsolete with the
wrapper gone), the face/subject standalone padding + bottom border, and
the `.denoise-head` rule are deleted from `apps/web/src/index.css`;
each section is now divided by the shared `AdjustmentSection` divider.

Subject & Background specifically:

- The section title stays visible in every state (idle, detecting,
  sliders), so the Detect button coming and going no longer strands the
  sliders without a visible group.
- The golden applied-settings summary line (`selective-mask-applied`,
  e.g. `Subject (+0.5 EV · C +10) · ML`) is deleted — the sliders
  themselves show the values. The transient "Subject 23% — applying to
  photo…" note during detection stays; it is status, not a settings
  repeat.
- A bypass toggle (`Enable subject and background enhance`) sits next
  to Rescan / Clear above the slider groups: one click turns the effect
  off, one click restores it, mask and slider values untouched. This
  mirrors face enhance's toggle exactly, including the new
  `SelectiveMaskAssist.onToggle` callback and an `enabled?: boolean`
  recipe flag on `SelectiveAdjustState` (absent/true = on, so legacy
  recipes stay active). `normalizeSelectiveAdjust` preserves the flag
  and `isSelectiveAdjustActive` honors it, so the render pass and
  `isNeutralEdit` bypass a toggled-off adjust with no pipeline edits.

## Decisions

- **One "Subject & Background" section, not two.** Subject and
  Background share one mask and one detect/rescan/clear lifecycle;
  splitting them into separate sections would duplicate (or strand)
  that lifecycle. The "individual ML actions" that got exploded are
  Scene / Faces / Subject&Background / Denoise.
- **Face badge and scene label stay.** They are not redundant: faces
  have no sliders (the badge answers "did it work?"), and the scene
  label shows detected scene + confidence shown nowhere else. Only the
  selective line repeated slider values.
- **Inner Detect buttons keep their ML badges.** The header badge marks
  the section, the button badge marks the action — removing the latter
  is churn with no user ask.
- **No Task-1 header ML button + revert icon on these sections.** That
  pattern fits categories where ML computes slider values with a
  snapshot to restore (WB/Lightness/Color). Detect-style actions
  already follow the Task-2 single-button pattern (button highlights,
  click again reverts), and adding a header ML button next to a toggle
  would build exactly the toggle-plus-button combo Task 13 is about to
  redesign. The toggle went inside the content (denoise-Auto /
  seamless-light precedent), not the header, for the same reason:
  Task 1 reserves header toggles for visibility (B&W excepted, and
  selective has sliders, so the exception does not apply).
- **Rescan stores a fresh mask with the toggle back on**, same as face
  enhance's apply replacing the stored adjust — a rescan while toggled
  off otherwise looks like a no-op.
- **No README update.** The ML Subject & Background paragraph stays
  accurate (own section, ML badge, live dual-side sliders); this is a
  UI regroup plus one flag mirroring face enhance — no architecture or
  feature change.

## Tests

Expectation changes (all justified by the redesign, not by failures):

- `mlEnhanceSection.test.tsx` → renamed to `mlSections.test.tsx` and
  rewritten: four titled sections with header ML badges, each control
  inside its own section in order above the histogram, lone-assist
  isolation, no `ML Enhance` heading / `ml-enhance` testid anywhere,
  no `.ml-enhance` / `.face-enhance` / `.selective-mask` /
  `.denoise-head` CSS rules left, shared divider intact. Classic
  Auto Enhance + scene-pressed + slim-button tests kept.
- `selectiveMask.test.tsx`: golden-badge tests replaced by toggle-row
  tests (on/off `aria-checked`, sliders + rescan/clear survive off),
  a golden-line-absence test, and a persistent-title test.
- `denoise.test.tsx`: grouping test inverted (own `Denoise` section,
  no inner head). `faceEnhance` / `sceneEnhance` suites: +1
  persistent-title test each.
- `selective-mask.test.ts` (core, +3): normalize preserves `enabled`
  / legacy defaults on; active honors the toggle; toggled-off edit is
  neutral and renders pixels unchanged.

## Verification

- `yarn workspace @f8/ui test` — 179 passed (25 files).
- `yarn workspace @f8/core test` — 801 passed.
- `typecheck` clean for `@f8/core`, `@f8/ui`, `@f8/web` (rebuilt
  core/ui `dist`, which typechecks resolve against).
- Playwright not run (per task rules).
