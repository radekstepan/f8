// Lightweight denoise for high-ISO shots: pure, dependency-free helpers
// shared by the photo server and the web client.
//
// A small learned denoiser (DnCNN color-blind ONNX, ~2.6MB) removes sensor
// noise server-side; the recipe stores only the strength, so the denoised
// base is a session artifact the client re-runs after reload. This module
// holds the deterministic pieces:
//
// - denoiseStrengthForIso / shouldAutoDenoise: the EXIF-ISO-keyed auto
//   suggestion (high-ISO drafts start on it, the Auto button fills it, the
//   slider then fine-tunes — any manual move clears the auto mark).
// - packDenoiseInput / parseDenoiseOutput: the ONNX wire contract (RGB
//   float32 NCHW 0..1 in, denoised image same shape out — verified against
//   the npuscale DnCNN export, whose output is the clean image directly,
//   not a residual).
// - blendDenoised: strength 0..100 mixes original and denoised pixels, so
//   preview and apply match exactly (both blend server-side).
// - denoiseClassic: classical fallback serving when ONNX weights are
//   absent (offline first run, download disabled) — a fast luminance
//   bilateral (radius 2) plus chroma box smoothing, blended by strength.
//   Approximate by design, so results always carry the classical source.
//
// Inputs are never mutated; strength is clamped to 0..100 everywhere.

import type { DenoiseState } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";

/** Single-file ONNX weights, lazily downloaded once into the model dir. */
export const DENOISE_FILE = "dncnn_color.onnx";
/** Exact download size in bytes (npuscale v1.2 release asset). */
export const DENOISE_FILE_SIZE = 2_680_354;
/**
 * Default weights: DnCNN color-blind ONNX re-exported by npuscale
 * (MIT, KAIR DnCNN by Zhang et al.). Overridable at runtime — any
 * image-to-image denoiser taking RGB float32 NCHW 0..1 and returning the
 * denoised image in the same layout serves (residual-style exports do
 * not: the output is used directly, never subtracted).
 */
export const DENOISE_DEFAULT_URL =
  "https://github.com/ikeno-web/npuscale/releases/download/v1.2/dncnn_color.onnx";
/** License of the default weights (KAIR DnCNN). */
export const DENOISE_LICENSE = "MIT";
/** Override env for the weight URL (mirrors F8_SELECTIVE_MASK_*). */
export const DENOISE_URL_ENV = "F8_DENOISE_URL";
export const DENOISE_DIR_ENV = "F8_DENOISE_DIR";
/** Set to "1" to disable weight downloads (server still serves the classical fallback). */
export const DENOISE_OFFLINE_ENV = "F8_DENOISE_OFFLINE";
/** Preview long edge: the Inspector previews on a ≤512px downsample first. */
export const DENOISE_PREVIEW_WIDTH = 512;
/** Apply long edge: full-res apply/exports run at up to 2048px (~9s CPU). */
export const DENOISE_APPLY_WIDTH = 2048;
/** EXIF ISO at/above which drafts start on the Auto suggestion. */
export const DENOISE_AUTO_ISO_THRESHOLD = 1600;
/** Hard ceiling for denoise payloads (both routes reject above this). */
export const DENOISE_MAX_DIM = 2048;

/**
 * ISO → suggested strength ladder (each rung is the floor for its ISO).
 * Calibrated on synthetic Gaussian noise over three real photos: 65 wins
 * or ties in 5/6 photo/level pairs, while the most textured frame at light
 * noise peaks at 25 — so auto stays conservative and the slider covers the
 * rest (see docs/tasks/16-denoise-ml.md).
 */
const DENOISE_ISO_LADDER: ReadonlyArray<readonly [number, number]> = [
  [6400, 65],
  [3200, 50],
  [1600, 35],
  [800, 20],
  [400, 10],
];

/**
 * Suggested denoise strength 0..100 for a capture ISO. 0 (off) below ISO
 * 400, rising to 65 at ISO 6400+; capped at 65 because full-strength
 * learned denoise smears fine detail. Non-finite/negative ISOs read as 0.
 */
export function denoiseStrengthForIso(iso: number): number {
  if (!Number.isFinite(iso) || iso <= 0) return 0;
  for (const [floor, strength] of DENOISE_ISO_LADDER) {
    if (iso >= floor) return strength;
  }
  return 0;
}

