// ML heal: pure, dependency-free preprocessing for local ONNX inpainting.
//
// The heavy runtime (onnxruntime-web, WebGPU/WASM, model weights, DDIM loop)
// lives in the vision worker only. This module holds the deterministic pieces
// shared by the worker and Node tests:
//
// - Square ROI planning around the repair mask (models are fixed-resolution).
// - Bilinear pack of the ROI to model tensors (image 0..1, mask 0..1).
// - Unpack + composite of model output back to a full reconstruction.
//
// Like healRepair, the ML path returns a FULL reconstruction and the caller
// composites it through blendInpainted with a feathered mask. Inputs are never
// mutated; alpha always comes from the source.

import { assertValidImage, type PixelImage } from "./analyze.js";
import { assertValidMask, type RepairMask } from "./inpaint.js";

/** Model input resolution: LaMa and Moebius-class exports are fixed 512x512. */
export const ML_HEAL_MODEL_SIZE = 512;
/** Context padding around the mask bbox as a fraction of the bbox's max side. */
export const ML_HEAL_ROI_CONTEXT = 0.25;
/** Minimum context padding in source pixels so tiny blemishes keep surroundings. */
export const ML_HEAL_ROI_MIN_PAD = 8;
/** Cache Storage name for downloaded model weights. */
export const ML_HEAL_CACHE_NAME = "photomator-ml-heal-v1";
/** Default LaMa ONNX weights (Apache-2.0 export). Overridable at runtime. */
export const ML_HEAL_LAMA_DEFAULT_URL =
  "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx";
/** Default Moebius ONNX base (unet/vae_encoder/vae_decoder live underneath). */
export const ML_HEAL_MOEBIUS_DEFAULT_BASE = "https://huggingface.co/simonw/Moebius-ONNX/resolve/main";
/** Moebius weight files under the base URL. */
export const ML_HEAL_MOEBIUS_FILES = ["unet.onnx", "vae_encoder.onnx", "vae_decoder.onnx"] as const;
/** Approximate Moebius fp32 download sizes in bytes (unet, vae_encoder, vae_decoder). */
export const ML_HEAL_MOEBIUS_FILE_SIZES = [907 * 1024 * 1024, 137 * 1024 * 1024, 198 * 1024 * 1024] as const;
/** Approximate LaMa fp32 download size in bytes. */
export const ML_HEAL_LAMA_FILE_SIZE = 208 * 1024 * 1024;

/**
 * Local engine tier selected by the Heal Quality preset under ML Heal:
 * Fast runs the instant classic exemplar engine (no download), Balanced runs
 * LaMa single-pass neural fill, Best runs Moebius diffusion (with automatic
 * LaMa fallback when diffusion cannot serve the job).
 */
export type MlHealEngine = "classic" | "lama" | "moebius";

export function mlHealEngineForQuality(quality: "fast" | "balanced" | "best"): MlHealEngine {
  if (quality === "fast") return "classic";
  if (quality === "best") return "moebius";
  return "lama";
}

/** Human-facing engine facts for blurbs and status lines. */
export const ML_HEAL_ENGINE_INFO: Record<MlHealEngine, { label: string; download: string }> = {
  classic: { label: "Classic exemplar", download: "no download" },
  lama: { label: "LaMa neural fill", download: "~208MB once" },
  moebius: { label: "Moebius diffusion", download: "~1.3GB once" },
};

/**
 * Execution providers per engine, in ORT trial order. LaMa is wasm-only: its
 * Fourier ops have no WebGPU kernels, so offering WebGPU only produces a
 * confusing failure before the working backend is tried. Moebius is
 * WebGPU-only: a 907MB fp32 UNet cannot serve on a 32-bit WASM heap, and
 * attempting it wastes minutes before OOMing — the tier chain falls back to
 * LaMa instead.
 */
export const ML_HEAL_ENGINE_EPS: Record<MlHealEngine, readonly string[]> = {
  classic: [],
  lama: ["wasm"],
  moebius: ["webgpu"],
};

/**
 * WASM thread count for the ORT runtime. Threaded WASM needs
 * SharedArrayBuffer, which needs a cross-origin-isolated page (COOP/COEP
 * headers the app deliberately does not send — they would risk the remote
 * sample images and webfont). Without isolation, single-threaded: slower but
 * works everywhere. Capped at 4 with isolation: the 208MB graph gains little
 * past that and each thread costs arena memory.
 */
