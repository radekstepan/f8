// Selective (masked) adjustments: pure, dependency-free person/background
// segmentation helpers shared by the photo server and the web client.
//
// A small ONNX portrait segmenter (U^2-Net portrait "u2netp", ~4.6MB) finds
// the subject, and its soft mask drives masked exposure/contrast/saturation
// over the subject side and the background side independently.
// This module holds the deterministic pieces:
//
// - packSelectiveMaskInput: stretch resize to the 320 grid (RGB float32,
//   ImageNet-normalized NCHW, matching the rembg u2net preprocessing).
// - parseSelectiveMaskOutput: raw single-channel side output → 0..1 mask at
//   working size (direct probabilities, clamped — the export ships sigmoided
//   outputs, verified — then bilinear resample). No min-max stretch: rembg
//   stretches, but that would manufacture a subject on subject-free photos.
// - proposeClassicSubjectMask: classical fallback that serves when ONNX
//   weights are absent (offline) — face-box-derived head-and-shoulders soft
//   ellipses when faces are found, else a center-prior skin saliency.
// - encodeSelectiveMask / decodeSelectiveMask: the recipe wire format
//   (base64 8-bit mask at <=160px long edge, resolution-free enough to
//   resample onto any render size).
// - applySelectiveAdjust: the mask-composite pass the adjustment pipeline
//   renders from the recipe (subject side through the mask, background
//   side through its inverse).
// - normalizeSelectiveAdjust: legacy single-target recipes map onto their
//   side so old persisted edits keep rendering.
//
// Inputs are never mutated (except the documented in-place buffer pass,
// which takes a caller-owned buffer); masks are soft 0..1, resampled with
// bilinear filtering so recipe masks stay smooth at any render size.

import type { EditState, SelectiveAdjustParams, SelectiveAdjustState, SelectiveMaskSource } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";
import { type DetectedFace } from "./face-exposure.js";
import { isSkinPixel } from "./scene-enhance.js";

/** Segmenter grid: the u2netp ONNX export runs at 320x320. */
export const SELECTIVE_MASK_SIZE = 320;
/** Single-file ONNX weights, lazily downloaded once into the model dir. */
export const SELECTIVE_MASK_FILE = "u2netp.onnx";
/** Exact download size in bytes (measured from the rembg release asset). */
export const SELECTIVE_MASK_FILE_SIZE = 4_574_861;
/**
 * Default weights: U^2-Net portrait ONNX redistributed by rembg
 * (Apache-2.0, trained by the U^2-Net authors). Overridable at runtime —
 * the server reads the first input/output names dynamically and accepts
 * any square single-channel mask output, so MODNet-class re-exports fit.
 */
export const SELECTIVE_MASK_DEFAULT_URL =
  "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx";
/** License of the default weights (U^2-Net). */
export const SELECTIVE_MASK_LICENSE = "Apache-2.0";
/** Override env for the weight URL (mirrors F8_FACE_DETECT_*). */
export const SELECTIVE_MASK_URL_ENV = "F8_SELECTIVE_MASK_URL";
export const SELECTIVE_MASK_DIR_ENV = "F8_SELECTIVE_MASK_DIR";
/** Set to "1" to disable weight downloads (server still serves the classical fallback). */
export const SELECTIVE_MASK_OFFLINE_ENV = "F8_SELECTIVE_MASK_OFFLINE";
/** Client downsample long edge for segment requests (keeps payloads small). */
export const SELECTIVE_MASK_WORKING_WIDTH = 320;
/**
 * Stored/transport mask long edge (≤96px ≈ 12KB base64 worst case).
 * /api/library ships every photo's full recipe at load, so masks stay
 * small; exposure/contrast/saturation are low-frequency, and the soft
 * mask upsamples cleanly at render (soft edges avoid halos).
 */
export const SELECTIVE_MASK_RECIPE_WIDTH = 96;
/** Subject coverage below/above which the mask is "no subject" (empty or full-frame). */
export const SELECTIVE_MASK_MIN_COVERAGE = 0.01;
export const SELECTIVE_MASK_MAX_COVERAGE = 0.98;
/** ImageNet normalization (rembg u2net preprocessing). */
export const SELECTIVE_MASK_NORM_MEAN = [0.485, 0.456, 0.406] as const;
export const SELECTIVE_MASK_NORM_STD = [0.229, 0.224, 0.225] as const;
/** Default "brighten subject only" suggestion in EV. */
export const SELECTIVE_MASK_DEFAULT_EXPOSURE = 0.5;

