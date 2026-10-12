// Auto dust/spot detection: classical blob candidates plus a tiny ML
// false-positive filter, feeding the existing heal stack.
//
// Detect → mask → inpaint, like one-click object removal: the photo server
// finds dust spots and sensor-spot candidates, the user accepts each spot,
// and the checked spots become ordinary repair strokes (one stroke id per
// spot) that the current repair method heals — grouping, undo, overlay
// persistence, and per-spot delete come free. This module holds the
// deterministic pieces:
//
// - proposeDustCandidates: classical luminance-contrast blob proposer.
// - scoreSpotFeatures / filterSpotsWithClassifier: the tiny ML stage — a
//   logistic-regression false-positive filter over per-candidate features.
// - spotsToRepairPoints: spots → single-disc repair strokes (the applied path).
// - spotsToRepairMask: spots → RepairMask (the detect→mask contract).
//
// Inputs are never mutated; spot centers/radii are normalized 0..1 so the
// client maps them straight onto retouch coordinates.

import type { RetouchPoint } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";
import { assertValidMask, type RepairMask } from "./inpaint.js";

/** Client downsample long edge for dust-spot requests (spots are small, so this stays high). */
export const DUST_SPOTS_WORKING_WIDTH = 1280;
/** Cap on reported spots (repairs stay individually editable below this). */
export const DUST_SPOTS_MAX_SPOTS = 60;
/** Minimum luminance delta vs the local background to seed a blob (0..255). */
export const DUST_SPOTS_CONTRAST_THRESHOLD = 12;
/** Smallest blob area in working-res pixels (kills single-pixel noise). */
export const DUST_SPOTS_MIN_AREA_PX = 5;
/** Largest blob area in working-res pixels (dust spots are small; bigger regions are content). */
export const DUST_SPOTS_MAX_AREA_PX = 1600;
/** Fixed confidence reported by the classical proposer (approximate by design). */
export const DUST_SPOTS_CLASSIC_SCORE = 0.5;
/** Default ML keep threshold on the classifier probability. */
export const DUST_SPOTS_SCORE_THRESHOLD = 0.5;
/** Repair-disc growth over the fitted spot radius (covers soft spot fringes). */
export const DUST_SPOTS_STROKE_MARGIN = 1.6;
/** Override env for a custom classifier-weights JSON path (mirrors F8_OBJECT_DETECT_*). */
export const DUST_SPOTS_WEIGHTS_ENV = "F8_DUST_SPOTS_WEIGHTS";
/** Set to "1" to serve classical candidates without the ML filter. */
export const DUST_SPOTS_OFFLINE_ENV = "F8_DUST_SPOTS_OFFLINE";

/**
 * Tiny ML model identity. The false-positive filter is a logistic regression
 * over four per-candidate features; its weights are small enough (five
 * floats) to live in source, so there is no weight download, no weight URL,
 * and no separate weight license — the coefficients ship with this file under
 * the repo's own terms. `F8_DUST_SPOTS_WEIGHTS` may point at a JSON file with
 * fitted replacements (see parseDustSpotsWeights).
 */
export const DUST_SPOTS_MODEL_ID = "dust-logreg";
export const DUST_SPOTS_MODEL_VERSION = "v1";

/** One dust/spot candidate: normalized center + x-normalized radius. */
export interface DustSpot {
  /** Normalized center x (0..1). */
  x: number;
  /** Normalized center y (0..1). */
  y: number;
  /** Disc radius in x-normalized units (repair size = 2 * radius). */
  radius: number;
  /** 0..1; classifier probability, or 0.5 (approximate) from classical-only mode. */
  score: number;
  /** Dark sensor dust vs bright spot (salt speck, hot pixel cluster). */
  polarity: "dark" | "bright";
}

/** Which stage served the answer: ML-filtered candidates or classical-only. */
export type DustSpotsSource = "ml" | "classic";

/** Per-candidate features the ML filter scores (all roughly 0..1). */
export interface DustSpotFeatures {
  /** Mean |luminance - background| over the blob, /255. */
  contrast: number;
  /** Blob size between the min/max area gates (0 = tiny, 1 = huge). */
  size: number;
  /** Blob area / bounding-box area (dust is compact, scratches are not). */
  circularity: number;
  /** 1 at the image border → 0 deep inside (edge blobs are often vignetting/crop). */
  border: number;
}

/** Logistic-regression coefficients for the false-positive filter. */
export interface DustSpotsWeights {
  bias: number;
  contrast: number;
  size: number;
  circularity: number;
  border: number;
}

