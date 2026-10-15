# Task: Standardize the blurry badge

## Request

Blurry and "Might be blurry" ugh. Standardize how we show this
information. Use a little warning icon (not colored) and say "Blurry" on
both album and photo view. On hover on the photo you might say more info
including confidence score if we have it.

## Investigation

The blurry flag (`blurry` entry in `photo.labels`, `CULL_LABEL_BLURRY`)
surfaced in two different costumes:

- Library grid (`PhotoBrowser` in
  `packages/ui/src/components/PhotoStrips.tsx`): a filled red-brown
  (`#7c4534d9`) pill reading "Blurry · ML".
- Photo view heading (`PhotoCanvas` in
  `packages/ui/src/components/PhotoCanvas.tsx`): a muted amber outline
  chip reading "Might be blurry · ML".

Both tooltips said only "Flagged blurry by ML cull assist" — no
confidence, even though every ML label entry carries a `score` 0..1
(`blurConfidence` in `packages/core/src/vision/cull-assist.ts`). The
tooltip was also wrong for hand-added flags: `hasCullLabel` ignores
`source`, and hand-added labels land as `{ score: 1, source: 'user' }`
(server store assigns the placeholder 1), so a flag the user added
themselves still claimed the ML detector did it.

## Change

- `packages/ui/src/components/EditorUI.tsx`
  - New shared `BlurryBadge` component: a 9px lucide `TriangleAlert`
    (stroke inherits the badge's neutral text color — no color of its
    own) followed by the word "Blurry". Both surfaces render this one
    component, so the copy, icon, and tooltip can never drift apart
    again.
  - New `blurryBadgeTooltip` helper: ML flags get "Flagged blurry by ML
    cull assist · {pct}% confidence" when the score is finite;
    hand-added flags get "Marked blurry by hand" with no confidence
    (their score 1 is a placeholder, not a measurement).
- `packages/ui/src/components/PhotoStrips.tsx`
  - The grid pill is now `<BlurryBadge>` fed by a new `cullLabelEntry`
    lookup (the entry, not just a boolean, so the tooltip can read the
    score), keyed on the shared `CULL_LABEL_BLURRY` constant. The
    duplicate pill is untouched.
- `packages/ui/src/components/PhotoCanvas.tsx`
  - The heading hint is the same `<BlurryBadge>` (keeping its
    `photo-blurry-hint` test id), fed by the same label lookup.
- `apps/web/src/index.css`
  - `.thumb-cull.is-blurry`: red fill gone; now the same neutral dark
    scrim + gray border as the duplicate pill (`#000a` keeps it legible
    over thumbnails).
  - `.photo-blurry-hint`: amber gone; now the neutral `file-type` chip
    outline.
  - Both rules add `inline-flex` + gap so the icon sits beside the text.
- Tests (`packages/ui/src/components/cullAssist.test.tsx`)
  - Grid + photo view assert the shared badge: "Blurry" text, warning
    icon, confidence tooltip; old wordings ("Blurry · ML",
    "Might be blurry") asserted absent.
  - CSS pins the neutral treatment: no red `#7c4534`, no amber, icon
    layout on both rules.
  - New tooltip cases: hand-added flag wording, ML confidence
    formatting, NaN score falling back to the base text, and a
    hand-flagged grid photo showing no "% confidence".
- No README change: a UI standardization reusing an existing signal,
  not an architecture change or a complex feature.

## Decisions

- One shared component rather than two matching snippets: the task is
  literally "standardize", and a single `BlurryBadge` makes future drift
  a compile-time impossibility instead of a code-review hope. It lives
  in `EditorUI.tsx` next to the existing shared `MlBadge`.
- Tooltip on the badge, not on the photo canvas: "on hover say more"
  attaches to the indicator you hover — the existing `data-tooltip`
  mechanism both surfaces already used. Hovering the photo pixels
  themselves would fight canvas interactions (brush, pan, zoom lens).
- Confidence only for ML flags: showing "100% confidence" for a
  hand-added flag would launder a placeholder into a measurement. The
  user-source tooltip also fixes the previously wrong ML attribution.
- Grid pill keeps a dark translucent scrim: over thumbnails an outline
  chip alone would be unreadable; the scrim is neutral black, matching
  the duplicate pill, not a color.

## Verification

- `yarn workspace @f8/ui test --run src/components/cullAssist.test.tsx`:
  8 tests pass (incl. 1 new).
- `yarn workspace @f8/ui test --run`: 80 files / 605 tests pass.
- `typecheck` passes for `@f8/ui` and `@f8/web`.
- Playwright not run (per task rules).
