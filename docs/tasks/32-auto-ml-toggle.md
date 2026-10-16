# Task: Auto/ML header toggles in Color Adjustments

## Request

"Switch the Auto and ML icons in Color Adjustments to a toggle (we should
have it in history or still use it somewhere, it's pretty). Turning the
toggle on will apply suggested changes, toggling off will reset to
defaults. This means we can remove the reset button. Manually tweaking
sliders will turn the toggle on as well. For ML derived tools, just add a
little ML icon/label next to the name of the tool to say it's an "ML"
tool."

## What changed

Every Color Adjustments section with an automatic action now carries one
shared header switch (the existing pretty `Toggle` from `EditorUI.tsx`,
extended with `testId`/`hint`/`disabled` passthroughs) instead of the
Auto/ML button plus the reset icon:

- White Balance, Lightness, Hue & Saturation: the toggle reads dirtiness
  straight from the recipe, so an auto apply lights it and so does any
  hand tweak. Off-to-on runs the auto; on-to-off resets the section to
  defaults.
- Scene Enhance: on while its enhance snapshot lives (pure or
  hand-tweaked past it); off-to-on runs the scene enhance, on-to-off
  reverts the whole enhance. No ML badge (heuristic auto, per the
  task-29 audit).
- Enhance Faces, Subject & Background: on while a result is stored
  (faces: only when faces were actually found); off-to-on runs
  detection/segmentation, on-to-off clears the stored result. Each name
  carries the little `MlBadge` — the only "ML" marking left on these
  tools.
- Denoise: on exactly while a denoise is stored (auto or manual);
  off-to-on drafts the ISO suggestion (Preview + Apply still run the
  photo change), on-to-off clears the stored denoise.

The per-category action-stack machinery is gone with the buttons it
served (the task-29 audit deferred exactly this cleanup to the toggle
conversion): no per-category entries are pushed, `mlApplied`/`mlRevert`
props and `mlAppliedFromStack`/`mlRevertFromStack`/`snapshotMlCategory`
are removed, and `pushEnhanceAction` pushes the enhance entry alone —
the enhance dirties the sections it writes, so their toggles light with
no entries of their own. The sanitizer drops legacy persisted category
entries on load (server round-trip covered). Category auto applies are
apply-only through `runCategoryAuto` (no stack write; the apply runs
unguarded so enhance purity still breaks through the normal manual-edit
path); toggle-off resets go through `resetCategory`, which first bumps
the category run token so an in-flight auto cannot land on the reset
recipe.

## Decisions

- Curves, Details, Effects, and Black & White keep their header resets:
  they have no automatic action, so there is no suggestion for a toggle
  to apply — the task's toggle contract only covers tools with one.
- The whole-photo Auto Enhance pill in the panel header stays a
  pill-plus-revert: it is not a per-tool icon, and its revert restores
  the pre-enhance look (including prior manual work) rather than
  defaults. Same for the Repair tool buttons and straighten Auto —
  different tools, outside the "in Color Adjustments" scope.
- Toggle-off resets to defaults (not to a pre-auto snapshot): the task
  text is explicit, and undo still recovers. The enhance reverts are the
  exception — scene toggle-off restores the pre-enhance snapshot,
  because an enhance is a whole-photo operation sharing one slot with
  classic, and its off-state is the pre-enhance look.
- Denoise toggle-on drafts the suggestion instead of applying: the
  two-step Preview/Apply flow still owns the photo change. The toggle
  also stays disabled while working or with no suggestion and nothing
  stored (it must stay clickable while stored, even suggestion-less, so
  it can clear).
- The off-toggle class template lost its trailing space (`toggle ` →
  `toggle`) rather than pinning the wart in tests.

## Verification

- New `packages/ui/src/components/autoMlToggle.test.tsx`: full-panel
  sweep (7 switches, each the sole header control; manual sections
  switch-free with resets on dirt), exact ML badges, hand-only keys
  lighting the toggle, source pins for all seven toggle branches, and
  source pins for the `resetCategory` patches plus the removal of the
  per-category stack surface.
- Rewritten suites: `adjustmentMl`, `mlSections`,
  `adjustmentConsistency`, `resetPerAdjustment`, `singleResetIcon`,
  `globalAutoHighlight`, `sceneEnhance`, `faceEnhance`,
  `selectiveMask`, `denoise`, one `autoEnhance` case; core
  `actionStack`/`mlCategories` suites; server `action-stack` suite
  (plus a legacy-entry migration test). Repair/straighten suites pass
  untouched.
- `yarn test`: core 1002, server 181, UI 553 — all pass. `yarn
  typecheck`, `yarn lint`, `yarn build` green. No Playwright, per the
  task rules.
- Docs: `docs/features.md` (Adjust + Denoise + Boundaries) and
  `docs/architecture.md` (action-stack lines) updated; no README
  change (it lists no per-section controls). Changeset is `minor` for
  `@f8/ui` + `@f8/core`, hand-written in the CLI's exact format (`yarn
  changeset` needs an interactive TTY, same as tasks 25–30).
