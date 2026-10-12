// One-click object removal: pure, dependency-free detection helpers shared by
// the photo server and the web client.
//
// Detect → mask → inpaint: a small ONNX detector (YOLOv8n, ~12MB) finds
// people, its boxes become repair strokes, and the existing ROI→inpaint
// pipeline heals them — no new inference path. This module holds the
// deterministic pieces:
//
// - packObjectDetectInput: letterboxed resize to the 640 detector grid.
// - parseYoloDetections: YOLOv8 [84,8400] output → person boxes + NMS.
// - detectionsToRepairPoints: boxes → repair-stroke discs (one stroke id per
//   detection, so each removal stays individually editable/deletable).
// - detectionsToRepairMask: boxes → RepairMask (the detect→mask contract).
// - proposePersonCandidates: classical skin-tone proposer that serves when
//   ONNX weights are absent (offline) — approximate by design.
//
// Inputs are never mutated; boxes are normalized 0..1 (resolution-free, so
// the client maps them straight onto retouch coordinates).

import type { RetouchPoint } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";
import { assertValidMask, type RepairMask } from "./inpaint.js";

/** Detector grid: YOLOv8n exports run at 640x640. */
export const OBJECT_DETECT_SIZE = 640;
/** Single-file ONNX weights, lazily downloaded once into the model dir. */
export const OBJECT_DETECT_FILE = "yolov8n.onnx";
/** Approximate fp32 download size in bytes. */
export const OBJECT_DETECT_FILE_SIZE = 12 * 1024 * 1024;
/** Default weights: official Ultralytics ONNX export (AGPL-3.0). Overridable at runtime. */
export const OBJECT_DETECT_DEFAULT_URL =
  "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx";
/** License of the default weights (Ultralytics YOLOv8). */
export const OBJECT_DETECT_LICENSE = "AGPL-3.0";
/** Override env for the weight URL (mirrors F8_ML_HEAL_*). */
export const OBJECT_DETECT_URL_ENV = "F8_OBJECT_DETECT_URL";
export const OBJECT_DETECT_DIR_ENV = "F8_OBJECT_DETECT_DIR";
/** Set to "1" to disable weight downloads (server still serves the classical fallback). */
export const OBJECT_DETECT_OFFLINE_ENV = "F8_OBJECT_DETECT_OFFLINE";
/** Client downsample width for detect requests (long edge; keeps payloads small). */
export const OBJECT_DETECT_WORKING_WIDTH = 640;
/** COCO class index for person — the only v1 removal target. */
export const OBJECT_DETECT_PERSON_CLASS = 0;
/** Labels the detector can return (v1: people only). */
export const OBJECT_DETECT_LABELS = ["person"] as const;
export type ObjectDetectLabel = (typeof OBJECT_DETECT_LABELS)[number];
/** Minimum class score to keep a box. */
export const OBJECT_DETECT_SCORE_THRESHOLD = 0.3;
/** NMS overlap above which the lower-scoring box is suppressed. */
export const OBJECT_DETECT_IOU_THRESHOLD = 0.45;
/** Cap on reported detections (mirrors HEAL_OVERLAY_MAX_AREAS). */
export const OBJECT_DETECT_MAX_DETECTIONS = 20;
/** Letterbox pad gray (YOLO convention), 0..255 per channel. */
export const OBJECT_DETECT_PAD_VALUE = 114;

/** Normalized box in 0..1 image coordinates (x0 <= x1, y0 <= y1). */
export interface DetectedBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One detected removal candidate. */
export interface DetectedObject {
  label: ObjectDetectLabel;
  /** 0..1; ONNX class score, or 0.5 (approximate) from the classical fallback. */
  score: number;
  box: DetectedBox;
}

/** Which proposer served the answer: neural weights or the classical fallback. */
export type ObjectDetectSource = "onnx" | "classic";

