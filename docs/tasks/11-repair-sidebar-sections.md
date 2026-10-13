# Task 11 — Repair sidebar sections, slim actions, hover previews

## Problem
The Repair sidebar was one flat list (brush, reconstruction, one-click
removal, dust spots, repaired strokes) unlike the grouped Adjust sidebar;
the "Remove x selected" / "Find dust spots" buttons used the chunky 33px
`secondary-button`; and the person/spot rows ("Person 1", "Person 2") gave
no clue which photo region each row referred to.

## Fix
- `packages/ui/src/components/Inspector.tsx`: the repair branch now renders
  the intro plus five `AdjustmentSection`s like Adjust — Brush (size +
  strength), Reconstruction (method/quality/feather), One-Click Removal,
  Dust Spots, Repairs (stroke list). Inner `<h4>`s in
  `RepairMethodControl`/`ObjectRemovalControl`/`DustSpotsControl` were
  removed (section headings take over); `AdjustmentSection` gained an
  optional `badge` prop so the ML sections keep their ML badge in the
  heading. Detect/apply buttons switched from `secondary-button` to the new
  slim style. Removal/dust rows report hover/focus via new optional
  `highlighted`/`onHighlight` assist fields and reuse the
  `is-highlighted` row treatment.
- `packages/core/src/detectionPreview.ts` (new): `DetectionPreview`
  (normalized person `box` / dust `disc`) plus `previewFrameGeometry()`,
  which maps it to overlay-SVG pixels (exported from core index).
- `packages/ui/src/components/PhotoCanvas.tsx`: new optional
  `highlightRegion` prop renders a red `retouch-preview-group` in the
  existing overlay SVG — a bounding rect for people, a healed-style disc
  for dust spots — gated on the same repair/idle/visible conditions as the
  healed-area highlight.
- `apps/web/src/App.tsx`: new `highlightRemoval` state (`{source, index}`)
  wired into both assists; derived `removalPreview` passed to the canvas;
  cleared on apply/dismiss/photo-switch/tool-switch. Stale indices resolve
  to null defensively.
- `apps/web/src/index.css`: new `.slim-button` (27px, same visual language
  as Add Adjustment); `.retouch-preview-group` red styling (translucent
  fill + 1.5px stroke for rects); `.adjustment-content h4` picks up the
  "Repair Quality" subheading; `.retouch-status` top border dropped inside
  the Repairs section; removal notes tightened to section spacing; removed
  the obsolete `.object-removal > .secondary-button` rule.

## Decisions
- Slim buttons reuse the existing Add Adjustment look instead of inventing
  a new visual language; Cancel/Retry/Dismiss stay `text-button`.
- Preview is list→canvas only (row hover shows the region); canvas→row
  hover stays healed-strokes-only, matching the existing `strokeAt` path.
- Box/disc coordinates are source-framing normalized, so the preview is
  exact only without crop/rotation — the same documented limitation the
  detect/apply path already has (remapping is a follow-up).
- No README change: grouped sidebar + hover preview, no architecture shift.

## Verification
- `packages/core/src/detectionPreview.test.ts` (new): 4 tests (box→rect,
  disc→circle, min-radius visibility floor, no negative sizes).
- `packages/ui/src/components/repairSections.test.tsx` (new): 5 tests
  (five section headings + brush placement, ML sections omitted without
  assists, ML badges in headings, slim buttons with zero
  `secondary-button`, exactly the hovered rows highlighted).
- Existing `objectRemoval`/`dustSpots` suites pass unchanged (5+5).
- Full suites: core 745 pass, UI 123 pass; `yarn typecheck` 6/6.
