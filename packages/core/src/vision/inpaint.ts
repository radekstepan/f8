// Repair inpainting: pure mask/parameter/composite helpers plus the shared
// OpenCV call used by the vision worker and the Node golden tests.
//
// The mask rasterizer mirrors geometryCanvas exactly: a RetouchPoint's center
// is (x * width, y * height) and its brush radius is size * width / 2, so the
// inpainted region aligns with the blur fallback and the on-canvas brush
// cursor. Only `repair` strokes are rasterized; `clone` strokes always keep
// the pixel-copy path in geometryCanvas.

import type { RetouchPoint } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";

/** cv.inpaint algorithm: Telea's fast marching method or Navier-Stokes. */
export type InpaintMethod = "telea" | "ns";

/** Default algorithm: Telea is faster and suits small photo blemishes. */
export const INPAINT_DEFAULT_METHOD: InpaintMethod = "telea";

/** Minimum inpaint radius: the OpenCV tutorial default. */
export const INPAINT_RADIUS_MIN = 3;
/** Maximum inpaint radius: caps the Telea/NS neighbourhood cost on big brushes. */
export const INPAINT_RADIUS_MAX = 12;

/** 8-bit single-channel mask: 0 is untouched, otherwise the max covering strength (1..255). */
export interface RepairMask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function assertValidMask(mask: RepairMask): void {
  if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width <= 0 || mask.height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${mask.width}x${mask.height}.`);
  }
  if (mask.data.length !== mask.width * mask.height) {
    throw new RangeError(
      `Mask buffer length ${mask.data.length} does not match dimensions ${mask.width}x${mask.height}.`,
    );
  }
}

/** True when at least one stroke is a repair stroke (clone strokes never inpaint). */
export function hasRepairStrokes(points: readonly RetouchPoint[]): boolean {
  return points.some((point) => point.kind === "repair");
}

/**
 * Rasterize repair strokes into an 8-bit mask at working resolution. Each
 * stroke paints a disc whose value is its strength scaled to 0..255; on
 * overlap the strongest stroke wins, so the mask doubles as the blend alpha
 * for compositing (cv.inpaint itself treats any nonzero value as fill region).
 * Clone, degenerate (non-finite, zero-size, zero-strength), and off-canvas
 * strokes are skipped; brushes crossing the edge are clamped to the image.
 */
export function rasterizeRepairMask(
  points: readonly RetouchPoint[],
  width: number,
  height: number,
): RepairMask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${width}x${height}.`);
  }
  const data = new Uint8ClampedArray(width * height);
  for (const point of points) {
    if (point.kind !== "repair") continue;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (!Number.isFinite(point.size) || point.size <= 0) continue;
    if (!Number.isFinite(point.strength) || point.strength <= 0) continue;
    const cx = point.x * width;
    const cy = point.y * height;
    const radius = (point.size * width) / 2;
    const value = Math.round((Math.min(100, point.strength) / 100) * 255);
    if (value <= 0) continue;
    // Conservative pixel bounds; the distance test below decides membership.
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= radius * radius) {
          const i = y * width + x;
          if (value > (data[i] ?? 0)) data[i] = value;
        }
      }
    }
  }
  return { width, height, data };
}

/**
 * Inpaint neighbourhood radius for one brush, tied to its pixel size so large
 * blemishes sample wider context. Bounded: degenerate brushes get the OpenCV
 * tutorial default, huge brushes are capped to bound compute cost.
 */
export function inpaintRadiusForBrush(size: number, width: number): number {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`Expected a positive integer width, got ${width}.`);
  }
  if (!Number.isFinite(size) || size <= 0) return INPAINT_RADIUS_MIN;
  const brushRadius = (size * width) / 2;
  return Math.min(INPAINT_RADIUS_MAX, Math.max(INPAINT_RADIUS_MIN, Math.round(brushRadius / 8)));
}

/** One radius for a stroke set: the largest repair brush wins; none means the minimum. */
export function inpaintRadiusForStrokes(points: readonly RetouchPoint[], width: number): number {
  let radius = INPAINT_RADIUS_MIN;
  for (const point of points) {
    if (point.kind !== "repair") continue;
    radius = Math.max(radius, inpaintRadiusForBrush(point.size, width));
  }
  return radius;
}

/**
 * Composite an inpainted image over its source, guided by the mask as
 * per-pixel alpha (mask value / 255). Outside the mask the source passes
 * through untouched; alpha always comes from the source. Returns a fresh
 * buffer; inputs are never mutated.
 */
