import { isNeutralEdit, renderAdjustedPixels } from './adjustments.js';
import { CROP_RATIOS, DEFAULT_EDIT } from './data.js';
import type { EditState, RetouchPoint } from './types.js';
import type { PixelImage } from './vision/analyze.js';
import type { HealProgress, HealQuality } from './vision/heal.js';
import { INPAINT_DEFAULT_METHOD, INPAINT_DILATE_PX, blendInpainted, dilateRepairMask, featherRepairMask, hasRepairStrokes, inpaintRadiusForStrokes, rasterizeRepairMask, resolveFeatherPx } from './vision/inpaint.js';
import type { InpaintMethod, RepairMask } from './vision/inpaint.js';
import type { MlHealEngine } from './vision/ml-heal.js';
import type { VisionWorkerStatus } from './vision/worker-client.js';
import { groupRetouchStrokes } from './retouch.js';
import {
  geometryKeyForHealCache,
  healSingleGroup,
  partitionHealGroups,
  pasteHealPatches,
  repairedBaseForHealJob,
  reusableOverlayForGroup,
  signatureForHealGroup,
  type CachedHealPatch,
  type StoredHealPatch,
} from './vision/heal-cache.js';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => { imageCache.delete(src); reject(new Error('This photo could not be loaded. Check your connection and try again.')); };
      image.src = src;
    }));
  }
  return imageCache.get(src)!;
}

// Fire-and-forget neighbor preload: warms the browser HTTP cache and the
// decode cache above, so the next arrow step finds its photo ready. Never
// throws or rejects — a failed preload just means that photo loads on demand
// like before. Empty srcs are skipped.
export function preloadImages(srcs: readonly string[]): void {
  for (const src of srcs) {
    if (!src) continue;
    loadImage(src).catch(() => undefined);
  }
}

export interface ImportSize {
  width: number;
  height: number;
}

// True when the stored (upright) dimensions are portrait. The album grid,
// presets strip, and filmstrip share this so a portrait photo renders
// portrait everywhere. Square and unknown (0×0) read as landscape, so only
// true portraits change layout.
export function isPortraitPhoto(photo: { width: number; height: number }): boolean {
  return photo.height > photo.width;
}

// Frame aspect (width / height) the editor canvas will paint for this photo
// under the given geometry, predicted from the stored upright dimensions —
// the same recipe geometryCanvas applies to the decoded pixels (quarter-turn
// swaps dimensions, the crop ratio fits inside, straighten/flips keep the
// output size). The editor frame uses this while the full-res image decodes
// so the album-thumbnail preview already sits at the final size and the
// frame never resizes when the canvas lands. Falls back when the stored
// dimensions are unusable (0, negative, non-finite); callers pass the last
// measured aspect to keep the previous frame instead of jumping.
export function frameAspectForPhoto(
  photo: { width: number; height: number },
  edit: Pick<EditState, 'rotation' | 'cropRatio'>,
  fallback = 1200 / 627,
): number {
  const { width, height } = photo;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
  const rotated = Math.abs(edit.rotation % 180) === 90;
  let frameWidth = rotated ? height : width;
  let frameHeight = rotated ? width : height;
  const ratio = CROP_RATIOS[edit.cropRatio];
  if (ratio) {
    if (frameWidth / frameHeight > ratio) frameWidth = frameHeight * ratio;
    else frameHeight = frameWidth / ratio;
  }
  const aspect = frameWidth / frameHeight;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : fallback;
}

// Decode an imported file with the browser's own EXIF handling so portrait
// phone photos report upright dimensions. The returned size is orientation 1;
// every later decode of the same blob URL (<img> auto-orients for display)
// sees the same upright pixels, so the rest of this pipeline must not rotate
// for EXIF again. Falls back to <img> when createImageBitmap is unavailable
// or rejects the options argument (older decoders).
export async function decodeImportSize(file: Blob, fallbackSrc: string): Promise<ImportSize> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch { /* Fall through to the <img> decode below. */ }
  }
  const image = await loadImage(fallbackSrc);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

// Decode to a small pixel buffer for analysis (histograms, auto-enhance).
// Throws if the image cannot be decoded or its pixels are unreadable
// (e.g. a canvas tainted by missing CORS headers); callers must catch
// and fall back instead of breaking the editor.
export async function decodeDownsampled(src: string, maxDimension = 160): Promise<PixelImage> {
  const image = await loadImage(src);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8ClampedArray(pixels.data) };
}

