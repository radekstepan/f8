# Development

How to extend f/8 and how to verify a change. Start here after the README start steps.

## Add photos or presets

Add entries to `SAMPLE_PHOTOS`, `SAMPLE_ALBUMS`, or `PRESETS` in `packages/core/src/data.ts`. Remote images must allow cross-origin canvas access. Local images placed in `apps/web/public/` are also supported and avoid a network dependency.

The sample metadata deliberately resembles a RAW photo library. The actual sample assets are web-resolution JPEG previews from Pexels, with photographer credits available in Photo Information.

## Add an adjustment

1. Add a typed field to `EditState` in `packages/core/src/types.ts`.
2. Add a neutral default to `DEFAULT_EDIT` in `packages/core/src/data.ts`.
3. Add its control to an `AdjustmentSection` in `packages/ui/src/components/Inspector.tsx`. The `range()` helper connects numeric controls to history automatically.
4. Implement the effect in `getPhotoFilter()`, `geometryCanvas()`, or `drawEffects()` in `packages/core/src/image.ts`.

Both preview and export use that shared image pipeline, so changes to an effect remain consistent. More advanced processing can replace the pipeline with WebGL, WebGPU, a worker, or a server-backed renderer without replacing the interface.

## Add tools or dialogs

Extend the `Tool` or `DialogType` union in `packages/core/src/types.ts`, add the toolbar/menu action, and supply the inspector or dialog content. `ChangeEdit` is the public entry point for non-destructive changes; pass a stable merge key when an interaction generates continuous updates.

## Change the visual system

The primary tokens are at the top of `apps/web/src/index.css`: `--accent`, `--accent-muted`, `--muted`, `--border`, `--sidebar-width`, and `--inspector-width`. The editor uses system fonts with Inter as a web-font fallback.

## Versioning

The app has one overall version, shared by all four workspaces
(`@f8/core`, `@f8/ui`, `@f8/web`, `@f8/server`) through a changesets
`fixed` group in `.changeset/config.json`. The UI reads it from
`APP_VERSION` in `packages/core/src/branding.ts` (menu bar, About dialog).

1. `yarn changeset` — record a user-facing change as a patch, minor, or
   major bump (writes a markdown file in `.changeset/`).
2. `yarn version-packages` — consume the pending changesets, bump the four
   workspace versions in lockstep, and rewrite `APP_VERSION` to match via
   `scripts/sync-app-version.mjs`.
3. Review the diff, then commit it.

`branding.test.ts` fails if `APP_VERSION` drifts from any workspace
`package.json`, and the sync script refuses to run when the workspaces
disagree with each other. The root `package.json` stays at `0.0.0`:
changesets only versions the workspaces.

## Verification

The production build is verified with `yarn build` (Turborepo: `tsc` for the workspace packages, then Vite for the app), `yarn typecheck`, and `yarn test` (core pipeline tests plus server import/relink/edit/endpoint tests). A browser automation runner is not included. For a quick interactive smoke test, run `yarn dev`, open the printed local URL, then change exposure, undo/redo it, select a preset, drag the comparison divider, crop a photo, import an image, export it, reload to verify persistence, move the imported file on disk, and reimport it from its new location to verify relinking with edits intact.
