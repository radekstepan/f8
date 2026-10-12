// Server ML straighten: pure, dependency-free helpers shared by the web
// client transport and the photo server.
//
// The on-device path (HoughLinesP + voteStraightenAngle) needs long straight
// segments and fails on soft horizons. This module holds the deterministic
// pieces for the server fallback:
//
// - packStraightenInput: bilinear resize to the regressor grid (224) with
//   ImageNet normalization, ready for a future tilt-regressor ONNX.
// - parseStraightenOutput: clamp/round a raw model angle to the slider range.
// - estimateStraightenGradient: OpenCV-free Sobel gradient vote that runs on
//   the server today. It complements Hough (all strong horizontal edges vote,
//   not just long segments), so the fallback adds signal even before ONNX
//   weights land. Inputs are never mutated.

import { assertValidImage, type PixelImage } from "./analyze.js";
import { STRAIGHTEN_MAX_ANGLE } from "./straighten.js";

/** Regressor grid: HLW-style tilt nets run at 224x224. */
export const STRAIGHTEN_ML_SIZE = 224;
/** Single-file ONNX weights for the future tilt regressor (not yet published). */
export const STRAIGHTEN_ML_FILE = "straighten_regressor.onnx";
/** Approximate fp32 download size once weights are published. */
export const STRAIGHTEN_ML_FILE_SIZE = 15 * 1024 * 1024;
/** Override env for the weight URL (mirrors F8_ML_HEAL_*). */
export const STRAIGHTEN_ML_URL_ENV = "F8_STRAIGHTEN_ML_URL";
export const STRAIGHTEN_ML_DIR_ENV = "F8_STRAIGHTEN_ML_DIR";
/** Set to "1" to disable weight downloads (server still serves the fallback). */
export const STRAIGHTEN_ML_OFFLINE_ENV = "F8_STRAIGHTEN_ML_OFFLINE";

/** ImageNet normalization for the regressor grid. */
export const STRAIGHTEN_ML_MEAN = [0.485, 0.456, 0.406] as const;
export const STRAIGHTEN_ML_STD = [0.229, 0.224, 0.225] as const;

/** Server estimate: suggested EditState.straighten plus source + confidence. */
export interface StraightenMlResult {
  angle: number;
  confidence: number;
  /** "onnx" once regressor weights serve, "gradient" for the built-in vote. */
  source: "onnx" | "gradient";
}

/** Sobel magnitude below this is flat area and does not vote. */
export const STRAIGHTEN_GRADIENT_MAG_THRESHOLD = 24;
/** Gradient edges beyond this tilt still count against dominance as outliers. */
const GRADIENT_OUTLIER_DEGREES = 30;

function clampAngle(angle: number): number {
  return Math.min(STRAIGHTEN_MAX_ANGLE, Math.max(-STRAIGHTEN_MAX_ANGLE, angle));
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

/**
 * Pack an RGBA image to 1x3x224x224 float32 (ImageNet-normalized) via
 * bilinear resampling. Output layout is NCHW channel-major.
 */
export function packStraightenInput(image: PixelImage): Float32Array {
  assertValidImage(image);
  const size = STRAIGHTEN_ML_SIZE;
  const packed = new Float32Array(3 * size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = ((x + 0.5) * image.width) / size - 0.5;
      const sy = ((y + 0.5) * image.height) / size - 0.5;
      for (let c = 0; c < 3; c += 1) {
        const v = bilinearChannelAt(image.data, image.width, image.height, sx, sy, c) / 255;
        const mean = STRAIGHTEN_ML_MEAN[c] ?? 0;
        const std = STRAIGHTEN_ML_STD[c] ?? 1;
        packed[(c * size + y) * size + x] = (v - mean) / std;
      }
    }
  }
  return packed;
}

/**
 * Map a raw regressor angle (+ optional spread in degrees) to a slider-ready
 * suggestion. Mirrors voteStraightenAngle: clamp to ±15, round to 0.1, never
 * a wild angle; confidence falls to 0 as the spread reaches 12 degrees.
 */
export function parseStraightenOutput(angle: number, spread = 0): { angle: number; confidence: number } {
  if (!Number.isFinite(angle)) return { angle: 0, confidence: 0 };
  const clamped = clampAngle(angle);
  const rounded = Math.round(clamped * 10) / 10;
  const safeSpread = Number.isFinite(spread) && spread >= 0 ? spread : 0;
  const confidence = Math.round(Math.min(1, Math.max(0, 1 - safeSpread / 12)) * 100) / 100;
  return { angle: rounded === 0 ? 0 : rounded, confidence };
}

/**
 * Gradient-vote tilt estimate without OpenCV: Sobel magnitudes vote for
 * their edge orientation (gradient + 90°, folded to [-90, 90)), weighted by
 * magnitude. Near-horizontal edges within ±STRAIGHTEN_MAX_ANGLE are inliers;
 * stronger tilts count against dominance as outliers. Flat or lineless input
 * yields { angle: 0, confidence: 0 } — never a wild angle.
 */
export function estimateStraightenGradient(image: PixelImage): { angle: number; confidence: number } {
  assertValidImage(image);
  const { width, height, data } = image;
  if (width < 3 || height < 3) return { angle: 0, confidence: 0 };
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  let totalWeight = 0;
  let inlierWeight = 0;
  let weightedSum = 0;
  const inliers: { angle: number; weight: number }[] = [];
  const at = (x: number, y: number): number => luma[y * width + x] ?? 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const mag = Math.hypot(gx, gy);
      if (!(mag > STRAIGHTEN_GRADIENT_MAG_THRESHOLD)) continue;
      // Edge orientation: gradient direction rotated 90°, folded to [-90, 90).
      let edge = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
      while (edge >= 90) edge -= 180;
      while (edge < -90) edge += 180;
      if (Math.abs(edge) > GRADIENT_OUTLIER_DEGREES) continue;
      totalWeight += mag;
      if (Math.abs(edge) > STRAIGHTEN_MAX_ANGLE) continue;
      inlierWeight += mag;
      weightedSum += edge * mag;
      inliers.push({ angle: edge, weight: mag });
    }
  }
  if (inlierWeight <= 0 || totalWeight <= 0) return { angle: 0, confidence: 0 };
  const mean = weightedSum / inlierWeight;
  let varianceSum = 0;
  for (const { angle, weight } of inliers) {
    varianceSum += weight * (angle - mean) * (angle - mean);
  }
  const std = Math.sqrt(varianceSum / inlierWeight);
  const dominance = inlierWeight / totalWeight;
  const agreement = Math.max(0, 1 - std / 12);
  const confidence = Math.round(Math.min(1, Math.max(0, dominance * agreement)) * 100) / 100;
  const rounded = Math.round(clampAngle(-mean) * 10) / 10;
  return { angle: rounded === 0 ? 0 : rounded, confidence };
}
