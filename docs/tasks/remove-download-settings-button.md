# Remove Download settings button

Task: `Remove Download settings button, not needed.`

## What changed

- `packages/ui/src/components/EditorDialogs.tsx`: removed the `Settings`
  button from the export dialog footer. It downloaded the current
  adjustments as a `-adjustments.json` file via `downloadBlob` plus a
  toast; the footer now holds only Cancel (+ Cancel upscale while an ML
  upscale runs) and Export Photo. The now-unused `Download` lucide icon
  was dropped from the import; `downloadBlob` stays — the actual photo
  export still uses it.
- `apps/web/src/index.css`: removed the now-dead `.export-settings` rule
  (`margin-right: auto` + font size). Footer alignment is unchanged:
  `.modal-footer` is `justify-content: flex-end`, so Cancel/Export stay
  right-aligned without the left-pinned button.
- `packages/ui/src/components/exportSettingsRemoved.test.tsx` (new, 3
  tests): the export dialog renders no `export-settings` class or
  `>Settings</button>`; Cancel and Export Photo are still present; and
  the stylesheet holds no `.export-settings` rule.

## Important decisions

- **`downloadBlob` kept**: it serves the real photo export path (both
  plain and 2x-upscaled exports), not just the removed button — only the
  button-only `Download` icon import was dead.
- **`.text-button` kept**: the removed button shared that class, but it
  is used across the Inspector, FsBrowser, and pinned by denoise/repair
  tests. Only the `export-settings` subclass was exclusive to the button.
- **No README update**: single-button UI removal, no architecture or
  feature change.

## Tests (unit/integration only, no Playwright)

- `exportSettingsRemoved.test.tsx` (new, 3 tests): button absence in the
  export dialog, footer actions intact, stylesheet rule gone — all via
  `renderToStaticMarkup` + a CSS file read.
- Full suite: `@f8/ui` 459/459 pass (58 files). `@f8/ui` typecheck clean.
