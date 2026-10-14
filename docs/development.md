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

## Verification

The production build is verified with `yarn build` (Turborepo: `tsc` for the workspace packages, then Vite for the app), `yarn typecheck`, and `yarn test` (core pipeline tests plus server import/relink/edit/endpoint tests). A browser automation runner is not included. For a quick interactive smoke test, run `yarn dev`, open the printed local URL, then change exposure, undo/redo it, select a preset, drag the comparison divider, crop a photo, import an image, export it, reload to verify persistence, move the imported file on disk, and reimport it from its new location to verify relinking with edits intact.
