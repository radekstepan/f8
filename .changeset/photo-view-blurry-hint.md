---
'@f8/ui': patch
'@f8/web': patch
---

Photos flagged blurry by ML cull assist now show a subtle "Might be blurry · ML" hint in the photo-view heading, next to the file-type and Edited chips. It reuses the same blurry label as the library grid badge but with a softer amber-outline treatment instead of the severe red fill.

## Task writeup (docs/tasks/52-photo-view-blurry-hint.md)

## Request

Show the fact that a photo might be blurry on the photo view as well.
Make it less severe than the current "red".

## Investigation

The "might be blurry" signal already exists end to end:

- Detection: `blurScore` / `isBlurryScore` in
  `packages/core/src/vision/cull-assist.ts` (Laplacian variance under
  `CULL_BLUR_THRESHOLD`), assessed server-side at import.
- Flag: the `blurry` entry in `photo.labels` (`CULL_LABEL_BLURRY`).
- Display: only on the library grid — `PhotoBrowser` in
  `packages/ui/src/components/PhotoStrips.tsx` renders a
  `thumb-cull is-blurry` pill ("Blurry · ML") over flagged thumbnails,
  styled with a severe filled red-brown background (`#7c4534d9`).

The single-photo view (`PhotoCanvas` in
`packages/ui/src/components/PhotoCanvas.tsx`) showed no trace of the flag:
opening a blurry photo gave no indication unless you already knew. (The
info dialog lists all labels, but that is a modal you have to open.)

## Change

- `packages/ui/src/components/PhotoCanvas.tsx`
  - The photo heading (filename row) now renders a `Might be blurry · ML`
    pill next to the file-type/Edited chips when the open photo carries
    the `blurry` label — the same `photo.labels` signal the grid uses,
    keyed on the shared `CULL_LABEL_BLURRY` constant. No new detector.
  - Same tooltip as the grid badge ("Flagged blurry by ML cull assist")
    and a `photo-blurry-hint` test id.
- `apps/web/src/index.css`
  - New `.photo-blurry-hint` rule: a muted amber outline chip in the
    `file-type` chip shape — no background fill, no red. Deliberately
    quieter than the grid badge because in the photo view you are already
    looking at the pixels; the hint is a nudge, not a verdict.
- Tests (`packages/ui/src/components/cullAssist.test.tsx`, +2 cases)
  - Photo view shows the hint for a blurry-labeled photo; clean photos
    and photos with unrelated labels stay bare.
  - CSS pins the soft treatment: the hint has an outline border, no
    background fill, and none of the grid badge's `#7c4534` red.
- No README change: a one-pill UI addition reusing an existing signal,
  not an architecture change or a complex feature (same reasoning as
  tasks 1–2).

## Decisions

- Heading, not canvas overlay: the heading already hosts photo-level
  status chips (RAW/JPEG, Edited), so the hint sits with its peers and
  never covers pixels. An overlay on the frame would compete with the
  compare labels, zoom lens, and retouch overlays.
- "Might be" wording: the detector is heuristic (a fixed Laplacian
  threshold), and the task frames it as uncertainty — the softer copy
  matches the softer style.
- Blurry only, not duplicate: the task asks only for the blurry fact.
  The duplicate flag is a relationship between photos, which makes
  sense on the grid but not on a single open photo.

## Verification

- `yarn workspace @f8/ui test --run src/components/cullAssist.test.tsx`:
  7 tests pass (incl. 2 new).
- `yarn workspace @f8/ui test --run`: 79 files / 600 tests pass.
- `typecheck` passes for `@f8/ui` and `@f8/web` (no new core exports,
  so no core rebuild was needed).
- Playwright not run (per task rules).
