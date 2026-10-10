# Photomator Kitchen Sink

A photo-first, macOS-inspired editing workspace built with React, TypeScript, Vite, and CSS. Tailwind CSS v4 is available for extending the interface. The application starts in the editor, with an alpine photograph and a fully populated sample library.

This is an independent interface study, not the official Photomator application.

## Running Locally

This is a Yarn workspaces + Turborepo monorepo. Use the Node version in `.nvmrc`.

- `nvm use` selects the pinned Node version.
- `yarn install` installs the dependencies.
- `yarn dev` starts the Vite development server (run `yarn build` once first so the workspace packages exist in `dist/`).
- `yarn build` builds every workspace package, then the application into `apps/web/dist/`.
- `yarn typecheck` typechecks every workspace package.
- `yarn workspace @photomator/web preview` serves the production build.

## Included Interactions

- Twelve sample photographs, three albums, favorites, star ratings, search, smart collections, and a resizable photo grid.
- Fourteen built-in presets across Landscape, Cinematic, and Black & White, plus persistent custom presets.
- Live temperature, tint, lightness, hue, saturation, vibrance, detail, tone, grain, vignette, and fade adjustments.
- Editable numeric values, keyboard-accessible sliders, section toggles, automatic adjustment examples, and double-click slider resets.
- A live RGB histogram derived from the rendered image.
- Per-photo undo/redo with up to fifty history entries. Consecutive slider changes are grouped into a single edit.
- Draggable before/after comparison and hold-to-preview-original behavior.
- Centered aspect-ratio cropping, rotation, flips, and straightening, with a rule-of-thirds overlay.
- Browser-based repair brushes and clone stamping. Click to choose a clone source; Alt-click to choose another.
- Photo import using a file picker or drag and drop.
- JPEG, PNG, and WebP export, configurable size and quality, plus JSON adjustment export.
- Copy/paste adjustments between photographs, with each photograph's crop and retouching preserved.
- Functional application menus, keyboard shortcuts, photo information, album creation, preset creation, and help dialogs.
- Collapsible workspace panels, a mobile bottom-sheet inspector, visible focus states, focus-trapped dialogs, and reduced-motion support.

## Project Map

| Workspace | Responsibility |
| --- | --- |
| `apps/web` (`@photomator/web`) | Vite application: workspace composition, library state, keyboard shortcuts, import, and styles. |
| `packages/core` (`@photomator/core`) | Framework-free editor logic: typed models, sample library, presets, and the image pipeline. |
| `packages/ui` (`@photomator/ui`) | React components, the `useEditor` history hook, and shared UI utilities. Depends on `@photomator/core`. |

| File | Responsibility |
| --- | --- |
| `apps/web/src/App.tsx` | Application state, library management, keyboard shortcuts, import, and workspace composition. |
| `apps/web/src/index.css` | Visual tokens, native-style controls, responsive layout, and motion. |
| `packages/core/src/types.ts` | Typed photo, album, preset, adjustment, and history models. |
| `packages/core/src/data.ts` | Sample library, default adjustments, built-in presets, and crop ratios. |
| `packages/core/src/image.ts` | Shared image loading, geometry, filter mapping, retouching, effects, and export. |
| `packages/ui/src/hooks/useEditor.ts` | Non-destructive per-photo edits, grouped history, persistence, and preset application. |
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

### Connect a Real Library

Replace the library load/save logic in `apps/web/src/App.tsx` with your data layer. The components receive typed values and callbacks rather than directly accessing storage. An IndexedDB-backed blob store is a natural next step for retaining imported originals.

### Change the Visual System

The primary tokens are at the top of `apps/web/src/index.css`: `--accent`, `--accent-muted`, `--muted`, `--border`, `--sidebar-width`, and `--inspector-width`. The editor uses system fonts with Inter as a web-font fallback.

## Persistence and Privacy

Sample-photo edits, favorites, ratings, albums, and custom presets are stored in `localStorage` under `photomator-demo-*-v1` keys. Undo/redo history is session-only. Imported photos use object URLs and intentionally remain session-only; they are not uploaded to a server. Download edited imports before refreshing.

Clear the `photomator-demo-` local-storage entries to restore the original sample library. Remote sample images and the optional Inter font require an internet connection.

## Demo Boundaries

- The ML-labeled Enhance control applies an illustrative preset; no machine-learning model is included.
- Color adjustments are lightweight browser-filter approximations, not a color-managed RAW engine. Tone, clarity, and sharpness are simplified contrast mappings.
- Repair uses a local blur, not content-aware object removal. Clone copies pixels from a source region.
- Crop supports centered ratios rather than a freely movable crop rectangle. The corner marks are framing guides.
- Zoom percentages are relative to the fitted preview, not a one-to-one source-pixel scale.
- Sample camera details are illustrative; importing a file does not parse EXIF data. Export does not embed the sample metadata.
- Export never upscales beyond the available source resolution.
- There is no backend, cloud synchronization, account system, or Photos-library integration.

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
| `Ctrl/Cmd Shift E` | Export |
| `I`, `?` | Photo information, shortcut help |

## Verification

The production build is verified with `yarn build` (Turborepo: `tsc -b` for the workspace packages, then Vite for the app) and `yarn typecheck`. A browser automation runner is not included. For a quick interactive smoke test, run `yarn dev`, open the printed local URL, then change exposure, undo/redo it, select a preset, drag the comparison divider, crop a photo, import an image, export it, then reload to verify persistence of the sample library.