/** True when the capture ISO seeds the draft with the Auto suggestion (ISO ≥ 1600). */
export function shouldAutoDenoise(iso: number): boolean {
  return Number.isFinite(iso) && iso >= DENOISE_AUTO_ISO_THRESHOLD;
}

/** True when a stored denoise state changes pixels (strength > 0). */
export function isDenoiseActive(state: DenoiseState | null | undefined): state is DenoiseState {
  if (!state) return false;
  return Number.isFinite(state.strength) && state.strength > 0;
}

/**
 * Src the Compare "Original" layer must decode, or null when the display src
 * already is the original (no denoise base on screen). While denoised pixels
 * are applied the canvas shows a derived base, so Compare would show no
 * difference unless the Original side decodes the true original instead.
 */
export function separateOriginalSrc(displaySrc: string, originalSrc?: string | null): string | null {
  if (!originalSrc || originalSrc === displaySrc) return null;
  return originalSrc;
}

/** Effective strength 0..100: the Auto suggestion or the manual slider. */
export function effectiveDenoiseStrength(auto: boolean, slider: number, iso: number): number {
  if (auto) return denoiseStrengthForIso(iso);
  if (!Number.isFinite(slider)) return 0;
  return Math.min(100, Math.max(0, Math.round(slider)));
}

function clampStrength(strength: number): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.min(100, Math.max(0, strength));
}

/**
 * Pack an RGBA image to RGB float32 NCHW 0..1 (channel-major, row-major).
 * DnCNN takes no normalization beyond 0..1 (KAIR uint2single input).
 */
export function packDenoiseInput(image: PixelImage): Float32Array {
  assertValidImage(image);
  const { width, height, data } = image;
  const plane = width * height;
  const packed = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p += 1) {
    const i = p * 4;
    packed[p] = (data[i] ?? 0) / 255;
    packed[plane + p] = (data[i + 1] ?? 0) / 255;
    packed[2 * plane + p] = (data[i + 2] ?? 0) / 255;
  }
  return packed;
}

/**
 * Decode one raw denoiser output (3-plane NCHW float32, same HxW as the
 * packed input) into a denoised image. The export ships the clean image
 * directly (verified: neutral-gray input yields ~0.5 outputs, not ~0
 * residuals), so values are clamped to 0..1 — non-finite sanitized to the
 * original pixel — and blended with the original by strength/100. Alpha
 * passes through untouched. Throws RangeError on shape mismatch.
 */
export function parseDenoiseOutput(
  output: ArrayLike<number>,
  original: PixelImage,
  strength: number,
): PixelImage {
  assertValidImage(original);
  const plane = original.width * original.height;
  if (output.length !== 3 * plane) {
    throw new RangeError(`Expected a 3-plane denoise output of ${3 * plane} values, got ${output.length}.`);
  }
  const mix = clampStrength(strength) / 100;
  const data = new Uint8ClampedArray(original.data);
  if (mix <= 0) return { width: original.width, height: original.height, data };
  for (let p = 0; p < plane; p += 1) {
    const i = p * 4;
    for (let c = 0; c < 3; c += 1) {
      const raw = output[c * plane + p] ?? 0;
      const fallback = (original.data[i + c] ?? 0) / 255;
      const clean = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : fallback;
      const kept = (original.data[i + c] ?? 0) / 255;
      data[i + c] = Math.round((kept + (clean - kept) * mix) * 255);
    }
  }
  return { width: original.width, height: original.height, data };
}

/**
 * Mix a fully-denoised image with its original by strength/100 (the
 * classical path's blend; the ONNX path blends inside parseDenoiseOutput).
 * Dimensions must match; alpha comes from the original.
 */
export function blendDenoised(original: PixelImage, denoised: PixelImage, strength: number): PixelImage {
  assertValidImage(original);
  assertValidImage(denoised);
  if (original.width !== denoised.width || original.height !== denoised.height) {
    throw new RangeError(
      `Denoise blend size mismatch: ${original.width}x${original.height} vs ${denoised.width}x${denoised.height}.`,
    );
  }
  const mix = clampStrength(strength) / 100;
  const data = new Uint8ClampedArray(original.data.length);
  for (let i = 0; i < original.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const kept = original.data[i + c] ?? 0;
      const clean = denoised.data[i + c] ?? 0;
      data[i + c] = Math.round(kept + (clean - kept) * mix);
    }
    data[i + 3] = original.data[i + 3] ?? 255;
  }
  return { width: original.width, height: original.height, data: data as Uint8ClampedArray };
}

function luminanceOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Bilateral radius in px (a 5x5 neighborhood at any resolution). */
export const DENOISE_CLASSIC_RADIUS = 2;
/** Range sigma in luma levels: edges wider than this survive. */
export const DENOISE_CLASSIC_RANGE_SIGMA = 28;

/**
 * Classical fallback denoise: a luminance bilateral (radius 2, edges
 * preserved past ~28 luma levels) plus chroma box smoothing, blended by
 * strength/100. Fast enough for the 2048px apply path (~1-2s) and honest
 * about being approximate — high-ISO color blotches smooth out, but fine
 * grain survives where the learned weights would remove it. Strength 0
 * returns an equal copy.
 */
export function denoiseClassic(image: PixelImage, strength: number): PixelImage {
  assertValidImage(image);
  const { width, height, data } = image;
  const mix = clampStrength(strength) / 100;
  if (mix <= 0) return { width, height, data: new Uint8ClampedArray(data) };
  const plane = width * height;
  const luma = new Float32Array(plane);
  for (let p = 0; p < plane; p += 1) {
    const i = p * 4;
    luma[p] = luminanceOf(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
  }
  const radius = DENOISE_CLASSIC_RADIUS;
  const rangeSigma = DENOISE_CLASSIC_RANGE_SIGMA;
  const spatialSigma = radius / 2 + 0.5;
  const twoSpatialSq = 2 * spatialSigma * spatialSigma;
  const twoRangeSq = 2 * rangeSigma * rangeSigma;
  // Chroma planes get one cheap box pass (color noise is low-frequency).
  const chromaR = new Float32Array(plane);
  const chromaB = new Float32Array(plane);
  for (let p = 0; p < plane; p += 1) {
    const i = p * 4;
    chromaR[p] = (data[i] ?? 0) - (luma[p] ?? 0);
    chromaB[p] = (data[i + 2] ?? 0) - (luma[p] ?? 0);
  }
  const smoothLuma = new Float32Array(plane);
  const smoothR = new Float32Array(plane);
  const smoothB = new Float32Array(plane);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const center = luma[p] ?? 0;
      let wSum = 0;
      let lSum = 0;
      let boxR = 0;
      let boxB = 0;
      let boxCount = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          const q = yy * width + xx;
          const neighbor = luma[q] ?? 0;
          const spatial = (dx * dx + dy * dy) / twoSpatialSq;
          const range = ((neighbor - center) * (neighbor - center)) / twoRangeSq;
          const w = Math.exp(-(spatial + range));
          wSum += w;
          lSum += w * neighbor;
          boxR += chromaR[q] ?? 0;
          boxB += chromaB[q] ?? 0;
          boxCount += 1;
        }
      }
      // Luma follows the bilateral; chroma follows the cheaper box mean.
      smoothLuma[p] = wSum > 0 ? lSum / wSum : center;
      smoothR[p] = boxCount > 0 ? boxR / boxCount : 0;
      smoothB[p] = boxCount > 0 ? boxB / boxCount : 0;
    }
  }
  const out = new Uint8ClampedArray(data.length);
  for (let p = 0; p < plane; p += 1) {
    const i = p * 4;
    const l = smoothLuma[p] ?? 0;
    const cleanR = l + (smoothR[p] ?? 0);
    const cleanB = l + (smoothB[p] ?? 0);
    // Green is recovered from luma so the smooth never shifts hue: with
    // Rec.709 weights, g = (l - 0.2126r - 0.0722b) / 0.7152.
    const cleanG = (l - 0.2126 * cleanR - 0.0722 * cleanB) / 0.7152;
    const kept = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    const clean = [cleanR, cleanG, cleanB];
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = Math.round((kept[c] ?? 0) + ((clean[c] ?? 0) - (kept[c] ?? 0)) * mix);
    }
    out[i + 3] = data[i + 3] ?? 255;
  }
  return { width, height, data: out };
}
