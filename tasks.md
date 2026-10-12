# Tasks

System instruction: Work on these tasks, make sure to add tests, but do not run playwright. Commit each result you work on with a writeup of what you changed in docs/tasks. Work on these sequentially. If you made some important decisions, add them in the writeup. If you changed architecture or introduced a new complex feature, make sure to update the documentation of this app.

## List

DSC06308.ARW is a portrait photo but shows landscape in album and in presents and film strip below the photo. Make sure that making the photo portrait will look seamless in album with landscape photos.

The film strip should have a vertical scrollbar if we have more photos

Hints disappear after 2.5s + 0.5, increase it to 5s so we have a chance to read them

Remove from library button should be bottom right, and make sure we have this action on the photo view as well
Be able to remove a whole album and not just a photo. Perhaps onhover show ... and a menu in the sidebar and top of the album view somewhere

Sort album by filename or time imported or datetime captured

When we open a photo and scroll to it in the footer, try to place the photo in the middle of the footer, meaning right now we scroll to it and it's always to the right, but I'd like to make it easy to see if there are other photos after it.

Implement ML feature - **One-click object removal.** Biggest unlock with zero new infra: add a small detector/segmenter (e.g. YOLO-NAS-class or MobileSAM ONNX, tens of MB) whose mask feeds the existing LaMa/Moebius ROI pipeline. "Remove people / power lines" becomes detect → mask → inpaint. Say it's ML, have a label for it.

Implement ML feature - *Auto dust/spot detection for repair.** Classical blob candidates plus a tiny false-positive classifier; surface as suggested repair masks the user accepts per spot. Reuses the whole heal stack. Say it's ML.

Implement ML feature - **Subject-aware auto-enhance.** A tiny scene classifier (portrait / landscape / night / document) picks per-scene enhance parameters instead of one fixed patch — portrait protects skin tones, landscape allows stronger contrast. Runs on the existing 160px analysis image. We already have enhance, maybe add this to context menu. Make sure to say it's ML.

Implement ML feature - **Face-aware exposure / white balance.** Face detection (small ONNX, e.g. YuNet/SCRFD-tiny) anchors WB on skin tones and lifts underexposed faces; also enables **auto red-eye removal** (face + eye landmarks). Make sure to say it's ML.

Implement ML feature - **Selective (masked) adjustments.** Person/background segmentation (BiRefNet-lite / MODNet-class, server-side) enables "brighten subject only" — the most-requested-adjustment-shaped gap once global enhance exists. Mask plugs into the existing mask-composite pattern.  Make sure to say it's ML.

Implement ML feature - **Local semantic search / smart albums.** CLIP-image embeddings computed server-side at import, stored in the SQLite catalog: search "beach" or "dog" with no cloud. Privacy story stays intact; cost is import-time, amortized, and skippable offline. Do this from album context menu to label files that haven't been labeled yet.

Implement ML feature - **Import-time cull assist.** Blur detection (classical Laplacian first), near-duplicate grouping (perceptual hash), and optionally a tiny aesthetic scorer flag the keepers when importing hundreds of photos. Directly serves the import-progress pain in tasks 08/09. From context menu on album be able to look for blurs and label such files with an icon and be able to filter for them. Be able to custom remove the label too. Do not re-detect the same file 2x.

**Lightweight denoise for high-ISO shots.** A small learned denoiser (e.g. NAFNet-tiny ONNX) behind a new adjust slider or an auto toggle keyed on EXIF ISO. Server-side; preview on downsample first. Be able to run on a photo.

**Export-time super-resolution.** Real-ESRGAN-tiny ONNX as an export option ("Export 2x"). Slow on CPU but export is already wait-tolerant, unlike interactive editing. Context menu option on export with progress.