// Fast CSS approximation of the adjustments, used only for small thumbnails
// (preset strip, export dialog preview) where a full pixel render per thumb
// is wasteful. The editor canvas and export use renderAdjustedCanvas, which
// applies every slider per pixel (tonal masks, vibrance, hue, clarity,
// sharpness) via adjustments.ts. Not a RAW or machine-learning engine.
export function getPhotoFilter(edit: EditState): string {
  const brightness = edit.lightnessEnabled
    ? Math.max(0.08, Math.pow(2, edit.exposure * 0.6) * (1 + edit.brightness / 100) * (1 + edit.shadows / 650 + edit.highlights / 1000)) : 1;
  const contrast = edit.lightnessEnabled ? Math.max(0.1, 1 + edit.contrast / 125 - edit.blacks / 400 + edit.curve / 250) : 1;
  const saturation = edit.colorEnabled ? Math.max(0, 1 + (edit.saturation + edit.vibrance * 0.6) / 100) : 1;
  const warmth = edit.whiteBalanceEnabled ? (edit.temperature - 5500) / 14000 : 0;
  const hue = (edit.whiteBalanceEnabled ? edit.tint / 4 - warmth * 24 : 0) + (edit.colorEnabled ? edit.hue : 0);
  const detailContrast = edit.detailsEnabled ? edit.clarity / 350 + edit.sharpness / 700 : 0;
  return `brightness(${brightness}) contrast(${Math.max(0.05, contrast + detailContrast)}) saturate(${saturation}) sepia(${Math.max(0, warmth)}) hue-rotate(${hue + Math.min(0, warmth) * 50}deg) grayscale(${edit.blackAndWhite ? 1 : 0})`;
}

// Identity filter string for the default recipe, computed once: thumbnails
// whose recipe renders identically to the original get no inline style.
const DEFAULT_PHOTO_FILTER = getPhotoFilter(DEFAULT_EDIT);

/**
 * CSS filter making an album-grid or filmstrip thumbnail approximate the
 * photo's latest edits (the same approximation as the preset strip and the
 * export preview). The live session edit wins over the last persisted
 * recipe, so a thumbnail never lags the save debounce; geometry (crop,
 * rotation, straighten, flips) and repair strokes have no CSS equivalent
 * and are not reflected. Returns undefined when the thumbnail matches the
 * original, so callers render a plain <img> with no style cost.
 */
export function thumbnailFilterForPhoto(
  photo: { edit?: EditState | null },
  liveEdit?: EditState | null,
): string | undefined {
  const edit = liveEdit ?? photo.edit ?? undefined;
  if (!edit) return undefined;
  const filter = getPhotoFilter(edit);
  return filter === DEFAULT_PHOTO_FILTER ? undefined : filter;
}

