# Features

The full function catalogue of f/8. The README lists the same functions in short form.

## Library

- Twelve sample photographs, three albums, favorites, star ratings, search, smart collections, and a resizable photo grid.
- Functional application menus, keyboard shortcuts, photo information, album creation, preset creation, and help dialogs.
- Collapsible workspace panels, a mobile bottom-sheet inspector, visible focus states, focus-trapped dialogs, and reduced-motion support.

## Adjust

- Fourteen built-in presets across Essentials, Cinematic, and Black & White, plus persistent custom presets.
- Live temperature, tint, lightness, hue, saturation, vibrance, detail, tone, grain, vignette, and fade adjustments.
- Editable numeric values, keyboard-accessible sliders, per-section header toggles (toggling on applies the suggested change, toggling off resets to defaults — hand tweaks light the toggle too), and double-click slider resets (every slider but Curves' Midtones, which resets from its header reset like the other manual sections).
- A tone-curve editor: click the curve to add control points (up to sixteen), drag them to reshape, Shift-click, right-click, or Delete to remove; the Curves header reset clears points and Midtones together.
- A live RGB histogram derived from the rendered image.
- One-click Enhance (histogram-based) and Auto Scene Enhance: an on-device scene classifier (portrait / landscape / night / document) picks per-scene enhance parameters over the 160px analysis image — portraits protect skin tones, landscapes allow stronger contrast. Available from the Image menu, the inspector, the Shift+A shortcut, or a photo's right-click menu; the result always labels the detected scene and confidence.
- ML Enhance Faces: a small YuNet face detector (~227KB, photo server, cached for offline use) finds faces with eye landmarks, then anchors white balance on face skin tones, lifts underexposed faces through a softly masked exposure recipe, and suppresses flash red-eye pupils. Available from the Image menu, the inspector, the Shift+E shortcut, or a photo's right-click menu; results always say whether ML or the classical fallback served.
- ML Enhance Subject & Background: a small U²-Net portrait segmenter (~4.6MB, photo server, cached for offline use) finds the subject and stores the mask immediately — no apply step. Separate live exposure/contrast/saturation sliders for the subject side and the background side preview on the photo as you drag and save automatically with the recipe; rescanning swaps the mask but keeps your slider values. Available from the inspector's adjust tool with an ML badge, and results always say whether ML or the classical fallback served.
- Copy/paste adjustments between photographs, with each photograph's crop and retouching preserved.

## Search and cull

- Local semantic search / smart albums: CLIP-image embeddings are computed on the photo server at import and stored in the SQLite catalog, so searching "beach" or "dog" ranks photos by visual similarity with no cloud. There is nothing to train or retrain: the model is a frozen pretrained CLIP encoder and every import is embedded automatically in the background (the server API can still backfill photos that arrived before the weights did). Labels show in each photo's info dialog with ML badges, can be added or removed by hand, and double as smart albums — clicking one searches for it. Open-vocabulary queries fall back to local keyword matching over labels and metadata.
- ML import-time cull assist: blur detection (classical Laplacian) and near-duplicate grouping (perceptual hash) run on the photo server at import and are cached per file, so a file is never checked twice. Only problems are flagged — sharp photos carry no badge. Matches get ML badges on the grid, a Cull status filter narrows to blurry, and every flag can be added or removed by hand in the info dialog.

## Denoise

- ML lightweight denoise: a small DnCNN color-blind denoiser (~2.6MB, photo server, cached for offline use) cleans high-ISO shots behind a strength slider and a header toggle that drafts the EXIF-ISO suggestion (ISO 1600+ starts at the suggestion; the slider always stays editable for fine-tuning, which clears the auto mark). The slider is a draft — Preview shows it on a ≤512px downsample first as a before/after plus a 4× closeup below in the same panel (click the preview to move it), then Apply denoises at up to 2048px as the canvas and export base; the recipe keeps only the strength, so reopening offers a one-click restore. Available from the inspector's Denoise section; Compare (B in the toolbar) toggles the noisy original against the clean photo, and results always say whether ML or the classical fallback served.

## History and compare

- Per-photo undo/redo with up to fifty history entries. Consecutive slider changes are grouped into a single edit.
- Draggable before/after comparison and hold-to-preview-original behavior.
- Zoom-in-view magnifier: a View-menu submenu under the Show items (4x/8x/16x, 8x default on Z) that previews the cursor region in a fixed corner pane in photo view, matching the Compare split and showing the repair brush circle when the magnified brush fits the pane.

## Crop and repair

- Centered aspect-ratio cropping, rotation, flips, and straightening with automatic horizon detection, plus a rule-of-thirds overlay.
- Browser-based repair brushes (texture-transplant Heal by default with Fast/Balanced/Best search effort, tiered on-device ML Heal — Fast reuses classic Heal instantly, Balanced runs LaMa neural fill, Best runs Moebius diffusion with automatic fallback — OpenCV Telea/Navier-Stokes on request, blur fallback) and clone stamping. Click to choose a clone source; Alt-click to choose another. The Repair tool also offers one-click ML people removal: a small YOLOv8n detector (~12MB, photo server, cached for offline use) finds people, you confirm which ones, and the current repair method heals them. It also offers auto dust-spot detection: classical blob candidates plus a tiny false-positive classifier (photo server, no download) propose dust spots that you accept per spot before the current repair method heals them.

## Import and export

- Photo import using a file picker, drag and drop (loose files or whole folders), or in-place folder import, including camera RAW files (decoded at full sensor resolution on the server via LibRaw — there is no low-res fallback, so a file that cannot be decoded fails its import with the reason instead of entering the library). When a RAW file and a JPEG share a filename, only the RAW is imported. Content hashing dedupes reimports and relinks moved files with their edits intact.
- JPEG, PNG, and WebP export, configurable size and quality, plus JSON adjustment export. The export dialog offers ML super-resolution 2x: a Real-ESRGAN x2plus upscaler (~64MB, photo server, cached for offline use) doubles export dimensions with live tile progress and cancel; also available from a photo's right-click menu, which opens the dialog pre-checked. 2x is ML-only: without weights the export fails with the reason shown (no classical fallback) — `yarn setup` prefetches the weights.

## Shortcuts

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

## Boundaries

- The classic Enhance control and the per-section header toggles apply histogram-based adjustments with no machine-learning model (toggling on applies the heuristic suggestion; the ML badge by a tool's name marks the sections where a model actually runs — Enhance Faces and Subject & Background — and the denoise header toggle drafts an ISO-based suggestion rather than running the denoiser). Running Enhance also lights the White Balance, Lightness, and Hue & Saturation toggles it drove; toggling one off resets that section to defaults. The separate Auto Scene Enhance option classifies portrait / landscape / night / document on-device with a tiny logistic-regression classifier over the 160px analysis image (no download, no server) and applies per-scene parameters; its coefficients are set by inspection rather than fitted on labeled photos, so ambiguous scenes may misclassify — the detected scene and confidence always show next to the result. ML Enhance Faces detects on the source framing (boxes do not remap through rotation or crop yet), scans a 640px downsample, and caps at 20 faces per photo; red-eye fixes only fire on strongly red-dominant pupils near eye landmarks, so mild cases may need the Repair brush. ML selective adjustments segment on the source framing too (the mask does not remap through rotation or crop yet), scan a 320px downsample, and store a ≤96px mask in the recipe — soft by design, so hair-strand detail is out of reach and pasting adjustments across photos carries the mask with them. Local semantic search embeds the cached grid thumb (≤640px JPEG, as stored — sideways source pixels embed sideways, though retrieval barely notices), covers a fixed 50-concept vocabulary plus aliases and plurals (open-vocabulary queries fall back to keyword matching, saved smart albums are a follow-up), and only embeds file photos — URL samples and encoder-less thumbs skip with a per-photo reason. ML cull assist scores the same cached thumbs (classical Laplacian blur first, so hazy low-texture scenes can flag as blurry; the duplicate group-best ranker's coefficients are set by inspection, like the scene classifier), groups near-duplicates within each album only, and labels each photo at most once — hand-removed flags are never re-added. ML denoise previews on a ≤512px downsample and applies at up to 2048px on the long edge (~9s on CPU), so Original-size exports upscale the denoised base; the recipe stores only the strength, and denoise always runs on the original pixels (re-running never denoises twice). ML super-resolution 2x upscales the rendered export canvas at up to 2048px input (~8s per 600×400 tile-set on CPU, ~95s for a 2048px frame, with live tile progress and cancel), so Original-size exports over the cap need Large or smaller; the first run downloads the ~64MB weights once (`yarn setup` prefetches them) and fails with the reason shown until they land. Photos never leave the device.
- Color adjustments are lightweight browser-filter approximations, not a color-managed RAW engine. Tone, clarity, and sharpness are simplified contrast mappings.
- Repair reconstructs masked regions in a worker — Heal transplants matching nearby texture adapted to local light (default), on-device ML Heal inpaints larger removals via a locally cached ONNX model with Heal fallback, Telea or Navier-Stokes diffusion remain available — falling back to a local blur when the vision engine is unavailable. Clone copies pixels from a source region. ML weights download once (LaMa ~208MB, Moebius ~1.3GB) and are cached for offline use; opening the Repair tool prefetches the selected tier while you paint. One-click people removal detects on the source framing, so remove before rotating/cropping (detection boxes do not remap through rotation or crop yet), and people only; power lines and other classes are follow-ups. Auto dust-spot detection shares the source-framing boundary, scans a 1280px downsample (sub-pixel specks at full resolution are out of reach), and caps at 60 spots per scan. Photos never leave the device.
- Crop supports centered ratios rather than a freely movable crop rectangle. The overlay is a rule-of-thirds framing guide.
- Zoom percentages are relative to the fitted preview, not a one-to-one source-pixel scale.
- Sample camera details are illustrative. Imported photos read real EXIF camera details when present. Export does not embed the sample metadata.
- Export never upscales beyond the available source resolution.
- The backend is a local single-user server with no authentication: keep it on localhost. There is no cloud synchronization, account system, or Photos-library integration.