/** Soft subject mask: data is row-major 0..1 (1 = subject). */
export interface SelectiveMask {
  width: number;
  height: number;
  data: Float32Array;
}

/** Stretch-resize geometry mapping the 320 grid back to source pixels. */
export interface SelectiveMaskGeometry {
  srcWidth: number;
  srcHeight: number;
}

export function assertValidSelectiveMask(mask: SelectiveMask): void {
  if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width <= 0 || mask.height <= 0) {
    throw new RangeError(`Expected positive integer mask dimensions, got ${mask.width}x${mask.height}.`);
  }
  if (mask.data.length !== mask.width * mask.height) {
    throw new RangeError(
      `Mask buffer length ${mask.data.length} does not match dimensions ${mask.width}x${mask.height}.`,
    );
  }
}

function bilinearChannelAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const cx = Math.max(0, Math.min(width - 1.001, x));
  const cy = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const v00 = data[(y0 * width + x0) * 4 + channel] ?? 0;
  const v10 = data[(y0 * width + x1) * 4 + channel] ?? 0;
  const v01 = data[(y1 * width + x0) * 4 + channel] ?? 0;
  const v11 = data[(y1 * width + x1) * 4 + channel] ?? 0;
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

function bilinearMaskAt(data: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const cx = Math.max(0, Math.min(width - 1.001, x));
  const cy = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const v00 = data[y0 * width + x0] ?? 0;
  const v10 = data[y0 * width + x1] ?? 0;
  const v01 = data[y1 * width + x0] ?? 0;
  const v11 = data[y1 * width + x1] ?? 0;
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/**
 * Pack an RGBA image to 1x3x320x320 float32 (RGB 0..1, ImageNet-normalized,
 * NCHW channel-major) via stretch resize. Matches the rembg u2net
 * preprocessing (resize to 320, normalize with ImageNet mean/std).
 * Returns the tensor plus the source size for mapping the mask back.
 */
export function packSelectiveMaskInput(image: PixelImage): { data: Float32Array; geometry: SelectiveMaskGeometry } {
  assertValidImage(image);
  const size = SELECTIVE_MASK_SIZE;
  const data = new Float32Array(3 * size * size);
  const plane = size * size;
  const scaleX = image.width / size;
  const scaleY = image.height / size;
  for (let gy = 0; gy < size; gy += 1) {
    for (let gx = 0; gx < size; gx += 1) {
      const sx = (gx + 0.5) * scaleX - 0.5;
      const sy = (gy + 0.5) * scaleY - 0.5;
      const p = gy * size + gx;
      for (let c = 0; c < 3; c += 1) {
        const v = bilinearChannelAt(image.data, image.width, image.height, sx, sy, c) / 255;
        data[c * plane + p] = (v - (SELECTIVE_MASK_NORM_MEAN[c] ?? 0)) / (SELECTIVE_MASK_NORM_STD[c] ?? 1);
      }
    }
  }
  return { data, geometry: { srcWidth: image.width, srcHeight: image.height } };
}

/**
 * Decode one raw single-channel side output (square grid, row-major) into a
 * soft 0..1 subject mask at the requested working size. The export ships
 * sigmoided probabilities (verified: raw outputs span 0..1), so values are
 * used directly — clamped, non-finite sanitized to 0 before blending
 * (NaN * 0 is NaN, so one bad cell would otherwise poison the whole mask)
 * — and bilinearly resampled to outWidth x outHeight. Deliberately no
 * min-max stretch: that
 * would manufacture a full-range subject on subject-free photos (verified:
 * flat gray yields all-~0 outputs). Throws RangeError on non-square or
 * empty outputs (the server answers with the classical fallback instead).
 */
export function parseSelectiveMaskOutput(
  output: ArrayLike<number>,
  outWidth: number,
  outHeight: number,
): SelectiveMask {
  if (!Number.isInteger(outWidth) || !Number.isInteger(outHeight) || outWidth <= 0 || outHeight <= 0) {
    throw new RangeError(`Expected positive integer output dimensions, got ${outWidth}x${outHeight}.`);
  }
  const grid = Math.sqrt(output.length);
  if (!Number.isInteger(grid) || grid < 2) {
    throw new RangeError(`Expected a square single-channel mask output, got length ${output.length}.`);
  }
  const clean = new Float32Array(output.length);
  for (let i = 0; i < output.length; i += 1) {
    const v = output[i] ?? 0;
    clean[i] = Number.isFinite(v) ? v : 0;
  }
  const data = new Float32Array(outWidth * outHeight);
  const scaleX = grid / outWidth;
  const scaleY = grid / outHeight;
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const v = bilinearMaskAt(clean, grid, grid, (x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5);
      data[y * outWidth + x] = Math.min(1, Math.max(0, v));
    }
  }
  return { width: outWidth, height: outHeight, data };
}