// The input image is already upright (orientation 1): imports are decoded
// with imageOrientation: "from-image" and <img> auto-orients EXIF for
// display. Only user edits (rotation/flips/straighten) transform here;
// applying EXIF orientation again would double-rotate portrait photos.
export function geometryCanvas(image: HTMLImageElement, edit: EditState, maxSize = 1800): HTMLCanvasElement {
  const rotated = Math.abs(edit.rotation % 180) === 90;
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const rotatedCanvas = document.createElement('canvas');
  rotatedCanvas.width = rotated ? height : width;
  rotatedCanvas.height = rotated ? width : height;
  const ctx = rotatedCanvas.getContext('2d')!;
  ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  ctx.rotate((edit.rotation + edit.straighten) * Math.PI / 180);
  ctx.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  const straightenScale = 1 + Math.abs(Math.sin(edit.straighten * Math.PI / 180)) * Math.max(width / height, height / width);
  ctx.scale(straightenScale, straightenScale);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);

  const ratio = CROP_RATIOS[edit.cropRatio];
  let cropWidth = rotatedCanvas.width;
  let cropHeight = rotatedCanvas.height;
  if (ratio) {
    if (cropWidth / cropHeight > ratio) cropWidth = cropHeight * ratio;
    else cropHeight = cropWidth / ratio;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cropWidth);
  canvas.height = Math.round(cropHeight);
  const output = canvas.getContext('2d')!;
  output.drawImage(rotatedCanvas, (rotatedCanvas.width - cropWidth) / 2, (rotatedCanvas.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

  if (edit.retouches.length) {
    const source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    source.getContext('2d')!.drawImage(canvas, 0, 0);
    for (const point of edit.retouches) {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      const radius = point.size * canvas.width / 2;
      output.save();
      output.beginPath();
      output.arc(x, y, radius, 0, Math.PI * 2);
      output.clip();
      output.globalAlpha = point.strength / 100;
      output.filter = `blur(${Math.max(2, radius / 3)}px)`;
      output.drawImage(source, 0, 0);
      output.restore();
    }
  }
  return canvas;
}

export function drawEffects(ctx: CanvasRenderingContext2D, width: number, height: number, edit: EditState) {
  if (edit.fade > 0) {
    ctx.fillStyle = `rgba(212, 205, 190, ${edit.fade / 230})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (edit.vignette > 0) {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.15, width / 2, height / 2, Math.max(width, height) * 0.65);
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(1, `rgba(0, 0, 0, ${edit.vignette / 100})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  if (edit.grain > 0 && edit.detailsEnabled) {
    const pixels = ctx.getImageData(0, 0, width, height);
    let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = ((seed / 4294967296) - 0.5) * edit.grain * 0.6;
      pixels.data[i] = (pixels.data[i] ?? 0) + noise;
      pixels.data[i + 1] = (pixels.data[i + 1] ?? 0) + noise;
      pixels.data[i + 2] = (pixels.data[i + 2] ?? 0) + noise;
    }
    ctx.putImageData(pixels, 0, 0);
  }
}

/** Per-call options for repair inpainting; quality only affects heal. */
export interface RunInpaintOptions {
  quality?: HealQuality;
  seamlessLight?: boolean;
  /** Blend feather in px; omitted means the BLEND_FEATHER_PX default. */
  featherPx?: number;
  /** Number of repair areas covered by this run (for progress copy). */
  areas?: number;
  /**
   * Position of this call inside a serial multi-group job (0-based). When
   * set with total > 1, the transport maps per-group fractions to aggregate
   * progress and only the last group may report terminal "Repair done" —
   * otherwise every group flashes "done" and the areas copy flickers.
   */
  aggregate?: { index: number; total: number };
  onProgress?: HealProgress;
  /** Per-request ceiling in ms; steady progress re-arms it. */
  timeoutMs?: number;
}

/**
 * Worker transport for repair inpainting, injected by the app (core never
 * touches the worker directly). Resolves to the reconstructed RGBA image.
 */
export type RunInpaint = (
  image: PixelImage,
  mask: RepairMask,
  radius: number,
  method: InpaintMethod,
  options?: RunInpaintOptions,
) => Promise<PixelImage>;

/** UI-facing repair binding: the chosen algorithm and quality, worker transport, and engine readiness. */
export interface RepairInpaintBinding {
  method: InpaintMethod;
  quality: HealQuality;
  seamlessLight: boolean;
  featherPx: number;
  status: VisionWorkerStatus;
  run: RunInpaint;
  /** Engine the current ML Heal tier resolves to (absent for non-ML methods). */
  mlEngine?: MlHealEngine;
  /** True while ML weights/sessions are being prefetched; strokes should wait. */
  mlWarming?: boolean;
  /** True when the current ML engine is warmed and strokes may paint. */
  mlReady?: boolean;
}

/**
 * Reconstruct the canvas's repair strokes with worker reconstruction
 * (ml-heal by default, heal or Telea/NS on request) instead of the blur fallback in
 * geometryCanvas. Reads the canvas pixels, rasterizes the repair mask at
 * canvas resolution, runs the injected worker call, and composites the
 * result back honoring per-stroke strength. The composite mask is feathered
 * so edges leave no seam; for diffusion methods it is also dilated by the
 * same amount as the worker's fill region so fringe reconstruction is kept.
 * Returns false when there is nothing to inpaint; transport errors propagate
 * so the caller can fall back to the blur repair.
 */
export async function applyInpaintRepair(
  canvas: HTMLCanvasElement,
  points: RetouchPoint[],
  method: InpaintMethod,
  runInpaint: RunInpaint,
  options?: RunInpaintOptions,
): Promise<boolean> {
  if (!hasRepairStrokes(points)) return false;
  const width = canvas.width;
  const height = canvas.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return false;
  const mask = rasterizeRepairMask(points, width, height);
  if (!mask.data.some((value) => value > 0)) return false;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.getImageData(0, 0, width, height);
  const source: PixelImage = { width, height, data: pixels.data };
  const filled = await runInpaint(source, mask, inpaintRadiusForStrokes(points, width), method, options);
  const featherPx = resolveFeatherPx(options?.featherPx);
  const blendMask = method === 'heal' || method === 'ml-heal'
    ? featherRepairMask(mask, featherPx)
    : featherRepairMask(dilateRepairMask(mask, INPAINT_DILATE_PX), featherPx);
  const blended = blendInpainted(source, filled, blendMask);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(blended.data), width, height), 0, 0);
  return true;
}

