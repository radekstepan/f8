# Architecture

How f/8 is built. This file holds the deep technical notes that used to live in the README.

## Workspaces

| Workspace | Responsibility |
| --- | --- |
| `apps/web` (`@f8/web`) | Vite application: workspace composition, keyboard shortcuts, import, and styles. Library state comes from the server. |
| `apps/server` (`@f8/server`) | Local library server: SQLite catalog, referenced originals, SHA-256 identity, edit recipes, and preview cache. Serves the production web build when present. |
| `packages/core` (`@f8/core`) | Framework-free editor logic: typed models, sample library, presets, the image pipeline, and the library HTTP client. |
| `packages/ui` (`@f8/ui`) | React components, the `useEditor` history hook, the `useLibrary` server hook, and shared UI utilities. Depends on `@f8/core`. |

## Key files

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
| `packages/core/src/libraryUrl.ts` | Shareable URL scheme: path parsing/building for album and photo deep-links. |
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

## Build notes

The production build keeps the single-file main bundle but emits the vision worker separately. `vite-plugin-singlefile` runs with `useRecommendedBuildConfig: false` because its `inlineDynamicImports` cannot carry module workers; `apps/web/vite.config.ts` replicates that recommended config minus inlining, so `dist/index.html` still embeds the app JS/CSS while the worker ships alongside it:

- `dist/vision.worker-*.js` (~1KB): the worker shell, spawned only when a vision feature starts it.
- `dist/opencv-*.js` (~15MB): OpenCV, fetched lazily by the worker on first use — never in the initial page load.
- `dist/ort-*.js` (tens of KB each): ONNX Runtime Web per-engine JS (wasm backend for LaMa, WebGPU backend for Moebius), fetched lazily by the worker on the first ML Heal only. The `.wasm` backends live in `dist/ort/` (copied from `node_modules` by `vite-plugin-static-copy`, never committed). Model weights load from HuggingFace once and persist in Cache Storage: LaMa (~208MB, Balanced) or Moebius diffusion (~1.3GB, Best).

The `@techstark/opencv-js` build is single-file (its WASM is embedded as base64), so there is no separate `.wasm` asset to serve. Heavy vision entry points must keep this shape: construct the worker via `new Worker(new URL(..., import.meta.url))`, import OpenCV only inside the worker, and never import it from main-thread code. The one exception is Node-only: `@f8/core` lists the package as a devDependency so the inpaint golden tests can run real `cv.inpaint` outside the browser; test files are never shipped in the app bundle. A networked `yarn install` fetches the package from the npm registry.

## Library server

`apps/server` is the library backend. It binds to localhost without authentication (single-user, this device only) and stores its catalog in `apps/server/data/f8.db` (SQLite, WAL mode) with extracted RAW previews alongside it.

- **Referenced originals.** Folder import (`File → Import from Folder…`, or `Ctrl/⌘ Shift O`) records a file's absolute path and never copies bytes. Uploads (picker or drag and drop) cannot see your paths — browsers hide them — so the server first stores them under `~/Pictures/f8/YYYY/MM/` and references them from there.
- **Hash identity.** Every original is SHA-256 hashed at import. Reimporting a moved file relinks it to its record (edits intact); reimporting the same bytes anywhere reports a duplicate instead of a second record.
- **Folder albums.** A folder import files each folder into its own album, named from the folder ("2026-europe-trip" becomes "2026 Europe Trip") and reused on reimport; importing while viewing an album files into that album instead. A local folder picked via `File → Import Folder as Album…` or dropped onto the app uploads the same way, into a new album named from the folder.
- **Missing files.** A photo whose file is gone shows a Missing badge; opening it offers to locate the original, and any folder import that finds the bytes heals it automatically.
- **Non-destructive edits.** The original is never written to. Each photo keeps one edit recipe in SQLite, saved ~500ms after each change, plus a persisted action stack recording every applied Auto adjustment with the snapshot its revert restores — so each Auto stays individually revertible across a hard reload. Only the undo/redo stacks stay session-only.
- **RAW decoding.** Camera RAW files are decoded at full sensor resolution at import (LibRaw with camera white balance, sRGB output, JPEG quality 92), so the library shows and edits true RAW dimensions — e.g. a 24MP Sony ARW imports as 4024×6024. Requires `dcraw_emu` (`brew install libraw`, or `apt install libraw-bin` on Linux) plus a JPEG encoder (`magick`, `convert`, or macOS `sips`). A file that cannot be decoded fails its import with the reason (missing toolchain, corrupt file, timeout) instead of entering the library as a low-res preview.
- **Samples.** The first boot seeds the twelve sample photos as URL records (no local bytes, never missing), with photo-1 starting on the Natural preset.

The API contract lives in `packages/core/src/library.ts` (`LibraryPhoto`, `LibrarySnapshot`, `createLibraryClient`), so scripts and alternative clients can share it.

Best runs full diffusion on the server CPU (~45s per repair area on M1 Pro: ~4s VAE encode, ~3.7s per denoise step × 9, ~8s VAE decode). While it runs, the terminal shows per-stage timing (`[ml-heal] moebius step 3/9 …`) plus one line per API call, and the repair bar polls live step progress instead of sitting still.

### Configuration

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

## Persistence and privacy

Photos, edits, favorites, ratings, albums, and custom presets live in the server's SQLite database, as does each photo's auto-action stack (every applied Auto plus its revert snapshot); only undo/redo history is session-only. The browser keeps no photo state — everything survives reloads, and edits reapply to the referenced originals every time.

Views are deep-linkable path URLs: `/album/<id>` opens an album grid and `/photo/<id>/<tool>` opens a photo in an editing tool (`adjust`, `crop`, or `repair`), so any view survives a reload and can be shared as a link. Legacy `?photo=` / `?album=` links still open and are rewritten to the path form.

Everything stays on your machine: the server binds to localhost, originals stay in your folders, and nothing is uploaded anywhere. Remote sample images and the optional Inter font require an internet connection.
