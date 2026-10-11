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