/**
 * Embedded v1 coefficients: strong contrast and compact shape vote for dust,
 * large size and border proximity vote against. Set by inspection against the
 * synthetic fixtures in dust-spots.test.ts; replace with fitted values via
 * F8_DUST_SPOTS_WEIGHTS (validated by parseDustSpotsWeights).
 */
export const DUST_SPOTS_CLASSIFIER_WEIGHTS: DustSpotsWeights = {
  bias: -0.8,
  contrast: 5.0,
  size: -2.5,
  circularity: 2.0,
  border: -2.0,
};

/**
 * Validate an external classifier-weights JSON document
 * ({bias, contrast, size, circularity, border} plus optional version/model).
 * Returns the coefficients or throws RangeError (routes answer 400/503).
 */
export function parseDustSpotsWeights(raw: unknown): DustSpotsWeights {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RangeError("Dust-spots weights must be an object.");
  }
  const v = raw as Record<string, unknown>;
  const weights: DustSpotsWeights = { bias: 0, contrast: 0, size: 0, circularity: 0, border: 0 };
  for (const key of ["bias", "contrast", "size", "circularity", "border"] as const) {
    const value = v[key];
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 100) {
      throw new RangeError(`Dust-spots weights need a finite "${key}" coefficient.`);
    }
    weights[key] = value;
  }
  return weights;
}

/** Logistic probability that a candidate is real dust (not a false positive). */
export function scoreSpotFeatures(
  features: DustSpotFeatures,
  weights: DustSpotsWeights = DUST_SPOTS_CLASSIFIER_WEIGHTS,
): number {
  const z =
    weights.bias +
    weights.contrast * features.contrast +
    weights.size * features.size +
    weights.circularity * features.circularity +
    weights.border * features.border;
  return 1 / (1 + Math.exp(-z));
}

export interface ProposeDustCandidatesOptions {
  contrastThreshold?: number;
  minAreaPx?: number;
  maxAreaPx?: number;
  maxSpots?: number;
}

function luminanceAt(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
}

/**
 * Classical blob proposer: pixels whose luminance differs from the local
 * background (box-blurred luminance) by more than the contrast threshold seed
 * dark/bright regions; connected components gated on area, bbox aspect, and
 * fill ratio become candidates. Scores are the fixed approximate value — the
 * ML filter (filterSpotsWithClassifier) replaces them with probabilities.
 */
