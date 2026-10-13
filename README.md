# f/8

A photo-first, macOS-inspired editing workspace built with React, TypeScript, Vite, and CSS. Tailwind CSS v4 is available for extending the interface. The application starts in the editor, with an alpine photograph and a fully populated sample library.

An independent, local-first photo editor. Your library lives in a database on this computer; originals stay in your folders and are never modified.

## Running Locally

This is a Yarn workspaces + Turborepo monorepo. Use the Node version in `.nvmrc`.

- `nvm use` selects the pinned Node version.
- `yarn install` installs the dependencies.
- `yarn setup` prefetches every ML weight pack (~1.5GB, mostly the two ML Repair engines) into the server data dir, so first use never waits on — or fails from — an on-demand download. Entries already on disk are skipped; without this step each pack still downloads itself once on first use.
- `yarn dev` starts the Vite development server and the library server together (run `yarn build` once first so the workspace packages exist in `dist/`). Open the printed Vite URL (usually `http://localhost:5173`); API calls proxy to the library server at `http://127.0.0.1:5193`.
- `yarn build` builds every workspace package, then the application into `apps/web/dist/`.
- `yarn typecheck` typechecks every workspace package.
- `yarn workspace @f8/server start` serves the production build and the API from one process at `http://127.0.0.1:5193` (run `yarn build` first).
- `yarn workspace @f8/web preview` serves only the static production build (the library API stays unavailable).

## Build Notes

The production build keeps the single-file main bundle but emits the vision worker separately. `vite-plugin-singlefile` runs with `useRecommendedBuildConfig: false` because its `inlineDynamicImports` cannot carry module workers; `apps/web/vite.config.ts` replicates that recommended config minus inlining, so `dist/index.html` still embeds the app JS/CSS while the worker ships alongside it:

- `dist/vision.worker-*.js` (~1KB): the worker shell, spawned only when a vision feature starts it.
- `dist/opencv-*.js` (~15MB): OpenCV, fetched lazily by the worker on first use — never in the initial page load.
- `dist/ort-*.js` (tens of KB each): ONNX Runtime Web per-engine JS (wasm backend for LaMa, WebGPU backend for Moebius), fetched lazily by the worker on the first ML Heal only. The `.wasm` backends live in `dist/ort/` (copied from `node_modules` by `vite-plugin-static-copy`, never committed). Model weights load from HuggingFace once and persist in Cache Storage: LaMa (~208MB, Balanced) or Moebius diffusion (~1.3GB, Best).

The `@techstark/opencv-js` build is single-file (its WASM is embedded as base64), so there is no separate `.wasm` asset to serve. Heavy vision entry points must keep this shape: construct the worker via `new Worker(new URL(..., import.meta.url))`, import OpenCV only inside the worker, and never import it from main-thread code. The one exception is Node-only: `@f8/core` lists the package as a devDependency so the inpaint golden tests can run real `cv.inpaint` outside the browser; test files are never shipped in the app bundle. A networked `yarn install` fetches the package from the npm registry.

## Included Interactions

