# Photomator Kitchen Sink

A photo-first, macOS-inspired editing workspace built with React, TypeScript, Vite, and CSS. Tailwind CSS v4 is available for extending the interface. The application starts in the editor, with an alpine photograph and a fully populated sample library.

This is an independent interface study, not the official Photomator application.

## Running Locally

This is a Yarn workspaces + Turborepo monorepo. Use the Node version in `.nvmrc`.

- `nvm use` selects the pinned Node version.
- `yarn install` installs the dependencies.
- `yarn dev` starts the Vite development server and the library server together (run `yarn build` once first so the workspace packages exist in `dist/`). Open the printed Vite URL (usually `http://localhost:5173`); API calls proxy to the library server at `http://127.0.0.1:5193`.
- `yarn build` builds every workspace package, then the application into `apps/web/dist/`.
- `yarn typecheck` typechecks every workspace package.
- `yarn workspace @photomator/server start` serves the production build and the API from one process at `http://127.0.0.1:5193` (run `yarn build` first).
- `yarn workspace @photomator/web preview` serves only the static production build (the library API stays unavailable).

## Build Notes

The production build keeps the single-file main bundle but emits the vision worker separately. `vite-plugin-singlefile` runs with `useRecommendedBuildConfig: false` because its `inlineDynamicImports` cannot carry module workers; `apps/web/vite.config.ts` replicates that recommended config minus inlining, so `dist/index.html` still embeds the app JS/CSS while the worker ships alongside it:

- `dist/vision.worker-*.js` (~1KB): the worker shell, spawned only when a vision feature starts it.
- `dist/opencv-*.js` (~15MB): OpenCV, fetched lazily by the worker on first use — never in the initial page load.

The `@techstark/opencv-js` build is single-file (its WASM is embedded as base64), so there is no separate `.wasm` asset to serve. Heavy vision entry points must keep this shape: construct the worker via `new Worker(new URL(..., import.meta.url))`, import OpenCV only inside the worker, and never import it from main-thread code. The one exception is Node-only: `@photomator/core` lists the package as a devDependency so the inpaint golden tests can run real `cv.inpaint` outside the browser; test files are never shipped in the app bundle. A networked `yarn install` fetches the package from the npm registry.

## Included Interactions