export function blendInpainted(source: PixelImage, inpainted: PixelImage, mask: RepairMask): PixelImage {
  assertValidImage(source);
  assertValidImage(inpainted);
  assertValidMask(mask);
  if (
    source.width !== inpainted.width ||
    source.height !== inpainted.height ||
    source.width !== mask.width ||
    source.height !== mask.height
  ) {
    throw new RangeError(
      `blendInpainted needs matching dimensions, got ${source.width}x${source.height}, ` +
        `${inpainted.width}x${inpainted.height}, ${mask.width}x${mask.height}.`,
    );
  }
  const out = new Uint8ClampedArray(source.data.length);
  for (let p = 0, i = 0; p < mask.data.length; p += 1, i += 4) {
    const alpha = (mask.data[p] ?? 0) / 255;
    if (alpha <= 0) {
      out[i] = source.data[i] ?? 0;
      out[i + 1] = source.data[i + 1] ?? 0;
      out[i + 2] = source.data[i + 2] ?? 0;
      out[i + 3] = source.data[i + 3] ?? 0;
    } else if (alpha >= 1) {
      out[i] = inpainted.data[i] ?? 0;
      out[i + 1] = inpainted.data[i + 1] ?? 0;
      out[i + 2] = inpainted.data[i + 2] ?? 0;
      out[i + 3] = source.data[i + 3] ?? 0;
    } else {
      out[i] = Math.round((source.data[i] ?? 0) * (1 - alpha) + (inpainted.data[i] ?? 0) * alpha);
      out[i + 1] = Math.round((source.data[i + 1] ?? 0) * (1 - alpha) + (inpainted.data[i + 1] ?? 0) * alpha);
      out[i + 2] = Math.round((source.data[i + 2] ?? 0) * (1 - alpha) + (inpainted.data[i + 2] ?? 0) * alpha);
      out[i + 3] = source.data[i + 3] ?? 0;
    }
  }
  return { width: source.width, height: source.height, data: out };
}

/** Minimal structural view of the OpenCV.js surface used for inpainting. */
export interface InpaintCvMat {
  readonly rows: number;
  readonly cols: number;
  readonly data: Uint8Array;
  delete(): void;
}

export interface InpaintCvMatConstructor {
  new (): InpaintCvMat;
  new (rows: number, cols: number, type: number): InpaintCvMat;
}

export interface InpaintCvApi {
  readonly CV_8UC4: number;
  readonly CV_8UC1: number;
  readonly COLOR_RGBA2RGB: number;
  readonly COLOR_RGB2RGBA: number;
  readonly INPAINT_TELEA: number;
  readonly INPAINT_NS: number;
  readonly Mat: InpaintCvMatConstructor;
  cvtColor(src: InpaintCvMat, dst: InpaintCvMat, code: number): void;
  inpaint(src: InpaintCvMat, inpaintMask: InpaintCvMat, dst: InpaintCvMat, inpaintRadius: number, flags: number): void;
}

/**
 * Run cv.inpaint through an injected OpenCV runtime. Shared by the vision
 * worker and the Node golden tests so both exercise identical Mat wrangling.
 * cv.inpaint only accepts 1- or 3-channel input, so RGBA photos round-trip
 * through RGB and the original alpha channel is restored afterwards
 * (COLOR_RGB2RGBA fills alpha with 255). All Mats are deleted before return.
 */
export function inpaintWithCv(
  cv: InpaintCvApi,
  image: PixelImage,
  mask: RepairMask,
  radius: number,
  method: InpaintMethod,
): PixelImage {
  assertValidImage(image);
  assertValidMask(mask);
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new RangeError(
      `inpaintWithCv needs matching dimensions, got image ${image.width}x${image.height} ` +
        `and mask ${mask.width}x${mask.height}.`,
    );
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`Expected a positive inpaint radius, got ${radius}.`);
  }
  if (method !== "telea" && method !== "ns") {
    throw new RangeError(`Unknown inpaint method: ${String(method)}.`);
  }
  const mats: InpaintCvMat[] = [];
  try {
    const src = new cv.Mat(image.height, image.width, cv.CV_8UC4);
    mats.push(src);
    src.data.set(image.data);
    const maskMat = new cv.Mat(mask.height, mask.width, cv.CV_8UC1);
    mats.push(maskMat);
    maskMat.data.set(mask.data);
    const rgb = new cv.Mat();
    mats.push(rgb);
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const filled = new cv.Mat();
    mats.push(filled);
    cv.inpaint(rgb, maskMat, filled, radius, method === "telea" ? cv.INPAINT_TELEA : cv.INPAINT_NS);
    const rgba = new cv.Mat();
    mats.push(rgba);
    cv.cvtColor(filled, rgba, cv.COLOR_RGB2RGBA);
    const out = new Uint8ClampedArray(rgba.data);
    for (let i = 3; i < out.length; i += 4) {
      out[i] = image.data[i] ?? 255;
    }
    return { width: image.width, height: image.height, data: out };
  } finally {
    for (const mat of mats.reverse()) mat.delete();
  }
}
