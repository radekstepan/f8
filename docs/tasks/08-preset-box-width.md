# Task 1: Shrink preset box width on portrait photos

## Problem

On a portrait photo, every preset box was about 3x too wide: the
`PresetStrip` flips the list to `.is-portrait` (via `isPortraitPhoto`),
but the only portrait rule switched the thumbnail image to
`object-fit: contain` while keeping the landscape item sizing
(`flex: 1 0 66px`, growing to `max-width: 118px`). The narrow portrait
preview letterboxed inside the wide box with large empty gutters on
both sides. The requirement: each box should be just big enough to
show the preview and the preset name.

## Change

- `apps/web/src/index.css`: added one rule plus an explanatory
  comment:
  `.presets-list.is-portrait .preset-item { flex: 0 0 43px; max-width: 43px; }`
  No markup or component logic changed — `PhotoStrips.tsx` already
  applied the `is-portrait` class correctly.

## Decisions

- 43px matches the filmstrip's `.is-portrait` item width exactly.
  That strip solved the same problem (portrait thumb in a landscape
  box: 91px → 43px + `contain`), so presets now behave consistently
  with the strip directly below them. A 2:3 portrait at the 55px
  thumbnail height needs ~39px, so 43px is preview + a hair of frame.
- Long names ("Golden Hour", "Teal & Orange") truncate with ellipsis
  in the narrow box, same as filmstrip filenames do. The full name
  stays available via the existing `Apply <name>` tooltip, so nothing
  is lost.
- Fixed px rather than per-photo aspect sizing: every thumb shows the
  same photo, so a uniform box keeps the strip aligned, and one rule
  covers all portrait aspects (3:4, 2:3, 9:16 just letterbox a little
  more). The short-viewport media query (49px thumbnails) is left
  alone for the same reason — the box stays close at every height.
- The 3-class selector (`.presets-list.is-portrait .preset-item`)
  deliberately outranks the responsive single-class `.preset-item`
  flex overrides, so portrait stays narrow at every breakpoint.
- No README update: pure CSS sizing fix, no architecture change.
- Doc number `08-` continues the existing `docs/tasks/NN-` sequence
  (this is item 1 of the new `tasks.md` batch, but the folder is one
  running log).

## Tests

- New `packages/ui/src/components/presetPortraitWidth.test.tsx`
  (6 tests, server-rendered + stylesheet pins, no jsdom — same seam
  as `filmstripSingleRow.test.tsx`): the strip carries `is-portrait`
  only for portrait photos; the portrait rule pins `flex: 0 0 43px`
  and `max-width: 43px`; the portrait width is under half the grown
  landscape max and under the landscape basis; landscape sizing is
  unchanged (66px basis / 118px max); the portrait preview still uses
  `object-fit: contain` (never cropped); names and their full-name
  tooltips still render.

## Verification

- `packages/ui`: full suite — 61 files, 481 tests, all pass
  (includes the 6 new `presetPortraitWidth` tests).
- `typecheck` clean in `packages/ui`.
- Playwright not run (out of scope per task rules).