export interface ExportRepairOptions {
  /** Inpaint algorithm; defaults to INPAINT_DEFAULT_METHOD (ML Repair). */
  method?: InpaintMethod;
  /** Worker transport; when absent, repairs render with the blur fallback. */
  runInpaint?: RunInpaint;
  /** Heal effort preset; omitted means "balanced". Diffusion ignores it. */
  quality?: HealQuality;
  /** Harmonic light adaptation for single-offset heal; omitted means false. */
  seamlessLight?: boolean;
  /** Blend feather in px; omitted means the BLEND_FEATHER_PX default. */
  featherPx?: number;
  /**
   * Persisted per-group overlays (from GET heal-overlays). Reusable groups
   * composite directly — even across export resolutions via rescaling — so
   * export only heals groups with no valid overlay instead of everything.
   */
  healOverlays?: readonly StoredHealPatch[];
}

// Rebase a stored overlay onto a canvas of a different size: same blended
// pixels, rescaled bbox. Exact-size overlays pass through with a fresh
// signature; anything else needs DOM canvas scaling (null outside
// browsers). Overhang survives the rescale: the paste clips to the visible
// intersection.
function rebaseOverlayToCanvas(
  overlay: StoredHealPatch,
  signature: string,
  canvasWidth: number,
  canvasHeight: number,
): CachedHealPatch | null {
  if (overlay.canvasWidth === canvasWidth && overlay.canvasHeight === canvasHeight) {
    return { signature, x0: overlay.x0, y0: overlay.y0, width: overlay.width, height: overlay.height, data: overlay.data, resampleDeg: overlay.resampleDeg };
  }
  if (typeof document === "undefined") return null;
  if (overlay.width <= 0 || overlay.height <= 0) return null;
  const scaleX = canvasWidth / overlay.canvasWidth;
  const scaleY = canvasHeight / overlay.canvasHeight;
  const x0 = Math.round(overlay.x0 * scaleX);
  const y0 = Math.round(overlay.y0 * scaleY);
  const width = Math.max(1, Math.round(overlay.width * scaleX));
  const height = Math.max(1, Math.round(overlay.height * scaleY));
  try {
    const src = document.createElement("canvas");
    src.width = overlay.width;
    src.height = overlay.height;
    src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(overlay.data), overlay.width, overlay.height), 0, 0);
    const dst = document.createElement("canvas");
    dst.width = width;
    dst.height = height;
    dst.getContext("2d")!.drawImage(src, 0, 0, width, height);
    const scaled = dst.getContext("2d")!.getImageData(0, 0, width, height);
    return { signature, x0, y0, width, height, data: new Uint8ClampedArray(scaled.data), resampleDeg: overlay.resampleDeg };
  } catch {
    return null;
  }
}

