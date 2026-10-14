# 12 — README rewrite (Task 5)

Rewrote the README in ASD-STE100 Simplified Technical English and extracted
deep content into separate docs files.

## What changed

- `README.md`: rewritten from 207 lines to ~70 lines. Short sentences, simple
  words, numbered start steps with one action per step. Lists all app
  functions (library, adjust, search/cull, denoise, history/compare, crop,
  repair, import, export), credits the original design to *GPT 6 Astra* and
  follow-up work to *Muse Spark 1.3* (both in italics), gives init
  instructions (`yarn install`, `yarn setup`, `yarn build`, `yarn dev`, open
  the printed URL), and embeds the screenshot.
- `docs/architecture.md` (new): Project Map (workspaces + key files), Build
  Notes (single-file bundle, vision worker, lazy OpenCV/ORT), Library Server
  deep-dive (referenced originals, hash identity, folder albums, missing
  files, non-destructive edits, RAW decoding, samples), the full `F8_*`
  environment-variable table, and Persistence and Privacy. Moved verbatim
  from the old README.
- `docs/features.md` (new): full function catalogue (grouped: Library,
  Adjust, Search and cull, Denoise, History and compare, Crop and repair,
  Import and export), the Shortcuts table, and the Boundaries list. Moved
  verbatim from the old README.
- `docs/development.md` (new): Extending the Demo (add photos/presets,
  add an adjustment, add tools/dialogs, visual system) and Verification.
  Moved verbatim from the old README.
- `screenshot.png` → `docs/screenshots/app.png` (`git mv`, history kept).
  The old 10MB root asset was the only screenshot in the repo and nothing
  referenced it, so it moved instead of duplicating.
- `packages/core/src/readme.test.ts` (new): 9 vitest checks — README stays
  light (<150 lines, no deep-dive markers), all `docs/*.md` references
  exist, italics attributions present, init commands present, all function
  keywords present, every embedded image exists, and each extracted doc
  holds its expected content.

## Decisions

- Three docs files (architecture / features / development) rather than one
  dump, so each answers one reader question: how it is built, what it does,
  how to change it.
- `docs/learnings.md` deliberately untouched — the parent synthesizes it.
- Screenshot reused as-is. It is slightly stale (title bar says
  "Photomator", "KITCHEN SINK" badge) but it is a real app screenshot and
  retaking one was out of scope without browser automation.
- STE100 style applied to the README only; the extracted docs keep their
  original technical wording so no detail is lost in simplification.

## Verification

- New test: 9/9 pass.
- Full `@f8/core` suite: 920/920 pass.
- `tsc --noEmit` on `@f8/core`: clean (fixed one `string | undefined`
  strictness error in the new test).
