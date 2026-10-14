# Task 1: Show full preset names on portrait photos

## Problem

On a portrait photo, preset names truncated with ellipsis: "Golden Hour",
"Soft Light" (and potentially others) did not fit. Cause: the earlier
portrait-box fix (task `08-preset-box-width.md`) shrank the whole
`.preset-item` to the 43px filmstrip portrait width. A 43px box holds
~7 characters at the 9px label size, so every 10+ character name clipped.
The follow-up requirement: all preset names must show in full, on portrait
and landscape alike.

## Change

- `apps/web/src/index.css`: split the portrait sizing in two —
  `.presets-list.is-portrait .preset-item` is back at a 72px name width
  (`flex: 0 0 72px; max-width: 72px`), while only the thumbnail keeps the
  narrow portrait preview via a new rule,
  `.presets-list.is-portrait .preset-thumbnail { width: 43px; margin-inline: auto; }`.
  No markup or component logic changed — `PhotoStrips.tsx` already applied
  the `is-portrait` class correctly.
- `packages/ui/src/components/presetPortraitWidth.test.tsx`: rewrote the 6
  task-08 tests (which pinned the truncating 43px item) into 9 tests for the
  new contract — see Tests.

## Decisions

- 72px fits the longest built-in name, "Teal & Orange" (13 chars), with
  ~16px of real margin at 9px system type; every other built-in
  ("Golden Hour", "Soft Light", "Faded Film", …) is shorter. Kept 72px
  rather than widening further so the 8-preset Essentials strip still fits
  typical editor widths without scrolling more than before.
- Thumbnail stays 43px and centered instead of stretching to the 72px box:
  this preserves the task-08 intent (no wide letterboxed preview with big
  gutters) while the label gets its own room. Selected/hover frames now hug
  the 43px preview, as before.
- User-saved custom names are unbounded, so the label keeps `ellipsis` as a
  graceful fallback and the `Apply <name>` tooltip still carries the full
  text. The no-truncation guarantee covers the built-in set; the test
  asserts it for every name in `PRESETS`, so adding a longer preset later
  fails loudly.
- Landscape untouched (66px basis growing to 118px max): the test
  additionally pins that the longest name fits even the tightest
  responsive basis (64px at ≤1180px), covering the portrait-and-landscape
  requirement. The 3-class portrait selector still outranks the responsive
  single-class overrides, so portrait sizing holds at every breakpoint.
- No README update: pure CSS sizing fix, no architecture change.
- Doc number `13-` continues the existing `docs/tasks/NN-` running log.

## Tests

- Rewrote `presetPortraitWidth.test.tsx` (9 tests, server-rendered +
  stylesheet pins, no jsdom — same seam as before): `is-portrait` markup
  only for portrait photos; portrait item pins `flex: 0 0 72px` /
  `max-width: 72px`; portrait thumbnail pins `width: 43px` + centered;
  every `PRESETS` name fits the portrait box under a deliberately
  conservative (~13%-over) glyph-width estimator plus 8px headroom, and the
  longest estimate exceeds 43px (proving the check would have caught the
  old truncation); landscape sizing unchanged and the longest name fits the
  64px ≤1180px basis; portrait preview still `object-fit: contain`;
  "Golden Hour" / "Soft Light" names + tooltips render in both
  orientations; ellipsis kept as the custom-name fallback.

## Verification

- `packages/ui`: full suite — 63 files, 501 tests, all pass
  (includes the 9 rewritten `presetPortraitWidth` tests).
- `typecheck` clean in `packages/ui`.
- Playwright not run (out of scope per task rules).