- Twelve sample photographs, three albums, favorites, star ratings, search, smart collections, and a resizable photo grid.
- Fourteen built-in presets across Essentials, Cinematic, and Black & White, plus persistent custom presets.
- Live temperature, tint, lightness, hue, saturation, vibrance, detail, tone, grain, vignette, and fade adjustments.
- Editable numeric values, keyboard-accessible sliders, section toggles, automatic adjustment examples, and double-click slider resets.
- A live RGB histogram derived from the rendered image.
- One-click Enhance (histogram-based) and ML Scene Enhance: an on-device scene classifier (portrait / landscape / night / document) picks per-scene enhance parameters over the 160px analysis image — portraits protect skin tones, landscapes allow stronger contrast. Available from the Image menu, the inspector, the Shift+A shortcut, or a photo's right-click menu; the result always labels the detected scene and confidence.
- ML Enhance Faces: a small YuNet face detector (~227KB, photo server, cached for offline use) finds faces with eye landmarks, then anchors white balance on face skin tones, lifts underexposed faces through a softly masked exposure recipe, and suppresses flash red-eye pupils. Available from the Image menu, the inspector, the Shift+E shortcut, or a photo's right-click menu; results always say whether ML or the classical fallback served.
- ML Enhance Subject & Background: a small U²-Net portrait segmenter (~4.6MB, photo server, cached for offline use) finds the subject and stores the mask immediately — no apply step. Separate live exposure/contrast/saturation sliders for the subject side and the background side preview on the photo as you drag and save automatically with the recipe; rescanning swaps the mask but keeps your slider values. Available from the inspector's adjust tool with an ML badge, and results always say whether ML or the classical fallback served.
- Local semantic search / smart albums: CLIP-image embeddings are computed on the photo server at import and stored in the SQLite catalog, so searching "beach" or "dog" ranks photos by visual similarity with no cloud. There is nothing to train or retrain: the model is a frozen pretrained CLIP encoder and every import is embedded automatically in the background (the server API can still backfill photos that arrived before the weights did). Labels show in each photo's info dialog with ML badges, can be added or removed by hand, and double as smart albums — clicking one searches for it. Open-vocabulary queries fall back to local keyword matching over labels and metadata.
- ML import-time cull assist: blur detection (classical Laplacian) and near-duplicate grouping (perceptual hash) run on the photo server at import and are cached per file, so a file is never checked twice. Only problems are flagged — sharp photos carry no badge. Matches get ML badges on the grid, a Cull status filter narrows to blurry, and every flag can be added or removed by hand in the info dialog.
- ML lightweight denoise: a small DnCNN color-blind denoiser (~2.6MB, photo server, cached for offline use) cleans high-ISO shots behind a strength slider and an Auto button keyed on EXIF ISO (ISO 1600+ starts at the suggestion; the slider always stays editable for fine-tuning, which clears the auto mark). The slider is a draft — Preview shows it on a ≤512px downsample first as a before/after plus a 4× closeup below in the same panel (click the preview to move it), then Apply denoises at up to 2048px as the canvas and export base; the recipe keeps only the strength, so reopening offers a one-click restore. Available from the inspector's Denoise section; Compare (B in the toolbar) toggles the noisy original against the clean photo, and results always say whether ML or the classical fallback served.
- Per-photo undo/redo with up to fifty history entries. Consecutive slider changes are grouped into a single edit.
- Draggable before/after comparison and hold-to-preview-original behavior.
- Centered aspect-ratio cropping, rotation, flips, and straightening with automatic horizon detection, plus a rule-of-thirds overlay.
- Browser-based repair brushes (texture-transplant Heal by default with Fast/Balanced/Best search effort, tiered on-device ML Heal — Fast reuses classic Heal instantly, Balanced runs LaMa neural fill, Best runs Moebius diffusion with automatic fallback — OpenCV Telea/Navier-Stokes on request, blur fallback) and clone stamping. Click to choose a clone source; Alt-click to choose another. The Repair tool also offers one-click ML people removal: a small YOLOv8n detector (~12MB, photo server, cached for offline use) finds people, you confirm which ones, and the current repair method heals them. It also offers auto ML dust-spot detection: classical blob candidates plus a tiny false-positive classifier (photo server, no download) propose dust spots that you accept per spot before the current repair method heals them.
- Photo import using a file picker, drag and drop (loose files or whole folders), or in-place folder import, including camera RAW files (decoded at full sensor resolution on the server via LibRaw — there is no low-res fallback, so a file that cannot be decoded fails its import with the reason instead of entering the library). When a RAW file and a JPEG share a filename, only the RAW is imported. Content hashing dedupes reimports and relinks moved files with their edits intact.
- JPEG, PNG, and WebP export, configurable size and quality, plus JSON adjustment export. The export dialog offers ML super-resolution 2x: a Real-ESRGAN x2plus upscaler (~64MB, photo server, cached for offline use) doubles export dimensions with live tile progress and cancel; also available from a photo's right-click menu, which opens the dialog pre-checked. 2x is ML-only: without weights the export fails with the reason shown (no classical fallback) — `yarn setup` prefetches the weights.
- Copy/paste adjustments between photographs, with each photograph's crop and retouching preserved.
- Functional application menus, keyboard shortcuts, photo information, album creation, preset creation, and help dialogs.
- Collapsible workspace panels, a mobile bottom-sheet inspector, visible focus states, focus-trapped dialogs, and reduced-motion support.

## Project Map

| Workspace | Responsibility |
| --- | --- |
| `apps/web` (`@f8/web`) | Vite application: workspace composition, keyboard shortcuts, import, and styles. Library state comes from the server. |
| `apps/server` (`@f8/server`) | Local library server: SQLite catalog, referenced originals, SHA-256 identity, edit recipes, and preview cache. Serves the production web build when present. |
| `packages/core` (`@f8/core`) | Framework-free editor logic: typed models, sample library, presets, the image pipeline, and the library HTTP client. |
| `packages/ui` (`@f8/ui`) | React components, the `useEditor` history hook, the `useLibrary` server hook, and shared UI utilities. Depends on `@f8/core`. |