/** Fraction of mask pixels at/above 0.5 (the subject's frame share). */
export function selectiveMaskCoverage(mask: SelectiveMask): number {
  assertValidSelectiveMask(mask);
  let count = 0;
  for (let i = 0; i < mask.data.length; i += 1) {
    if ((mask.data[i] ?? 0) >= 0.5) count += 1;
  }
  return mask.data.length === 0 ? 0 : count / mask.data.length;
}

/** Bilinearly resample a mask to new dimensions (render-time upsample). */
export function resizeSelectiveMask(mask: SelectiveMask, width: number, height: number): SelectiveMask {
  assertValidSelectiveMask(mask);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${width}x${height}.`);
  }
  const data = new Float32Array(width * height);
  const scaleX = mask.width / width;
  const scaleY = mask.height / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = bilinearMaskAt(mask.data, mask.width, mask.height, (x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5);
    }
  }
  return { width, height, data };
}

/** Shrink a mask so its long edge is at most maxDim (aspect-preserving). */
export function downsampleSelectiveMask(mask: SelectiveMask, maxDim: number = SELECTIVE_MASK_RECIPE_WIDTH): SelectiveMask {
  assertValidSelectiveMask(mask);
  const longEdge = Math.max(mask.width, mask.height);
  if (longEdge <= maxDim) return { width: mask.width, height: mask.height, data: new Float32Array(mask.data) };
  const scale = maxDim / longEdge;
  return resizeSelectiveMask(mask, Math.max(1, Math.round(mask.width * scale)), Math.max(1, Math.round(mask.height * scale)));
}

function maskToB64(bytes: Uint8ClampedArray): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function b64ToMaskBytes(b64: string): Uint8ClampedArray | null {
  try {
    const binary = atob(b64);
    const out = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Encode a mask to the recipe wire format (base64 8-bit, 0..255). */
export function encodeSelectiveMask(mask: SelectiveMask): string {
  assertValidSelectiveMask(mask);
  const bytes = new Uint8ClampedArray(mask.data.length);
  for (let i = 0; i < mask.data.length; i += 1) {
    bytes[i] = Math.round(Math.min(1, Math.max(0, mask.data[i] ?? 0)) * 255);
  }
  return maskToB64(bytes);
}

/**
 * Decode the recipe wire format back to a soft mask; null when corrupt
 * (bad base64, dimension mismatch, oversized) so render never throws on a
 * damaged recipe — the pipeline skips the selective pass instead.
 */
export function decodeSelectiveMask(b64: string, width: number, height: number): SelectiveMask | null {
  if (typeof b64 !== "string" || !Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return null;
  const bytes = b64ToMaskBytes(b64);
  if (!bytes || bytes.length !== width * height) return null;
  const data = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) data[i] = (bytes[i] ?? 0) / 255;
  return { width, height, data };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Head-to-shoulders expansion of a face box (fractions of face size). */
const CLASSIC_SHOULDER_HALF_WIDTH = 1.1;
const CLASSIC_SHOULDER_TOP = 0.15;
const CLASSIC_SHOULDER_BOTTOM = 1.6;

/** One box-blur pass over a float plane (local copy: adjustments.ts imports this module). */
function blurPlaneOnce(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return new Float32Array(source);
  const window = 2 * r + 1;
  const horizontal = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += source[row + Math.min(width - 1, Math.max(0, x))] ?? 0;
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / window;
      sum +=
        (source[row + Math.min(width - 1, Math.max(0, x + r + 1))] ?? 0) -
        (source[row + Math.min(width - 1, Math.max(0, x - r))] ?? 0);
    }
  }
  const output = new Float32Array(width * height);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x] ?? 0;
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / window;
      sum +=
        (horizontal[Math.min(height - 1, Math.max(0, y + r + 1)) * width + x] ?? 0) -
        (horizontal[Math.min(height - 1, Math.max(0, y - r)) * width + x] ?? 0);
    }
  }
  return output;
}

/**
 * Classical subject proposer: face-box-derived head-and-shoulders soft
 * ellipses when faces are found, else a center-prior skin saliency (skin
 * scores high, colorful pixels low, edges fade to the corners), blurred
 * twice. Serves when ONNX weights are absent (offline first run, download
 * disabled). Approximate by design — it misses backs-turned subjects and
 * can fire on warm centered objects — so results always carry the
 * classical source and the UI labels them as a scan, never ML. Returns
 * null when the mask is empty or full-frame (no usable subject).
 */
export function proposeClassicSubjectMask(image: PixelImage, faces: readonly DetectedFace[]): SelectiveMask | null {
  assertValidImage(image);
  const scale = Math.min(1, SELECTIVE_MASK_RECIPE_WIDTH / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Float32Array(width * height);
  if (faces.length > 0) {
    for (const face of faces) {
      const fx0 = Math.min(face.box.x0, face.box.x1);
      const fx1 = Math.max(face.box.x0, face.box.x1);
      const fy0 = Math.min(face.box.y0, face.box.y1);
      const fy1 = Math.max(face.box.y0, face.box.y1);
      const cx = ((fx0 + fx1) / 2) * width;
      const faceW = Math.max(0.001, fx1 - fx0) * width;
      const faceH = Math.max(0.001, fy1 - fy0) * height;
      const x0 = cx - faceW * CLASSIC_SHOULDER_HALF_WIDTH;
      const x1 = cx + faceW * CLASSIC_SHOULDER_HALF_WIDTH;
      const y0 = fy0 * height - faceH * CLASSIC_SHOULDER_TOP;
      const y1 = fy1 * height + faceH * CLASSIC_SHOULDER_BOTTOM;
      const ecx = (x0 + x1) / 2;
      const ecy = (y0 + y1) / 2;
      const rx = Math.max(0.5, (x1 - x0) / 2);
      const ry = Math.max(0.5, (y1 - y0) / 2);
      const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1)));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = (x + 0.5 - ecx) / rx;
          const dy = (y + 0.5 - ecy) / ry;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= 1) continue;
          const m = 1 - smoothstep(0.55, 1, d);
          const p = y * width + x;
          if (m > (data[p] ?? 0)) data[p] = m;
        }
      }
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sx = Math.min(image.width - 1, Math.floor((x + 0.5) / scale));
        const sy = Math.min(image.height - 1, Math.floor((y + 0.5) / scale));
        const i = (sy * image.width + sx) * 4;
        const r = image.data[i] ?? 0;
        const g = image.data[i + 1] ?? 0;
        const b = image.data[i + 2] ?? 0;
        let score: number;
        if (isSkinPixel(r, g, b)) {
          score = 0.9;
        } else {
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          score = max > 0 && (max - min) / max > 0.25 ? 0.35 : 0.1;
        }
        const nx = ((x + 0.5) / width - 0.5) * 2;
        const ny = ((y + 0.5) / height - 0.5) * 2;
        const corner = Math.min(1, Math.sqrt(nx * nx + ny * ny) / Math.SQRT2);
        data[y * width + x] = score * (1 - 0.75 * corner);
      }
    }
    const radius = Math.max(1, Math.round(Math.min(width, height) / 40));
    const blurred = blurPlaneOnce(blurPlaneOnce(data, width, height, radius), width, height, radius);
    data.set(blurred);
  }
  const mask = { width, height, data };
  const coverage = selectiveMaskCoverage(mask);
  if (coverage < SELECTIVE_MASK_MIN_COVERAGE || coverage > SELECTIVE_MASK_MAX_COVERAGE) return null;
  return mask;
}

export type { SelectiveAdjustParams } from "../types.js";

/** True when the masked params would change at least one pixel. */
export function isSelectiveAdjustParamsNeutral(params: SelectiveAdjustParams): boolean {
  return params.exposure === 0 && params.contrast === 0 && params.saturation === 0;
}

/**
 * Pre-dual-side recipe shape: a single target plus one param set. Recipes
 * persisted before subject+background shipped still carry this; the render
 * path and the UI normalize it instead of dropping the user's edit.
 */
export interface LegacySelectiveAdjustState {
  maskB64: string;
  maskWidth: number;
  maskHeight: number;
  target: "subject" | "background";
  exposure: number;
  contrast: number;
  saturation: number;
  source: SelectiveMaskSource;
}

/**
 * Normalize a stored selective adjust to the dual-side shape: legacy
 * single-target recipes map their params onto the targeted side (the other
 * side stays neutral). Returns null for null/absent/garbage input so the
 * render path never throws on a damaged recipe.
 */
export function normalizeSelectiveAdjust(
  state: SelectiveAdjustState | LegacySelectiveAdjustState | null | undefined,
): SelectiveAdjustState | null {
  if (!state || typeof state !== "object") return null;
  const candidate = state as Partial<SelectiveAdjustState> & Partial<LegacySelectiveAdjustState>;
  const maskB64 = candidate.maskB64;
  const maskWidth = candidate.maskWidth;
  const maskHeight = candidate.maskHeight;
  if (typeof maskB64 !== "string" || typeof maskWidth !== "number" || typeof maskHeight !== "number") return null;
  if (!Number.isInteger(maskWidth) || !Number.isInteger(maskHeight)) return null;
  const neutral = { exposure: 0, contrast: 0, saturation: 0 };
  const clean = (params: unknown): SelectiveAdjustParams => ({
    exposure: typeof (params as SelectiveAdjustParams)?.exposure === "number" ? ((params as SelectiveAdjustParams).exposure as number) : 0,
    contrast: typeof (params as SelectiveAdjustParams)?.contrast === "number" ? ((params as SelectiveAdjustParams).contrast as number) : 0,
    saturation: typeof (params as SelectiveAdjustParams)?.saturation === "number" ? ((params as SelectiveAdjustParams).saturation as number) : 0,
  });
  if (candidate.subject !== undefined || candidate.background !== undefined) {
    return {
      maskB64,
      maskWidth,
      maskHeight,
      subject: candidate.subject === undefined ? { ...neutral } : clean(candidate.subject),
      background: candidate.background === undefined ? { ...neutral } : clean(candidate.background),
      source: candidate.source === "classic" ? "classic" : "onnx",
      // The bypass toggle survives normalization so the render path and the
      // UI agree on it; anything but an explicit false means enabled, and
      // legacy recipes (no key) stay active.
      ...(candidate.enabled === false ? { enabled: false as const } : {}),
    };
  }
  if (candidate.target !== "subject" && candidate.target !== "background") return null;
  const params = clean(candidate);
  return {
    maskB64,
    maskWidth,
    maskHeight,
    subject: candidate.target === "subject" ? params : { ...neutral },
    background: candidate.target === "background" ? params : { ...neutral },
    source: candidate.source === "classic" ? "classic" : "onnx",
  };
}

/** True when a stored selective adjust changes at least one pixel (either side, and enabled). */
export function isSelectiveAdjustActive(
  state: SelectiveAdjustState | LegacySelectiveAdjustState | null | undefined,
): state is SelectiveAdjustState {
  const normalized = normalizeSelectiveAdjust(state);
  if (!normalized || normalized.enabled === false) return false;
  return !isSelectiveAdjustParamsNeutral(normalized.subject) || !isSelectiveAdjustParamsNeutral(normalized.background);
}

function luminanceOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function applySelectiveSide(
  data: Uint8ClampedArray,
  full: Float32Array,
  pixelCount: number,
  params: SelectiveAdjustParams,
  invert: boolean,
): void {
  const exposure = Math.min(3, Math.max(-3, params.exposure));
  const gain = Math.pow(2, exposure * 0.6);
  const contrastFactor = 1 + Math.min(100, Math.max(-100, params.contrast)) / 100;
  const saturationFactor = Math.max(0, 1 + Math.min(100, Math.max(-100, params.saturation)) / 100);
  for (let p = 0; p < pixelCount; p += 1) {
    const subject = full[p] ?? 0;
    const m = invert ? 1 - subject : subject;
    if (!(m > 0)) continue;
    const i = p * 4;
    const r0 = data[i] ?? 0;
    const g0 = data[i + 1] ?? 0;
    const b0 = data[i + 2] ?? 0;
    let r = r0 * gain;
    let g = g0 * gain;
    let b = b0 * gain;
    if (contrastFactor !== 1) {
      r = (r - 128) * contrastFactor + 128;
      g = (g - 128) * contrastFactor + 128;
      b = (b - 128) * contrastFactor + 128;
    }
    if (saturationFactor !== 1) {
      const luma = luminanceOf(r, g, b);
      r = luma + (r - luma) * saturationFactor;
      g = luma + (g - luma) * saturationFactor;
      b = luma + (b - luma) * saturationFactor;
    }
    data[i] = r0 + (r - r0) * m;
    data[i + 1] = g0 + (g - g0) * m;
    data[i + 2] = b0 + (b - b0) * m;
  }
}

/**
 * Apply masked exposure/contrast/saturation in place: each side is adjusted
 * with the global pipeline's math (2^(EV*0.6) gain, pivot contrast, chroma
 * saturation) and composited by the subject mask (subject side) or its
 * inverse (background side), so a fully unselected region passes through
 * bit-identical. Both sides run in one pass each, subject first — with a
 * hard 0/1 mask the sides never interact. The buffer must be caller-owned
 * (the pipeline passes its fresh output); tests pass a copy. No-op when
 * both sides are neutral. Legacy single-target adjusts are normalized, so
 * old recipes render unchanged.
 */
export function applySelectiveAdjust(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mask: SelectiveMask,
  adjust: Pick<SelectiveAdjustState, "subject" | "background"> | (SelectiveAdjustParams & { target: "subject" | "background" }),
): void {
  if (data.length !== width * height * 4) {
    throw new RangeError(`Buffer length ${data.length} does not match dimensions ${width}x${height}.`);
  }
  const sides: Pick<SelectiveAdjustState, "subject" | "background"> =
    "subject" in adjust || "background" in adjust
      ? {
          subject: (adjust as Partial<Pick<SelectiveAdjustState, "subject">>).subject ?? { exposure: 0, contrast: 0, saturation: 0 },
          background: (adjust as Partial<Pick<SelectiveAdjustState, "background">>).background ?? { exposure: 0, contrast: 0, saturation: 0 },
        }
      : (() => {
          const legacy = adjust as SelectiveAdjustParams & { target: "subject" | "background" };
          const params = { exposure: legacy.exposure, contrast: legacy.contrast, saturation: legacy.saturation };
          const neutral = { exposure: 0, contrast: 0, saturation: 0 };
          return legacy.target === "background"
            ? { subject: neutral, background: params }
            : { subject: params, background: neutral };
        })();
  if (isSelectiveAdjustParamsNeutral(sides.subject) && isSelectiveAdjustParamsNeutral(sides.background)) return;
  assertValidSelectiveMask(mask);
  const full = mask.width === width && mask.height === height ? mask.data : resizeSelectiveMask(mask, width, height).data;
  if (!isSelectiveAdjustParamsNeutral(sides.subject)) applySelectiveSide(data, full, width * height, sides.subject, false);
  if (!isSelectiveAdjustParamsNeutral(sides.background)) applySelectiveSide(data, full, width * height, sides.background, true);
}

/**
 * Build the recipe state for a segmentation result: the downsampled mask
 * plus the default "brighten subject" suggestion (background neutral).
 * Returns null when the mask has no usable subject (empty or full-frame),
 * so a no-op apply stores no badge.
 */
export function selectiveAdjustForMask(mask: SelectiveMask, source: SelectiveMaskSource): SelectiveAdjustState | null {
  assertValidSelectiveMask(mask);
  const coverage = selectiveMaskCoverage(mask);
  if (coverage < SELECTIVE_MASK_MIN_COVERAGE || coverage > SELECTIVE_MASK_MAX_COVERAGE) return null;
  const stored = downsampleSelectiveMask(mask);
  return {
    maskB64: encodeSelectiveMask(stored),
    maskWidth: stored.width,
    maskHeight: stored.height,
    subject: { exposure: SELECTIVE_MASK_DEFAULT_EXPOSURE, contrast: 0, saturation: 0 },
    background: { exposure: 0, contrast: 0, saturation: 0 },
    source,
  };
}

/** True when a full edit recipe carries an active selective adjust. */
export function editHasSelectiveAdjust(edit: EditState): boolean {
  return isSelectiveAdjustActive(edit.selectiveAdjust);
}
