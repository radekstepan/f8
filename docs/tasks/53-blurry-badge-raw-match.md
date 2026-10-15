# Task: Blurry tag matches RAW in the album view + "Flagged as blurry" copy

## Request

"Blurry" tag in the album view should match how "RAW" shows so remove
the border and match the text color. Say "Flagged as blurry...", you
are missing the "as".

## Change

- `apps/web/src/index.css`: `.thumb-cull.is-blurry` (the album-grid
  Blurry pill) dropped its `1px solid #55555e` border and its text
  color changed from `#d5d5db` to `#f1f1f2`, matching `.thumb-raw`
  exactly. The dark scrim background and the inline-flex icon layout
  are untouched, so legibility over thumbnails is unchanged.
- `packages/ui/src/components/EditorUI.tsx`: `blurryBadgeTooltip`
  base copy is now `Flagged as blurry by ML cull assist` (was
  `Flagged blurry by ...`), used by both the grid badge and the
  photo-view hint, with or without the confidence suffix.
- `packages/ui/src/components/PhotoStrips.tsx`: the Blurry cull-filter
  chip hint is now `Show only photos flagged as blurry by ML cull
  assist`.
- `apps/server/src/cull-assist.ts`: one-word comment fix so the
  internal `CullGroup.best` doc uses the same "flagged as blurry"
  wording.

## Decisions

- Photo-view hint (`.photo-blurry-hint`) left alone: the request
  scoped the restyle to the album view, and in the photo view the
  Blurry hint already matches its RAW counterpart (`.file-type`),
  which is also an outline chip.
- Duplicate pill (`.thumb-cull.is-duplicate`) left alone: not part of
  the request; it keeps its border.
- Only border + text color were aligned to RAW — not background,
  size, or position. RAW sits bottom-left on the thumb while the
  cull stack sits top-left; unifying those was not asked for.
- The copy fix follows the existing precedent: the Duplicate badge
  already said "Flagged as a near-duplicate by ML cull assist".

## Tests (`packages/ui/src/components/cullAssist.test.tsx`)

- Updated the five `Flagged/flagged blurry by` expectations to
  `Flagged/flagged as blurry by` (grid badge tooltip, photo-view
  hint tooltip, filter chip hint, `blurryBadgeTooltip` unit cases).
- Added `matches the grid blurry badge to the RAW tag — no border,
  same text color`: pins that neither `.thumb-raw` nor
  `.thumb-cull.is-blurry` declares a border, and that the blurry
  rule contains the RAW rule's exact `color` declaration (read from
  the stylesheet, not hardcoded, so a future RAW recolor fails
  loudly instead of drifting apart).

## Verification

- `yarn workspace @f8/ui test`: 81 files, 610 tests, all pass.
- `yarn workspace @f8/ui typecheck`: clean.
- `yarn workspace @f8/server test`: 19 files, 181 tests, all pass.
- No remaining `Flagged blurry by` / `flagged blurry by` in
  `packages/` or `apps/` (docs writeups excluded as historical).