| File | Responsibility |
| --- | --- |
| `apps/web/src/App.tsx` | Workspace composition, keyboard shortcuts, import flows, and server-offline handling. |
| `apps/web/src/components/FsBrowser.tsx` | Server-folder browser for in-place import and missing-file relinking. |
| `apps/web/src/index.css` | Visual tokens, native-style controls, responsive layout, and motion. |
| `apps/server/src/app.ts` | HTTP API: library, imports, edits, albums, presets, folder browsing, and static serving. |
| `apps/server/src/importer.ts` | Hashing, EXIF metadata, full-res RAW decoding via LibRaw, dedupe/relink, and folder scanning. |
| `apps/server/src/store.ts` | Typed SQLite access: photos, edits, albums, presets. |
| `apps/server/src/db.ts` | Database open, WAL mode, and schema migrations. |
| `packages/core/src/types.ts` | Typed photo, album, preset, adjustment, and history models. |
| `packages/core/src/data.ts` | Sample library, default adjustments, built-in presets, and crop ratios. |
| `packages/core/src/image.ts` | Shared image loading, geometry, filter mapping, retouching, effects, and export. |
| `packages/core/src/library.ts` | Library API contract and framework-free HTTP client. |
| `packages/core/src/actionStack.ts` | Persisted auto-action stack: applied Autos with their revert snapshots, plus stack transitions and sanitizing. |
| `packages/ui/src/hooks/useEditor.ts` | Non-destructive per-photo edits, grouped history, server persistence, and preset application. |
| `packages/ui/src/hooks/useLibrary.ts` | Server library state: loading, uploads, folder import, and metadata. |
| `packages/ui/src/components/EditorUI.tsx` | Reusable buttons, sliders, switches, selects, menus, and accessible dialogs. |
| `packages/ui/src/components/Topbar.tsx` | Application menus, editing toolbar, and status bar. |
| `packages/ui/src/components/Tooltip.tsx` | Custom themed tooltips: `data-tooltip` triggers, one viewport-safe `TooltipHost` bubble. |
| `packages/ui/src/components/Sidebar.tsx` | Library, album navigation, search, and import entry point. |
| `packages/ui/src/components/PhotoCanvas.tsx` | Responsive canvas, histogram sampling, comparison, and pointer-based retouching. |
| `packages/ui/src/components/PhotoStrips.tsx` | Presets, filmstrip, and photo browser. |
| `packages/ui/src/components/Inspector.tsx` | Color adjustments, crop controls, and brush controls. |
| `packages/ui/src/components/EditorDialogs.tsx` | Export, metadata, album, preset, shortcut, remove-confirm, and about dialogs. |

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

`apps/server` is the library backend. It binds to localhost without authentication (single-user, this device only) and stores its catalog in `apps/server/data/f8.db` (SQLite, WAL mode) with extracted RAW previews alongside it.

- **Referenced originals.** Folder import (`File → Import from Folder…`, or `Ctrl/⌘ Shift O`) records a file's absolute path and never copies bytes. Uploads (picker or drag and drop) cannot see your paths — browsers hide them — so the server first stores them under `~/Pictures/f8/YYYY/MM/` and references them from there.
- **Hash identity.** Every original is SHA-256 hashed at import. Reimporting a moved file relinks it to its record (edits intact); reimporting the same bytes anywhere reports a duplicate instead of a second record.
- **Folder albums.** A folder import files each folder into its own album, named from the folder ("2026-europe-trip" becomes "2026 Europe Trip") and reused on reimport; importing while viewing an album files into that album instead. A local folder picked via `File → Import Folder as Album…` or dropped onto the app uploads the same way, into a new album named from the folder.
- **Missing files.** A photo whose file is gone shows a Missing badge; opening it offers to locate the original, and any folder import that finds the bytes heals it automatically.
- **Non-destructive edits.** The original is never written to. Each photo keeps one edit recipe in SQLite, saved ~500ms after each change, plus a persisted action stack recording every applied Auto adjustment with the snapshot its revert restores — so each Auto stays individually revertible across a hard reload. Only the undo/redo stacks stay session-only.
- **RAW decoding.** Camera RAW files are decoded at full sensor resolution at import (LibRaw with camera white balance, sRGB output, JPEG quality 92), so the library shows and edits true RAW dimensions — e.g. a 24MP Sony ARW imports as 4024×6024. Requires `dcraw_emu` (`brew install libraw`, or `apt install libraw-bin` on Linux) plus a JPEG encoder (`magick`, `convert`, or macOS `sips`). A file that cannot be decoded fails its import with the reason (missing toolchain, corrupt file, timeout) instead of entering the library as a low-res preview.
- **Samples.** The first boot seeds the twelve sample photos as URL records (no local bytes, never missing), with photo-1 starting on the Natural preset.