export function mlHealWasmThreads(crossOriginIsolated: boolean, hardwareConcurrency = 4): number {
  if (!crossOriginIsolated) return 1;
  if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency < 1) return 1;
  return Math.max(1, Math.min(4, Math.floor(hardwareConcurrency)));
}

/** Device capabilities that decide which engines can run. */
export interface MlCapabilities {
  webgpu: boolean;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
}

/** One-line human summary for status lines, e.g. "WebGPU: yes · Threads: shared (4)". */
export function formatMlCapabilities(caps: MlCapabilities): string {
  const threads = caps.crossOriginIsolated
    ? `shared (${mlHealWasmThreads(true, caps.hardwareConcurrency)})`
    : "single";
  return `WebGPU: ${caps.webgpu ? "yes" : "no"} · Threads: ${threads}`;
}

/** Moebius diffusion constants (ECCV'26 0.22B export; see pipeline notes). */
export const MOEBIUS_VAE_SCALE = 0.13025;
export const MOEBIUS_LATENT_SIZE = 64;
export const MOEBIUS_TRAIN_STEPS = 1000;
export const MOEBIUS_BETA_START = 0.00085;
export const MOEBIUS_BETA_END = 0.012;
export const MOEBIUS_INFERENCE_STEPS = 20;
export const MOEBIUS_STRENGTH = 0.99;
/** Interactive preview uses fewer DDIM steps so Best finishes in low minutes on integrated GPUs. */
export const MOEBIUS_PREVIEW_INFERENCE_STEPS = 10;
export const MOEBIUS_GUIDANCE = 7.5;
/** Per-channel noise offset added to the initial latents (reference parity). */
export const MOEBIUS_NOISE_OFFSET = 0.0357;
/** Fixed sampling seed so ML jobs are reproducible run to run. */
export const MOEBIUS_SEED = 0;

/** Actual DDIM step count for the strength-truncated schedule. */
export function moebiusStepCount(
  inferenceSteps: number = MOEBIUS_INFERENCE_STEPS,
  strength: number = MOEBIUS_STRENGTH,
): number {
  return Math.max(1, Math.floor(inferenceSteps * strength));
}

/** Scaled-linear training betas: linspace(sqrt(start), sqrt(end))^2. */
export function moebiusBetas(trainSteps: number = MOEBIUS_TRAIN_STEPS): Float64Array {
  const start = Math.sqrt(MOEBIUS_BETA_START);
  const end = Math.sqrt(MOEBIUS_BETA_END);
  const betas = new Float64Array(trainSteps);
  for (let i = 0; i < trainSteps; i += 1) {
    const t = trainSteps === 1 ? 0 : i / (trainSteps - 1);
    const beta = start + (end - start) * t;
    betas[i] = beta * beta;
  }
  return betas;
}

/** Cumulative alphas for the training schedule. */
export function moebiusAlphasCumprod(betas: Float64Array): Float64Array {
  const alphas = new Float64Array(betas.length);
  let acc = 1;
  for (let i = 0; i < betas.length; i += 1) {
    acc *= 1 - (betas[i] ?? 0);
    alphas[i] = acc;
  }
  return alphas;
}

/**
 * DDIM inference timesteps, ported verbatim from the reference pipeline
 * (floor(1000/steps) grid, descending, strength-truncated with floor —
 * Python int() truncation, not rounding). 20 steps at 0.99 strength gives
 * 19 steps starting at 900.
 */
export function moebiusTimesteps(
  inferenceSteps: number = MOEBIUS_INFERENCE_STEPS,
  strength: number = MOEBIUS_STRENGTH,
  trainSteps: number = MOEBIUS_TRAIN_STEPS,
): number[] {
  const stepRatio = Math.floor(trainSteps / inferenceSteps);
  const all: number[] = [];
  for (let i = 0; i < inferenceSteps; i += 1) all.push(Math.round(i * stepRatio));
  all.reverse();
  // Strength drops the first init_timestep entries (floor, not round).
  const initTimestep = Math.min(Math.floor(inferenceSteps * strength), inferenceSteps);
  return all.slice(Math.max(inferenceSteps - initTimestep, 0));
}

/**
 * Downsample a 512x512 binary mask to the 64x64 latent grid using
 * PyTorch-nearest convention (top-left pixel of each 8x8 block), matching the
 * reference pipeline exactly.
 */
