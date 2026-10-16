---
'@f8/ui': minor
'@f8/web': minor
---

Importing photos from the album page is now one click away: the album header carries its own Import button even when the album already has photos, empty albums hint that files can be dropped anywhere, and dropping files onto a brand-new empty library finally imports them instead of bouncing off the welcome screen.

## Change

- `packages/ui/src/components/PhotoStrips.tsx`: `PhotoBrowser` heading actions gain an Import icon button (lucide `Import`, label "Import photos") wired to the existing `onImport` prop, so populated albums — which previously showed an import button only in the sidebar or the empty state — have one in the header. The plain empty-album state adds a second line ("You can also drop photos or a folder anywhere to import them."); search and filtered empties keep their existing copy.
- `apps/web/src/App.tsx`: the empty-library gate (`if (!photo)`, an early return outside the drop-enabled app shell) gets the same file-drop surface as the shell — drag handlers plus the overlay — so a first-run drop imports instead of landing on a dead surface. The overlay markup is extracted into a shared `DropOverlay` component used by both the gate and the shell (previously inline in the shell only). The gate's welcome line now mentions dropping files.
- Tests: new `packages/ui/src/components/albumImport.test.tsx` (7 tests: heading-button markup pin, no empty-state button with photos, primary button kept on empty albums, drop-hint presence/absence, and two App-wiring source pins proving the gate carries the drop handlers and both surfaces share `DropOverlay`).

## Decisions

- **Reuse the existing pipeline, add no new import path.** Drops and the new button both funnel into the existing `importDrop`/`importFiles` flow (folder grouping, progress toast, summary notify) — the shell already imported drops into the viewed album, so the album page needed only the button, the hint, and the gate fix.
- **Icon button in the header, matching the sidebar glyph.** The header actions are icon-only (sort, grid size, album menu); a labeled button would break the row's rhythm. The `Import` lucide icon matches the sidebar's import button for recognition.
- **Hint only on plain empties.** Search and filter empties describe a different problem (no matches); advertising drops there would read as a fix for the wrong thing.
- **Source pins for the App.tsx half.** The UI suite runs in node without jsdom and apps/web has no unit harness (Playwright only, forbidden by the task rules), so the gate wiring is pinned at the source level per the `presetPreviewRefresh.test.tsx` precedent.
- **Changeset number 70.** Highest numeric prefix across `.changeset` (69) and `docs/tasks` (18) is 69, so this continues the running log at 70.

## Tests

- UI suite: 90 files / 718 pass (711 before + 7 new in `albumImport.test.tsx`). `typecheck` clean.
- Web `typecheck` clean, `web build` succeeds. No Playwright, per the task rules.