Configuration is all environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `F8_PORT` | `5193` | HTTP port. |
| `HOST` / `F8_HOST` | `127.0.0.1` | Bind address; keep localhost unless you add authentication. |
| `F8_DATA` | `apps/server/data` | Database, previews, and upload staging. |
| `F8_LIBRARY` | `~/Pictures/f8` | Where uploaded bytes land. |
| `F8_ROOTS` | `~` | Colon-separated roots the folder browser and path import may touch. |
| `F8_ML_HEAL_STEPS` | `10` | Best (Moebius) diffusion steps, 1–50. Fewer steps is near-linearly faster (~3.7s saved per step on M1 Pro) at some quality cost. |
| `F8_ML_THREADS` | ORT default | ONNX intra-op thread override. Unset measured fastest on M1 Pro; set to experiment on other machines. |
| `F8_ML_EP` | `cpu` | `coreml` opts Moebius into CoreML, but it measured ~2× slower than CPU on M1 (UNet partitioning overhead). |
| `F8_OBJECT_DETECT_URL` | Ultralytics YOLOv8n ONNX | Weight URL for one-click people removal (~12MB, AGPL-3.0). |
| `F8_OBJECT_DETECT_OFFLINE` | unset | `1` disables the YOLO download; detection serves the classical skin-tone scan instead. |
| `F8_OBJECT_DETECT_DIR` | `<data>/models/object-detect` | Where the YOLO weights are cached. |
| `F8_DUST_SPOTS_OFFLINE` | unset | `1` disables the ML false-positive filter; dust-spot detection serves classical-only candidates instead. |
| `F8_DUST_SPOTS_WEIGHTS` | embedded | Path to a JSON file with replacement classifier coefficients (`{bias, contrast, size, circularity, border}`); unreadable files fall back to the classical scan with the error in health. |
| `F8_FACE_DETECT_URL` | OpenCV Zoo YuNet 2023mar ONNX | Weight URL for ML face enhance (~227KB, Apache-2.0). |
| `F8_FACE_DETECT_OFFLINE` | unset | `1` disables the YuNet download; face detection serves the classical skin-tone scan instead. |
| `F8_FACE_DETECT_DIR` | `<data>/models/face-detect` | Where the YuNet weights are cached. |
| `F8_SELECTIVE_MASK_URL` | rembg U²-Net portrait ONNX | Weight URL for ML selective adjustments (~4.6MB, Apache-2.0). |
| `F8_SELECTIVE_MASK_OFFLINE` | unset | `1` disables the u2netp download; segmentation serves the classical face-box/skin scan instead. |
| `F8_SELECTIVE_MASK_DIR` | `<data>/models/selective-mask` | Where the u2netp weights are cached. |
| `F8_SEMANTIC_SEARCH_URL` | Xenova CLIP ViT-B/32 vision ONNX | Weight URL for local semantic search (~89MB quantized; OpenAI CLIP weights carry no separate license file, code MIT). |
| `F8_SEMANTIC_SEARCH_OFFLINE` | unset | `1` disables the CLIP download; imports skip embedding and labeling reports it honestly, while search serves keyword mode. |
| `F8_SEMANTIC_SEARCH_DIR` | `<data>/models/semantic-search` | Where the CLIP vision weights are cached. |
| `F8_DENOISE_URL` | npuscale DnCNN color-blind ONNX | Weight URL for lightweight denoise (~2.6MB, MIT). |
| `F8_DENOISE_OFFLINE` | unset | `1` disables the DnCNN download; denoise serves the classical bilateral fallback instead. |
| `F8_DENOISE_DIR` | `<data>/models/denoise` | Where the DnCNN weights are cached. |
| `F8_SUPERRES_URL` | npuscale Real-ESRGAN x2plus ONNX | Weight URL for 2x export super-resolution (~64MB, BSD-3-Clause). |
| `F8_SUPERRES_OFFLINE` | unset | `1` disables the Real-ESRGAN download; 2x exports then fail with the reason shown until weights are cached. |
| `F8_SUPERRES_DIR` | `<data>/models/superres` | Where the Real-ESRGAN weights are cached. |