export function downsampleMaskToLatent(mask512: Float32Array): Float32Array {
  const size = ML_HEAL_MODEL_SIZE;
  const latent = MOEBIUS_LATENT_SIZE;
  if (mask512.length !== size * size) {
    throw new RangeError(`Expected a ${size}x${size} mask, got ${mask512.length} values.`);
  }
  const ratio = size / latent;
  const out = new Float32Array(latent * latent);
  for (let ly = 0; ly < latent; ly += 1) {
    for (let lx = 0; lx < latent; lx += 1) {
      out[ly * latent + lx] = mask512[ly * ratio * size + lx * ratio] ?? 0;
    }
  }
  return out;
}

/**
 * Masked image for the VAE encoder: `image * (1 - mask)` in [-1, 1] space,
 * so the hole encodes as 0.0 (mid-gray) exactly like the reference pipeline.
 * The inpainting model must never see the object it has to remove.
 */
export function maskMlHealInputForEncode(image01: Float32Array, mask01: Float32Array): Float32Array {
  const size = ML_HEAL_MODEL_SIZE;
  if (image01.length !== 3 * size * size || mask01.length !== size * size) {
    throw new RangeError(
      `Expected image of ${3 * size * size} and mask of ${size * size} floats, ` +
        `got ${image01.length} and ${mask01.length}.`,
    );
  }
  const out = new Float32Array(image01.length);
  const plane = size * size;
  for (let c = 0; c < 3; c += 1) {
    for (let p = 0; p < plane; p += 1) {
      out[c * plane + p] = ((image01[c * plane + p] ?? 0) * 2 - 1) * (1 - (mask01[p] ?? 0));
    }
  }
  return out;
}

/**
 * Initial diffusion latents: pure Gaussian noise plus a small per-channel
 * offset (`NOISE_OFFSET * off[c]`, offsets drawn from a xored seed stream).
 * Image latents play no role at strength≈1 — the trajectory starts from noise.
 */
export function seedMoebiusLatents(
  makeRandn: (seed: number) => () => number,
  seed: number = MOEBIUS_SEED,
): Float32Array {
  const randn = makeRandn(seed);
  const latentN = MOEBIUS_LATENT_SIZE * MOEBIUS_LATENT_SIZE;
  const out = new Float32Array(4 * latentN);
  for (let i = 0; i < out.length; i += 1) out[i] = randn();
  const offStream = makeRandn(seed ^ 0x9e3779b9);
  for (let c = 0; c < 4; c += 1) {
    const off = offStream() * MOEBIUS_NOISE_OFFSET;
    for (let p = 0; p < latentN; p += 1) out[c * latentN + p] = (out[c * latentN + p] ?? 0) + off;
  }
  return out;
}

/**
 * Deterministic PRNG (mulberry32) with Box-Muller gaussian sampling for the
 * diffusion initial noise and per-step known-region noise.
 */