export function proposeDustCandidates(
  image: PixelImage,
  options: ProposeDustCandidatesOptions = {},
): Array<DustSpot & { features: DustSpotFeatures }> {
  assertValidImage(image);
  const contrastThreshold = options.contrastThreshold ?? DUST_SPOTS_CONTRAST_THRESHOLD;
  const minArea = options.minAreaPx ?? DUST_SPOTS_MIN_AREA_PX;
  const maxArea = options.maxAreaPx ?? DUST_SPOTS_MAX_AREA_PX;
  const maxSpots = options.maxSpots ?? DUST_SPOTS_MAX_SPOTS;
  const { width, height, data } = image;

  // Luminance + integral image for O(1) box-blur background queries.
  const lum = new Float32Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    lum[p] = luminanceAt(data, p * 4);
  }
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += lum[y * width + x] ?? 0;
      integral[(y + 1) * (width + 1) + (x + 1)] = (integral[y * (width + 1) + (x + 1)] ?? 0) + row;
    }
  }
  // Background window: wide enough to swallow a dust spot, narrow enough to
  // track gradients (sky, vignetting). Clamped so tiny test images still work.
  const bgRadius = Math.max(4, Math.min(24, Math.floor(Math.min(width, height) / 32)));
  const backgroundAt = (x: number, y: number): number => {
    const x0 = Math.max(0, x - bgRadius);
    const y0 = Math.max(0, y - bgRadius);
    const x1 = Math.min(width - 1, x + bgRadius);
    const y1 = Math.min(height - 1, y + bgRadius);
    const sum =
      (integral[(y1 + 1) * (width + 1) + (x1 + 1)] ?? 0) -
      (integral[y0 * (width + 1) + (x1 + 1)] ?? 0) -
      (integral[(y1 + 1) * (width + 1) + x0] ?? 0) +
      (integral[y0 * (width + 1) + x0] ?? 0);
    return sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
  };

  // Sign map: -1 dark seed, +1 bright seed, 0 background.
  const sign = new Int8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const diff = (lum[y * width + x] ?? 0) - backgroundAt(x, y);
      if (diff <= -contrastThreshold) sign[y * width + x] = -1;
      else if (diff >= contrastThreshold) sign[y * width + x] = 1;
    }
  }

  // Connected components per sign (4-neighbourhood BFS).
  interface Blob {
    polarity: "dark" | "bright";
    count: number;
    sumX: number;
    sumY: number;
    sumContrast: number;
    sumLum: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    touchesBorder: boolean;
  }
  const seen = new Uint8Array(width * height);
  const blobs: Blob[] = [];
  for (let seed = 0; seed < sign.length; seed += 1) {
    const seedSign = sign[seed] ?? 0;
    if (seedSign === 0 || seen[seed]) continue;
    const blob: Blob = {
      polarity: seedSign < 0 ? "dark" : "bright",
      count: 0,
      sumX: 0,
      sumY: 0,
      sumContrast: 0,
      sumLum: 0,
      minX: width,
      minY: height,
      maxX: -1,
      maxY: -1,
      touchesBorder: false,
    };
    const queue = [seed];
    seen[seed] = 1;
    while (queue.length > 0) {
      const p = queue.pop() ?? 0;
      const x = p % width;
      const y = (p - x) / width;
      blob.count += 1;
      blob.sumX += x + 0.5;
      blob.sumY += y + 0.5;
      blob.sumContrast += Math.abs((lum[p] ?? 0) - backgroundAt(x, y));
      blob.sumLum += lum[p] ?? 0;
      if (x < blob.minX) blob.minX = x;
      if (x > blob.maxX) blob.maxX = x;
      if (y < blob.minY) blob.minY = y;
      if (y > blob.maxY) blob.maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) blob.touchesBorder = true;
      if (x > 0 && sign[p - 1] === seedSign && !seen[p - 1]) { seen[p - 1] = 1; queue.push(p - 1); }
      if (x + 1 < width && sign[p + 1] === seedSign && !seen[p + 1]) { seen[p + 1] = 1; queue.push(p + 1); }
      if (y > 0 && sign[p - width] === seedSign && !seen[p - width]) { seen[p - width] = 1; queue.push(p - width); }
      if (y + 1 < height && sign[p + width] === seedSign && !seen[p + width]) { seen[p + width] = 1; queue.push(p + width); }
    }
    blobs.push(blob);
  }

  const spots: Array<DustSpot & { features: DustSpotFeatures }> = [];
  for (const blob of blobs) {
    if (blob.count < minArea || blob.count > maxArea) continue;
    const bw = blob.maxX - blob.minX + 1;
    const bh = blob.maxY - blob.minY + 1;
    const aspect = bh / Math.max(1, bw);
    if (aspect < 0.35 || aspect > 1 / 0.35) continue;
    const fill = blob.count / (bw * bh);
    if (fill < 0.3) continue;
    // Ring verification: the box-blur background is pulled toward the blob
    // itself, so background pixels hugging a strong spot seed opposite-sign
    // halos. A real spot still contrasts against its surrounding ring of
    // background pixels; a halo does not. Too few ring pixels (tight border
    // crop) keeps the blob — unverifiable, not guilty.
    const ringPad = 3;
    const rx0 = Math.max(0, blob.minX - ringPad);
    const ry0 = Math.max(0, blob.minY - ringPad);
    const rx1 = Math.min(width - 1, blob.maxX + ringPad);
    const ry1 = Math.min(height - 1, blob.maxY + ringPad);
    let ringSum = 0;
    let ringCount = 0;
    for (let ry = ry0; ry <= ry1; ry += 1) {
      for (let rx = rx0; rx <= rx1; rx += 1) {
        const q = ry * width + rx;
        // Only unseeded background pixels: any seed (blob or halo) would
        // pull the ring mean toward the blob and fake the contrast.
        if ((sign[q] ?? 0) !== 0) continue;
        ringSum += lum[q] ?? 0;
        ringCount += 1;
      }
    }
    if (ringCount >= 8) {
      const ringContrast = Math.abs(blob.sumLum / blob.count - ringSum / ringCount);
      if (ringContrast < contrastThreshold * 0.75) continue;
    }
    const cx = blob.sumX / blob.count / width;
    const cy = blob.sumY / blob.count / height;
    // Equivalent-disc radius from the blob area (x-normalized, like repair size).
    const radius = Math.sqrt(blob.count / Math.PI) / width;
    const edgePx = Math.min(blob.minX, blob.minY, width - 1 - blob.maxX, height - 1 - blob.maxY);
    const features: DustSpotFeatures = {
      contrast: Math.min(1, blob.sumContrast / blob.count / 255),
      size: Math.min(1, Math.max(0, (blob.count - minArea) / Math.max(1, maxArea - minArea))),
      circularity: Math.min(1, fill),
      border: blob.touchesBorder ? 1 : Math.max(0, 1 - edgePx / Math.max(8, bgRadius * 2)),
    };
    spots.push({
      x: Math.min(1, Math.max(0, cx)),
      y: Math.min(1, Math.max(0, cy)),
      radius,
      score: DUST_SPOTS_CLASSIC_SCORE,
      polarity: blob.polarity,
      features,
    });
  }
  // Strongest first so the cap keeps the most plausible dust.
  spots.sort((a, b) => b.features.contrast * (1 - b.features.size) - a.features.contrast * (1 - a.features.size));
  return spots.slice(0, Math.max(1, maxSpots));
}