// Resolve the geometry canvas, preferring worker inpainting for repair
// strokes and falling back to the blur repair when the worker is unavailable,
// fails, or times out: export must never fail because of the vision engine.
async function geometryForExport(
  image: HTMLImageElement,
  edit: EditState,
  maxSize: number,
  repair?: ExportRepairOptions,
  photoSrc?: string,
): Promise<HTMLCanvasElement> {
  const repairs = edit.retouches.filter((point) => point.kind === 'repair');
  if (!repairs.length || !repair?.runInpaint) return geometryCanvas(image, edit, maxSize);
  const method = repair.method ?? INPAINT_DEFAULT_METHOD;
  const runInpaint = repair.runInpaint;
  const clean = geometryCanvas(
    image,
    { ...edit, retouches: [] },
    maxSize,
  );
  // Group-overlay path (heal + ml-heal): reusable saved patches composite
  // directly and only missing groups hit the transport — against the
  // repaired-so-far base, the same pixels as the preview — and reopened
  // photos export without rehealing. Reuse ignores
  // the current method/quality/feather so mixed-method photos export their
  // saved pixels verbatim; only groups with no overlay heal now. Other
  // methods keep the single full-pass path below.
  if ((method === 'heal' || method === 'ml-heal') && repair.healOverlays?.length) {
    try {
      const width = clean.width;
      const height = clean.height;
      const cacheParams = {
        method,
        quality: repair.quality,
        seamlessLight: repair.seamlessLight,
        featherPx: repair.featherPx,
        geometryKey: geometryKeyForHealCache(photoSrc ?? image.src, edit, width, height),
      };
      const groups = groupRetouchStrokes(repairs).filter((group) => group.kind === 'repair');
      const cache = new Map<number, CachedHealPatch>();
      for (const group of groups) {
        const overlay = reusableOverlayForGroup(repair.healOverlays, group, cacheParams);
        if (!overlay) continue;
        const rebased = rebaseOverlayToCanvas(overlay, signatureForHealGroup(group, cacheParams), width, height);
        if (rebased) cache.set(group.id, rebased);
      }
      if (cache.size) {
        const { valid, dirty } = partitionHealGroups(repairs, cache, cacheParams, width, height);
        const ctx = clean.getContext('2d')!;
        const pixels = ctx.getImageData(0, 0, width, height);
        const source = { width, height, data: new Uint8ClampedArray(pixels.data) };
        const validPatches = valid.flatMap((group) => {
          const entry = cache.get(group.id);
          return entry ? [entry] : [];
        });
        // Stacked sourcing, mirroring the preview queue: dirty groups heal
        // against the repaired-so-far image — saved patches plus each group
        // this loop already finished — never the pristine base alone.
        let healSource = repairedBaseForHealJob(source, validPatches);
        const fresh: CachedHealPatch[] = [];
        for (let dirtyIndex = 0; dirtyIndex < dirty.length; dirtyIndex += 1) {
          const group = dirty[dirtyIndex]!;
          try {
            const patch = await healSingleGroup(healSource, group, method, runInpaint, {
              quality: repair.quality,
              seamlessLight: repair.seamlessLight,
              featherPx: repair.featherPx,
              areas: dirty.length,
              aggregate: { index: dirtyIndex, total: dirty.length },
            });
            if (patch) {
              fresh.push(patch);
              healSource = pasteHealPatches(healSource, [patch]);
            }
          } catch {
            // This group keeps the blur fallback; others still upgrade.
          }
        }
        const patches = [...validPatches, ...fresh];
        if (patches.length) {
          const composited = pasteHealPatches(source, patches);
          ctx.putImageData(new ImageData(new Uint8ClampedArray(composited.data), width, height), 0, 0);
          return clean;
        }
      }
    } catch {
      // Fall through to the full-pass path below.
    }
  }
  try {
    const applied = await applyInpaintRepair(clean, repairs, repair.method ?? INPAINT_DEFAULT_METHOD, repair.runInpaint, { quality: repair.quality, seamlessLight: repair.seamlessLight, featherPx: repair.featherPx });
    return applied ? clean : geometryCanvas(image, edit, maxSize);
  } catch {
    return geometryCanvas(image, edit, maxSize);
  }
}

// The preview and exported image share this pixel pipeline: geometry first,
// then every color/detail slider, then the overlay effects in drawEffects.
// Neutral edits skip the pixel pass; unreadable (CORS-tainted) canvases fall
// back to the CSS approximation so a blocked readback degrades the look
// instead of breaking the editor or export.
export function renderAdjustedCanvas(base: HTMLCanvasElement, edit: EditState): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = base.width;
  output.height = base.height;
  const ctx = output.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  if (isNeutralEdit(edit)) return output;
  try {
    const pixels = ctx.getImageData(0, 0, output.width, output.height);
    const rendered = renderAdjustedPixels({ width: output.width, height: output.height, data: pixels.data }, edit);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rendered.data), output.width, output.height), 0, 0);
  } catch {
    ctx.filter = getPhotoFilter(edit);
    ctx.drawImage(base, 0, 0);
    ctx.filter = 'none';
  }
  return output;
}

/**
 * The full export pixel pipeline as a canvas: geometry (crop, rotation,
 * repair) first, then every color/detail slider, then the overlay effects.
 * exportPhoto encodes this canvas directly; the 2x super-resolution flow
 * upscales it first and then encodes, so both paths share these pixels.
 */
export async function renderExportCanvas(src: string, edit: EditState, maxSize: number, repair?: ExportRepairOptions): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const base = await geometryForExport(image, edit, maxSize, repair, src);
  const output = renderAdjustedCanvas(base, edit);
  const ctx = output.getContext('2d')!;
  drawEffects(ctx, output.width, output.height, edit);
  return output;
}

/** Encode an export canvas to the requested format (JPEG/PNG/WebP). */
export function encodeExportCanvas(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Your browser could not create the image. Try another format.')), `image/${format}`, quality / 100));
}

export async function exportPhoto(src: string, edit: EditState, format: string, quality: number, maxSize: number, repair?: ExportRepairOptions): Promise<Blob> {
  const output = await renderExportCanvas(src, edit, maxSize, repair);
  return encodeExportCanvas(output, format, quality);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}