export function makeSeededGaussian(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  return (): number => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = uniform();
    while (v === 0) v = uniform();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

/** Square region of interest in source pixels. */
export interface MlHealRoi {
  x0: number;
  y0: number;
  size: number;
}

/** Model-ready tensors: NCHW float32, image 0..1, mask 0..1 (1 = fill). */
export interface MlHealInput {
  roi: MlHealRoi;
  image: Float32Array;
  mask: Float32Array;
}

/**
 * Square ROI around the nonzero mask bbox, expanded by context padding and
 * clamped to the image. Returns null when the mask is empty.
 */
export function planMlHealRoi(mask: RepairMask): MlHealRoi | null {
  assertValidMask(mask);
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if ((mask.data[y * mask.width + x] ?? 0) === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const pad = Math.max(ML_HEAL_ROI_MIN_PAD, Math.ceil(Math.max(bboxW, bboxH) * ML_HEAL_ROI_CONTEXT));
  let x0 = minX - pad;
  let y0 = minY - pad;
  let x1 = maxX + pad;
  let y1 = maxY + pad;
  // Clamp while preserving squareness: grow the short side first, then shrink.
  let size = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  size = Math.min(size, mask.width, mask.height);
  // Center the square on the bbox center, clamped into the image.
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;
  x0 = Math.round(cx - size / 2);
  y0 = Math.round(cy - size / 2);
  x0 = Math.max(0, Math.min(mask.width - size, x0));
  y0 = Math.max(0, Math.min(mask.height - size, y0));
  x1 = x0 + size - 1;
  y1 = y0 + size - 1;
  // Guarantee the bbox stays covered after clamping (tiny images / edges).
  if (minX < x0 || maxX > x1 || minY < y0 || maxY > y1) {
    x0 = Math.max(0, Math.min(minX, mask.width - size));
    y0 = Math.max(0, Math.min(minY, mask.height - size));
  }
  return { x0, y0, size };
}

function bilinearImageAt(
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

function bilinearMaskAt(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
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
 * Pack an image + mask ROI to 512x512 NCHW float32 tensors via bilinear
 * resampling. Image is scaled to 0..1; mask threshold: any nonzero source
 * coverage marks fill (>0.5 after resampling rounds to 1).
 */
export function packMlHealInput(image: PixelImage, mask: RepairMask, roi: MlHealRoi): MlHealInput {
  assertValidImage(image);
  assertValidMask(mask);
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new RangeError(
      `packMlHealInput needs matching dimensions, got image ${image.width}x${image.height} ` +
        `and mask ${mask.width}x${mask.height}.`,
    );
  }
  const size = ML_HEAL_MODEL_SIZE;
  const packed = new Float32Array(3 * size * size);
  const maskPacked = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = roi.x0 + ((x + 0.5) * roi.size) / size - 0.5;
      const sy = roi.y0 + ((y + 0.5) * roi.size) / size - 0.5;
      const r = bilinearImageAt(image.data, image.width, image.height, sx, sy, 0) / 255;
      const g = bilinearImageAt(image.data, image.width, image.height, sx, sy, 1) / 255;
      const b = bilinearImageAt(image.data, image.width, image.height, sx, sy, 2) / 255;
      const m = bilinearMaskAt(mask.data, mask.width, mask.height, sx, sy);
      packed[(0 * size + y) * size + x] = r;
      packed[(1 * size + y) * size + x] = g;
      packed[(2 * size + y) * size + x] = b;
      maskPacked[y * size + x] = m > 127.5 ? 1 : 0;
    }
  }
  return { roi, image: packed, mask: maskPacked };
}

/**
 * Composite model output (3x512x512 float32 in 0..255, LaMa convention) back
 * over the source at full resolution. Output is bilinearly upsampled to the
 * ROI, then written where the mask is nonzero; everything else (including
 * alpha) passes through bit-exact. Returns a fresh buffer.
 */
export function compositeMlHealOutput(
  source: PixelImage,
  mask: RepairMask,
  roi: MlHealRoi,
  output: Float32Array,
): PixelImage {
  assertValidImage(source);
  assertValidMask(mask);
  if (source.width !== mask.width || source.height !== mask.height) {
    throw new RangeError(
      `compositeMlHealOutput needs matching dimensions, got image ${source.width}x${source.height} ` +
        `and mask ${mask.width}x${mask.height}.`,
    );
  }
  const size = ML_HEAL_MODEL_SIZE;
  if (output.length !== 3 * size * size) {
    throw new RangeError(`Expected model output of ${3 * size * size} floats, got ${output.length}.`);
  }
  const out = new Uint8ClampedArray(source.data);
  const at = (c: number, x: number, y: number): number => {
    const cx = Math.max(0, Math.min(size - 1.001, x));
    const cy = Math.max(0, Math.min(size - 1.001, y));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(size - 1, x0 + 1);
    const y1 = Math.min(size - 1, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const v00 = output[(c * size + y0) * size + x0] ?? 0;
    const v10 = output[(c * size + y0) * size + x1] ?? 0;
    const v01 = output[(c * size + y1) * size + x0] ?? 0;
    const v11 = output[(c * size + y1) * size + x1] ?? 0;
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
  };
  for (let y = roi.y0; y < roi.y0 + roi.size; y += 1) {
    for (let x = roi.x0; x < roi.x0 + roi.size; x += 1) {
      const p = y * source.width + x;
      if ((mask.data[p] ?? 0) === 0) continue;
      const mx = ((x - roi.x0 + 0.5) * size) / roi.size - 0.5;
      const my = ((y - roi.y0 + 0.5) * size) / roi.size - 0.5;
      const oi = p * 4;
      out[oi] = Math.round(Math.max(0, Math.min(255, at(0, mx, my))));
      out[oi + 1] = Math.round(Math.max(0, Math.min(255, at(1, mx, my))));
      out[oi + 2] = Math.round(Math.max(0, Math.min(255, at(2, mx, my))));
    }
  }
  return { width: source.width, height: source.height, data: out };
}