- Twelve sample photographs, three albums, favorites, star ratings, search, smart collections, and a resizable photo grid.
- Fourteen built-in presets across Landscape, Cinematic, and Black & White, plus persistent custom presets.
- Live temperature, tint, lightness, hue, saturation, vibrance, detail, tone, grain, vignette, and fade adjustments.
- Editable numeric values, keyboard-accessible sliders, section toggles, automatic adjustment examples, and double-click slider resets.
- A live RGB histogram derived from the rendered image.
- Per-photo undo/redo with up to fifty history entries. Consecutive slider changes are grouped into a single edit.
- Draggable before/after comparison and hold-to-preview-original behavior.
- Centered aspect-ratio cropping, rotation, flips, and straightening with automatic horizon detection, plus a rule-of-thirds overlay.
- Browser-based repair brushes (OpenCV inpainting with a blur fallback) and clone stamping. Click to choose a clone source; Alt-click to choose another.
- Photo import using a file picker, drag and drop, or in-place folder import, including camera RAW files (rendered from the largest embedded JPEG preview, with the RAW file's orientation applied). When a RAW file and a JPEG share a filename, only the RAW is imported. Content hashing dedupes reimports and relinks moved files with their edits intact.
- JPEG, PNG, and WebP export, configurable size and quality, plus JSON adjustment export.
- Copy/paste adjustments between photographs, with each photograph's crop and retouching preserved.
- Functional application menus, keyboard shortcuts, photo information, album creation, preset creation, and help dialogs.
- Collapsible workspace panels, a mobile bottom-sheet inspector, visible focus states, focus-trapped dialogs, and reduced-motion support.

## Project Map

| Workspace | Responsibility |
| --- | --- |
| `apps/web` (`@photomator/web`) | Vite application: workspace composition, keyboard shortcuts, import, and styles. Library state comes from the server. |
| `apps/server` (`@photomator/server`) | Local library server: SQLite catalog, referenced originals, SHA-256 identity, edit recipes, and preview cache. Serves the production web build when present. |
| `packages/core` (`@photomator/core`) | Framework-free editor logic: typed models, sample library, presets, the image pipeline, and the library HTTP client. |
| `packages/ui` (`@photomator/ui`) | React components, the `useEditor` history hook, the `useLibrary` server hook, and shared UI utilities. Depends on `@photomator/core`. |

| File | Responsibility |
| --- | --- |
| `apps/web/src/App.tsx` | Workspace composition, keyboard shortcuts, import flows, and server-offline handling. |
| `apps/web/src/components/FsBrowser.tsx` | Server-folder browser for in-place import and missing-file relinking. |
| `apps/web/src/index.css` | Visual tokens, native-style controls, responsive layout, and motion. |
| `apps/server/src/app.ts` | HTTP API: library, imports, edits, albums, presets, folder browsing, and static serving. |
| `apps/server/src/importer.ts` | Hashing, EXIF metadata, RAW preview extraction, dedupe/relink, and folder scanning. |
| `apps/server/src/store.ts` | Typed SQLite access: photos, edits, albums, presets. |
| `apps/server/src/db.ts` | Database open, WAL mode, and schema migrations. |
| `packages/core/src/types.ts` | Typed photo, album, preset, adjustment, and history models. |
| `packages/core/src/data.ts` | Sample library, default adjustments, built-in presets, and crop ratios. |
| `packages/core/src/image.ts` | Shared image loading, geometry, filter mapping, retouching, effects, and export. |
| `packages/core/src/library.ts` | Library API contract and framework-free HTTP client. |
| `packages/ui/src/hooks/useEditor.ts` | Non-destructive per-photo edits, grouped history, server persistence, and preset application. |
| `packages/ui/src/hooks/useLibrary.ts` | Server library state: loading, uploads, folder import, metadata, and legacy migration. |
| `packages/ui/src/components/EditorUI.tsx` | Reusable buttons, sliders, switches, selects, menus, and accessible dialogs. |
| `packages/ui/src/components/Topbar.tsx` | Application menus, editing toolbar, and status bar. |
| `packages/ui/src/components/Sidebar.tsx` | Library, album navigation, search, and import entry point. |
| `packages/ui/src/components/PhotoCanvas.tsx` | Responsive canvas, histogram sampling, comparison, and pointer-based retouching. |
| `packages/ui/src/components/PhotoStrips.tsx` | Presets, filmstrip, and photo browser. |
| `packages/ui/src/components/Inspector.tsx` | Color adjustments, crop controls, and brush controls. |
| `packages/ui/src/components/EditorDialogs.tsx` | Export, metadata, album, preset, shortcut, and about dialogs. |

## Extending the Demo

### Add Photos or Presets

Add entries to `SAMPLE_PHOTOS`, `SAMPLE_ALBUMS`, or `PRESETS` in `packages/core/src/data.ts`. Remote images must allow cross-origin canvas access. Local images placed in `apps/web/public/` are also supported and avoid a network dependency.

The sample metadata deliberately resembles a RAW photo library. The actual sample assets are web-resolution JPEG previews from Pexels, with photographer credits available in Photo Information.

### Add an Adjustment

1. Add a typed field to `EditState` in `packages/core/src/types.ts`.
2. Add a neutral default to `DEFAULT_EDIT` in `packages/core/src/data.ts`.
3. Add its control to an `AdjustmentSection` in `packages/ui/src/components/Inspector.tsx`. The `range()` helper connects numeric controls to history automatically.
4. Implement the effect in `getPhotoFilter()`, `geometryCanvas()`, or `drawEffects()` in `packages/core/src/image.ts`.

Both preview and export use that shared image pipeline, so changes to an effect remain consistent. More advanced processing can replace the pipeline with WebGL, WebGPU, a worker, or a server-backed renderer without replacing the interface.

### Add Tools or Dialogs

Extend the `Tool` or `DialogType` union in `packages/core/src/types.ts`, add the toolbar/menu action, and supply the inspector or dialog content. `ChangeEdit` is the public entry point for non-destructive changes; pass a stable merge key when an interaction generates continuous updates.

### Library Server

`apps/server` is the library backend. It binds to localhost without authentication (single-user, this device only) and stores its catalog in `apps/server/data/photomator.db` (SQLite, WAL mode) with extracted RAW previews alongside it.

- **Referenced originals.** Folder import (`File → Import from Folder…`, or `Ctrl/⌘ Shift O`) records a file's absolute path and never copies bytes. Uploads (picker or drag and drop) cannot see your paths — browsers hide them — so the server first stores them under `~/Pictures/Photomator/YYYY/MM/` and references them from there.
- **Hash identity.** Every original is SHA-256 hashed at import. Reimporting a moved file relinks it to its record (edits intact); reimporting the same bytes anywhere reports a duplicate instead of a second record.
- **Missing files.** A photo whose file is gone shows a Missing badge; opening it offers to locate the original, and any folder import that finds the bytes heals it automatically.
- **Non-destructive edits.** The original is never written to. Each photo keeps one edit recipe in SQLite, saved ~500ms after each change; undo/redo stacks stay session-only.
- **Samples.** The first boot seeds the twelve sample photos as URL records (no local bytes, never missing), with photo-1 starting on the Natural preset.

Configuration is all environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `PHOTOMATOR_PORT` | `5193` | HTTP port. |
| `HOST` / `PHOTOMATOR_HOST` | `127.0.0.1` | Bind address; keep localhost unless you add authentication. |
| `PHOTOMATOR_DATA` | `apps/server/data` | Database, previews, and upload staging. |
| `PHOTOMATOR_LIBRARY` | `~/Pictures/Photomator` | Where uploaded bytes land. |
| `PHOTOMATOR_ROOTS` | `~` | Colon-separated roots the folder browser and path import may touch. |

The API contract lives in `packages/core/src/library.ts` (`LibraryPhoto`, `LibrarySnapshot`, `createLibraryClient`), so scripts and alternative clients can share it.

### Change the Visual System

The primary tokens are at the top of `apps/web/src/index.css`: `--accent`, `--accent-muted`, `--muted`, `--border`, `--sidebar-width`, and `--inspector-width`. The editor uses system fonts with Inter as a web-font fallback.

## Persistence and Privacy

Photos, edits, favorites, ratings, albums, and custom presets live in the server's SQLite database; undo/redo history is session-only. The browser keeps no photo state — everything survives reloads, and edits reapply to the referenced originals every time. On the first run against a fresh database, any pre-server `photomator-demo-*-v1` localStorage state (sample edits, favorites, custom albums and presets) migrates into the library once, then clears.

Everything stays on your machine: the server binds to localhost, originals stay in your folders, and nothing is uploaded anywhere. Remote sample images and the optional Inter font require an internet connection.

## Demo Boundaries

- The Enhance control and per-section Auto buttons apply histogram-based adjustments; no machine-learning model is included.
- Color adjustments are lightweight browser-filter approximations, not a color-managed RAW engine. Tone, clarity, and sharpness are simplified contrast mappings.
- Repair reconstructs masked regions with OpenCV inpainting (Telea or Navier-Stokes) in a worker, falling back to a local blur when the vision engine is unavailable. Clone copies pixels from a source region.
- Crop supports centered ratios rather than a freely movable crop rectangle. The overlay is a rule-of-thirds framing guide.
- Zoom percentages are relative to the fitted preview, not a one-to-one source-pixel scale.
- Sample camera details are illustrative. Imported photos read real EXIF camera details when present. Export does not embed the sample metadata.
- Export never upscales beyond the available source resolution.
- The backend is a local single-user server with no authentication: keep it on localhost. There is no cloud synchronization, account system, or Photos-library integration.

## Useful Shortcuts

| Key | Action |
| --- | --- |
| `G` | Toggle photo browser |
| `/` | Search the library |
| `Left` / `Right` | Previous / next photo |
| `A` | Toggle automatic enhancement |
| `V`, `C`, `J` | Adjust, Crop, Repair |
| `F` | Favorite |
| `R` | Rotate left |
| `B` | Toggle draggable comparison |
| Hold `\` | Preview the original |
| `+`, `-`, `0` | Zoom in, out, fit |
| `Shift F` | Focus mode |
| `Ctrl/Cmd Z` | Undo |
| `Ctrl/Cmd Shift Z` | Redo |
| `Ctrl/Cmd Shift C` / `V` | Copy / paste adjustments |
| `Ctrl/Cmd O` | Import |
| `Ctrl/Cmd Shift O` | Import from folder |
| `Ctrl/Cmd Shift E` | Export |
| `I`, `?` | Photo information, shortcut help |

## Verification

The production build is verified with `yarn build` (Turborepo: `tsc` for the workspace packages, then Vite for the app), `yarn typecheck`, and `yarn test` (core pipeline tests plus server import/relink/edit/endpoint tests). A browser automation runner is not included. For a quick interactive smoke test, run `yarn dev`, open the printed local URL, then change exposure, undo/redo it, select a preset, drag the comparison divider, crop a photo, import an image, export it, reload to verify persistence, move the imported file on disk, and reimport it from its new location to verify relinking with edits intact.