Best runs full diffusion on the server CPU (~45s per repair area on M1 Pro: ~4s VAE encode, ~3.7s per denoise step × 9, ~8s VAE decode). While it runs, the terminal shows per-stage timing (`[ml-heal] moebius step 3/9 …`) plus one line per API call, and the repair bar polls live step progress instead of sitting still.

The API contract lives in `packages/core/src/library.ts` (`LibraryPhoto`, `LibrarySnapshot`, `createLibraryClient`), so scripts and alternative clients can share it.

### Change the Visual System

The primary tokens are at the top of `apps/web/src/index.css`: `--accent`, `--accent-muted`, `--muted`, `--border`, `--sidebar-width`, and `--inspector-width`. The editor uses system fonts with Inter as a web-font fallback.

## Persistence and Privacy

Photos, edits, favorites, ratings, albums, and custom presets live in the server's SQLite database, as does each photo's auto-action stack (every applied Auto plus its revert snapshot); only undo/redo history is session-only. The browser keeps no photo state — everything survives reloads, and edits reapply to the referenced originals every time.

Everything stays on your machine: the server binds to localhost, originals stay in your folders, and nothing is uploaded anywhere. Remote sample images and the optional Inter font require an internet connection.

## Demo Boundaries

- The classic Enhance control and per-section Auto buttons apply histogram-based adjustments with no machine-learning model (the Auto label marks the heuristic action — ML buttons are reserved for sections where a model actually runs, and the denoise header Auto drafts an ISO-based suggestion rather than running the denoiser). The separate ML Scene Enhance option classifies portrait / landscape / night / document on-device with a tiny logistic-regression model over the 160px analysis image (no download, no server) and applies per-scene parameters; its coefficients are set by inspection rather than fitted on labeled photos, so ambiguous scenes may misclassify — the detected scene and confidence always show next to the result. ML Enhance Faces detects on the source framing (boxes do not remap through rotation or crop yet), scans a 640px downsample, and caps at 20 faces per photo; red-eye fixes only fire on strongly red-dominant pupils near eye landmarks, so mild cases may need the Repair brush. ML selective adjustments segment on the source framing too (the mask does not remap through rotation or crop yet), scan a 320px downsample, and store a ≤96px mask in the recipe — soft by design, so hair-strand detail is out of reach and pasting adjustments across photos carries the mask with them. Local semantic search embeds the cached grid thumb (≤640px JPEG, as stored — sideways source pixels embed sideways, though retrieval barely notices), covers a fixed 50-concept vocabulary plus aliases and plurals (open-vocabulary queries fall back to keyword matching, saved smart albums are a follow-up), and only embeds file photos — URL samples and encoder-less thumbs skip with a per-photo reason. ML cull assist scores the same cached thumbs (classical Laplacian blur first, so hazy low-texture scenes can flag as blurry; the duplicate group-best ranker's coefficients are set by inspection, like the scene classifier), groups near-duplicates within each album only, and labels each photo at most once — hand-removed flags are never re-added. ML denoise previews on a ≤512px downsample and applies at up to 2048px on the long edge (~9s on CPU), so Original-size exports upscale the denoised base; the recipe stores only the strength, and denoise always runs on the original pixels (re-running never denoises twice). ML super-resolution 2x upscales the rendered export canvas at up to 2048px input (~8s per 600×400 tile-set on CPU, ~95s for a 2048px frame, with live tile progress and cancel), so Original-size exports over the cap need Large or smaller; the first run downloads the ~64MB weights once (`yarn setup` prefetches them) and fails with the reason shown until they land. Photos never leave the device.
- Color adjustments are lightweight browser-filter approximations, not a color-managed RAW engine. Tone, clarity, and sharpness are simplified contrast mappings.
- Repair reconstructs masked regions in a worker — Heal transplants matching nearby texture adapted to local light (default), on-device ML Heal inpaints larger removals via a locally cached ONNX model with Heal fallback, Telea or Navier-Stokes diffusion remain available — falling back to a local blur when the vision engine is unavailable. Clone copies pixels from a source region. ML weights download once (LaMa ~208MB, Moebius ~1.3GB) and are cached for offline use; opening the Repair tool prefetches the selected tier while you paint. One-click people removal detects on the source framing, so remove before rotating/cropping (detection boxes do not remap through rotation or crop yet), and people only; power lines and other classes are follow-ups. Auto dust-spot detection shares the source-framing boundary, scans a 1280px downsample (sub-pixel specks at full resolution are out of reach), and caps at 60 spots per scan. Photos never leave the device.
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