export interface FilterSpotsOptions {
  threshold?: number;
  maxSpots?: number;
  weights?: DustSpotsWeights;
}

/**
 * The tiny ML stage: score classical candidates with the logistic-regression
 * false-positive filter, drop everything below the threshold, and return
 * score-descending DustSpots (features stripped — the API response shape).
 */
export function filterSpotsWithClassifier(
  candidates: ReadonlyArray<DustSpot & { features: DustSpotFeatures }>,
  options: FilterSpotsOptions = {},
): DustSpot[] {
  const threshold = options.threshold ?? DUST_SPOTS_SCORE_THRESHOLD;
  const maxSpots = options.maxSpots ?? DUST_SPOTS_MAX_SPOTS;
  const weights = options.weights ?? DUST_SPOTS_CLASSIFIER_WEIGHTS;
  return candidates
    .map(({ features, ...spot }) => ({ ...spot, score: scoreSpotFeatures(features, weights) }))
    .filter((spot) => spot.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxSpots));
}

export interface SpotsToPointsOptions {
  /** First stroke id; each spot takes the next id so repairs stay separable. */
  stroke?: number;
  /** Brush strength 1..100 (default 100: full removal). */
  strength?: number;
  /** Disc growth over the fitted spot radius (default DUST_SPOTS_STROKE_MARGIN). */
  margin?: number;
}

/**
 * One repair disc per spot, grown by the margin to cover soft fringes. Each
 * spot gets its own stroke id, so the user can delete one spot's repair
 * without touching the others. Returns valid RetouchPoints.
 */
export function spotsToRepairPoints(
  spots: readonly DustSpot[],
  options: SpotsToPointsOptions = {},
): RetouchPoint[] {
  const strength = options.strength === undefined ? 100 : Math.min(100, Math.max(1, Math.round(options.strength)));
  const margin = options.margin === undefined ? DUST_SPOTS_STROKE_MARGIN : Math.max(1, options.margin);
  const baseStroke = options.stroke === undefined ? 1 : Math.max(1, Math.floor(options.stroke));
  return spots.flatMap((spot, index): RetouchPoint[] => {
    if (!Number.isFinite(spot.x) || !Number.isFinite(spot.y) || !Number.isFinite(spot.radius)) return [];
    if (spot.x < 0 || spot.x > 1 || spot.y < 0 || spot.y > 1 || spot.radius <= 0) return [];
    return [{
      x: spot.x,
      y: spot.y,
      size: 2 * spot.radius * margin,
      strength,
      kind: "repair",
      stroke: baseStroke + index,
    }];
  });
}

/**
 * Fill each spot's disc into an 8-bit RepairMask (the detect→mask contract:
 * disc interior is `value`, everything else 0). The stroke path
 * (spotsToRepairPoints → rasterizeRepairMask) is what the app applies; this
 * direct mask is the interchange shape for callers that already hold a mask
 * pipeline.
 */
export function spotsToRepairMask(
  spots: readonly DustSpot[],
  width: number,
  height: number,
  value = 255,
): RepairMask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${width}x${height}.`);
  }
  const fill = Math.min(255, Math.max(1, Math.round(value)));
  const data = new Uint8ClampedArray(width * height);
  for (const spot of spots) {
    if (!Number.isFinite(spot.x) || !Number.isFinite(spot.y) || !Number.isFinite(spot.radius)) continue;
    if (spot.radius <= 0) continue;
    const cx = spot.x * width;
    const cy = spot.y * height;
    const radius = spot.radius * width;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= radius * radius) {
          data[y * width + x] = fill;
        }
      }
    }
  }
  const mask = { width, height, data };
  assertValidMask(mask);
  return mask;
}