/** Letterbox geometry mapping the 640 grid back to source pixels. */
export interface ObjectDetectLetterbox {
  /** Uniform scale applied to the source (grid = src * scale + pad). */
  scale: number;
  padX: number;
  padY: number;
  srcWidth: number;
  srcHeight: number;
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
 * Pack an RGBA image to 1x3x640x640 float32 (RGB 0..1, NCHW channel-major)
 * via aspect-preserving letterbox (YOLO convention: uniform scale, gray pad).
 * Returns the tensor plus the letterbox geometry for mapping boxes back.
 */
export function packObjectDetectInput(image: PixelImage): { data: Float32Array; letterbox: ObjectDetectLetterbox } {
  assertValidImage(image);
  const size = OBJECT_DETECT_SIZE;
  const scale = Math.min(size / image.width, size / image.height);
  const scaledW = image.width * scale;
  const scaledH = image.height * scale;
  const padX = (size - scaledW) / 2;
  const padY = (size - scaledH) / 2;
  const pad = OBJECT_DETECT_PAD_VALUE / 255;
  const data = new Float32Array(3 * size * size);
  data.fill(pad);
  const plane = size * size;
  for (let gy = 0; gy < size; gy += 1) {
    for (let gx = 0; gx < size; gx += 1) {
      const sx = (gx + 0.5 - padX) / scale - 0.5;
      const sy = (gy + 0.5 - padY) / scale - 0.5;
      if (sx < 0 || sy < 0 || sx > image.width - 1 || sy > image.height - 1) continue;
      const p = gy * size + gx;
      data[p] = bilinearChannelAt(image.data, image.width, image.height, sx, sy, 0) / 255;
      data[plane + p] = bilinearChannelAt(image.data, image.width, image.height, sx, sy, 1) / 255;
      data[2 * plane + p] = bilinearChannelAt(image.data, image.width, image.height, sx, sy, 2) / 255;
    }
  }
  return { data, letterbox: { scale, padX, padY, srcWidth: image.width, srcHeight: image.height } };
}

/**
 * Map one YOLO box (center x/y/width/height in 640-grid pixels) through the
 * letterbox to normalized 0..1 source coordinates. Returns null when the box
 * collapses (fully inside the pad or degenerate).
 */
export function mapYoloBoxToNormalized(
  cx: number,
  cy: number,
  w: number,
  h: number,
  letterbox: ObjectDetectLetterbox,
): DetectedBox | null {
  if (![cx, cy, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const scaledW = letterbox.srcWidth * letterbox.scale;
  const scaledH = letterbox.srcHeight * letterbox.scale;
  if (scaledW <= 0 || scaledH <= 0) return null;
  const x0 = Math.max(0, Math.min(1, (cx - w / 2 - letterbox.padX) / scaledW));
  const y0 = Math.max(0, Math.min(1, (cy - h / 2 - letterbox.padY) / scaledH));
  const x1 = Math.max(0, Math.min(1, (cx + w / 2 - letterbox.padX) / scaledW));
  const y1 = Math.max(0, Math.min(1, (cy + h / 2 - letterbox.padY) / scaledH));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function boxIoU(a: DetectedBox, b: DetectedBox): number {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (inter <= 0) return 0;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return union <= 0 ? 0 : inter / union;
}

export interface ParseYoloOptions {
  scoreThreshold?: number;
  iouThreshold?: number;
  maxDetections?: number;
}

/**
 * Parse a YOLOv8 detection output (batch 1, [84,8400] row-major: rows 0..3
 * are cx/cy/w/h in grid pixels, rows 4..83 are the COCO class scores) into
 * person detections. Score-filters, maps through the letterbox, applies NMS,
 * and caps the count. Returns score-descending detections.
 */
export function parseYoloDetections(
  output: ArrayLike<number>,
  letterbox: ObjectDetectLetterbox,
  options: ParseYoloOptions = {},
): DetectedObject[] {
  const ROWS = 84;
  const COLS = 8400;
  if (output.length !== ROWS * COLS) {
    throw new RangeError(`Expected a YOLOv8 [84,8400] output (${ROWS * COLS} floats), got ${output.length}.`);
  }
  const scoreThreshold = options.scoreThreshold ?? OBJECT_DETECT_SCORE_THRESHOLD;
  const iouThreshold = options.iouThreshold ?? OBJECT_DETECT_IOU_THRESHOLD;
  const maxDetections = options.maxDetections ?? OBJECT_DETECT_MAX_DETECTIONS;
  const candidates: DetectedObject[] = [];
  for (let c = 0; c < COLS; c += 1) {
    const score = output[(4 + OBJECT_DETECT_PERSON_CLASS) * COLS + c] ?? 0;
    if (!Number.isFinite(score) || score < scoreThreshold) continue;
    const box = mapYoloBoxToNormalized(
      output[c] ?? 0,
      output[COLS + c] ?? 0,
      output[2 * COLS + c] ?? 0,
      output[3 * COLS + c] ?? 0,
      letterbox,
    );
    if (!box) continue;
    candidates.push({ label: "person", score, box });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: DetectedObject[] = [];
  for (const candidate of candidates) {
    if (kept.length >= maxDetections) break;
    if (kept.some((other) => boxIoU(candidate.box, other.box) > iouThreshold)) continue;
    kept.push(candidate);
  }
  return kept;
}

export interface DetectionsToPointsOptions {
  /** First stroke id; each detection takes the next id so removals stay separable. */
  stroke?: number;
  /** Brush strength 1..100 (default 100: full removal). */
  strength?: number;
  /** Cap on discs per detection (default 48); larger boxes get larger discs. */
  maxPointsPerDetection?: number;
}

/**
 * Cover each detection box with overlapping repair-stroke discs (50% overlap,
 * so the rasterized mask has no gaps). Disc size is width-relative, matching
 * rasterizeRepairMask (radius = size * width / 2); `aspect` is width/height.
 * Each detection gets its own stroke id, so the user can delete one person's
 * removal without touching the others. Returns valid RetouchPoints.
 */
export function detectionsToRepairPoints(
  detections: readonly DetectedObject[],
  aspect: number,
  options: DetectionsToPointsOptions = {},
): RetouchPoint[] {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError(`Expected a positive image aspect ratio, got ${aspect}.`);
  }
  const strength = options.strength === undefined ? 100 : Math.min(100, Math.max(1, Math.round(options.strength)));
  const maxPoints = options.maxPointsPerDetection ?? 48;
  const baseStroke = options.stroke === undefined ? 1 : Math.max(1, Math.floor(options.stroke));
  const points: RetouchPoint[] = [];
  detections.forEach((detection, index) => {
    const { x0, y0, x1, y1 } = detection.box;
    const w = Math.min(1, Math.max(0, x1)) - Math.min(1, Math.max(0, x0));
    const h = Math.min(1, Math.max(0, y1)) - Math.min(1, Math.max(0, y0));
    if (!(w > 0) || !(h > 0)) return;
    // Disc radius in x-normalized units; grow it until the grid fits the cap.
    let r = Math.max(Math.max(w, h / aspect) / 4, 0.008);
    for (;;) {
      const nx = Math.max(1, Math.ceil(w / r));
      const ny = Math.max(1, Math.ceil(h / aspect / r));
      if (nx * ny <= Math.max(1, maxPoints) || r >= 1) break;
      r *= 1.5;
    }
    const nx = Math.max(1, Math.ceil(w / r));
    const ny = Math.max(1, Math.ceil(h / aspect / r));
    const stepX = w / nx;
    const stepY = h / ny;
    const size = 2 * r;
    const stroke = baseStroke + index;
    for (let iy = 0; iy < ny; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        points.push({
          x: Math.min(1, Math.max(0, x0 + (ix + 0.5) * stepX)),
          y: Math.min(1, Math.max(0, y0 + (iy + 0.5) * stepY)),
          size,
          strength,
          kind: "repair",
          stroke,
        });
      }
    }
  });
  return points;
}

/**
 * Fill each detection box into an 8-bit RepairMask (the detect→mask
 * contract: box interior is `value`, everything else 0). The stroke path
 * (detectionsToRepairPoints → rasterizeRepairMask) is what the app applies;
 * this direct mask is the interchange shape for callers that already hold a
 * mask pipeline.
 */
export function detectionsToRepairMask(
  detections: readonly DetectedObject[],
  width: number,
  height: number,
  value = 255,
): RepairMask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${width}x${height}.`);
  }
  const fill = Math.min(255, Math.max(1, Math.round(value)));
  const data = new Uint8ClampedArray(width * height);
  for (const detection of detections) {
    const { x0, y0, x1, y1 } = detection.box;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) * width));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) * width) - 1);
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) * height));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) * height) - 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        data[y * width + x] = fill;
      }
    }
  }
  const mask = { width, height, data };
  assertValidMask(mask);
  return mask;
}

/** Fixed confidence reported by the classical proposer (approximate by design). */
export const OBJECT_DETECT_CLASSIC_SCORE = 0.5;
/** Coarse grid width for the skin-tone connected-components pass. */
const CLASSIC_GRID_WIDTH = 160;
/** Minimum blob size as a fraction of image area (kills speckles). */
const CLASSIC_MIN_AREA_FRACTION = 0.002;
/** Blob box expansion per side: skin under-covers a clothed person. */
const CLASSIC_BOX_EXPAND = 0.25;

/** Kovac-style skin rule on RGB (broad across skin tones; lighting-sensitive). */
function isSkinPixel(r: number, g: number, b: number): boolean {
  if (!(r > 95 && g > 40 && b > 20)) return false;
  if (!(r > g && r > b)) return false;
  if (!(r - g > 15)) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 15;
}

/**
 * Classical person proposer: skin-tone blobs → expanded boxes. Serves when
 * ONNX weights are absent (offline first run, download disabled). Approximate
 * by design — it misses clothed figures without visible skin and can fire on
 * warm wood/brick — so results always carry the fixed approximate score and
 * the UI labels them as a classical scan, never ML.
 */
export function proposePersonCandidates(image: PixelImage): DetectedObject[] {
  assertValidImage(image);
  const scale = Math.min(1, CLASSIC_GRID_WIDTH / image.width);
  const gw = Math.max(1, Math.round(image.width * scale));
  const gh = Math.max(1, Math.round(image.height * scale));
  const skin = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const sx = Math.min(image.width - 1, Math.floor((gx + 0.5) / scale));
      const sy = Math.min(image.height - 1, Math.floor((gy + 0.5) / scale));
      const i = (sy * image.width + sx) * 4;
      if (isSkinPixel(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0)) {
        skin[gy * gw + gx] = 1;
      }
    }
  }
  // Connected components (4-neighbourhood BFS) over the coarse skin grid.
  const seen = new Uint8Array(gw * gh);
  const boxes: DetectedBox[] = [];
  const minPixels = Math.max(4, Math.floor(gw * gh * CLASSIC_MIN_AREA_FRACTION));
  for (let seed = 0; seed < skin.length; seed += 1) {
    if (!skin[seed] || seen[seed]) continue;
    let count = 0;
    let minX = gw;
    let minY = gh;
    let maxX = -1;
    let maxY = -1;
    const queue = [seed];
    seen[seed] = 1;
    while (queue.length > 0) {
      const p = queue.pop() ?? 0;
      const x = p % gw;
      const y = (p - x) / gw;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && skin[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; queue.push(p - 1); }
      if (x + 1 < gw && skin[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; queue.push(p + 1); }
      if (y > 0 && skin[p - gw] && !seen[p - gw]) { seen[p - gw] = 1; queue.push(p - gw); }
      if (y + 1 < gh && skin[p + gw] && !seen[p + gw]) { seen[p + gw] = 1; queue.push(p + gw); }
    }
    if (count < minPixels) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bh / Math.max(1, bw);
    if (aspect < 0.5 || aspect > 5) continue;
    const ex = (bw * CLASSIC_BOX_EXPAND) / gw;
    const ey = (bh * CLASSIC_BOX_EXPAND) / gh;
    boxes.push({
      x0: Math.max(0, minX / gw - ex),
      y0: Math.max(0, minY / gh - ey),
      x1: Math.min(1, (maxX + 1) / gw + ex),
      y1: Math.min(1, (maxY + 1) / gh + ey),
    });
  }
  // Merge overlaps (a torso split by a shadow gap is one person).
  const merged: DetectedBox[] = [];
  for (const box of boxes) {
    const hit = merged.find((other) => boxIoU(box, other) > 0.3);
    if (!hit) {
      merged.push({ ...box });
    } else {
      hit.x0 = Math.min(hit.x0, box.x0);
      hit.y0 = Math.min(hit.y0, box.y0);
      hit.x1 = Math.max(hit.x1, box.x1);
      hit.y1 = Math.max(hit.y1, box.y1);
    }
  }
  return merged
    .slice(0, OBJECT_DETECT_MAX_DETECTIONS)
    .map((box) => ({ label: "person" as const, score: OBJECT_DETECT_CLASSIC_SCORE, box }));
}
