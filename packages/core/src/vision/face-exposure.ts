// Face-aware exposure / white balance: pure, dependency-free detection and
// correction helpers shared by the photo server and the web client.
//
// A small ONNX face detector (YuNet, ~227KB) finds faces with eye landmarks;
// the faces then drive three corrections:
// - skin-anchored white balance: temperature/tint from skin-tone means
//   inside the face boxes instead of whole-image means;
// - masked face lift: softly feathered exposure ellipses over underexposed
//   faces, stored in the recipe as EditState.faceAdjust;
// - auto red-eye removal: red pupils suppressed inside the eye regions,
//   stored alongside the lift as fix discs.
//
// This module holds the deterministic pieces:
// - packFaceDetectInput: stretch resize to the 640 YuNet grid (BGR float32,
//   matching OpenCV blobFromImage defaults: no normalization).
// - parseYuNetFaces: raw YuNet stride heads (cls/obj/bbox/kps at strides
//   8/16/32) → faces with eye landmarks + NMS. A faithful port of the
//   OpenCV FaceDetectorYN postprocess (modules/objdetect/src/face_detect.cpp).
// - proposeFaceCandidates: classical skin-tone proposer that serves when
//   ONNX weights are absent (offline) — approximate by design.
// - computeFaceWhiteBalance / faceLiftAmount / findRedEyeSpots: the three
//   corrections, plus faceLiftMask / applyFaceLift / applyRedEyeFix, which
//   the adjustment pipeline renders from the recipe.
//
// Inputs are never mutated (except the documented in-place buffer passes,
// which take a caller-owned buffer); boxes, eyes, and spots are normalized
// 0..1, so the client maps them straight onto recipe coordinates.

import type { EditState, FaceAdjustState, FaceBox, FacePoint, RedEyeSpot } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";
import { whiteBalancePatchFromMeans, type WhiteBalanceAutoPatch } from "./enhance.js";
import { isSkinPixel } from "./scene-enhance.js";

/** YuNet grid: the 2023mar ONNX export runs at 640x640. */
export const FACE_DETECT_SIZE = 640;
/** Single-file ONNX weights, lazily downloaded once into the model dir. */
export const FACE_DETECT_FILE = "face_detection_yunet_2023mar.onnx";
/** Approximate download size in bytes (measured from the zoo asset). */
export const FACE_DETECT_FILE_SIZE = 232_589;
/**
 * Default weights: OpenCV Zoo YuNet 2023mar (Apache-2.0). Overridable at
 * runtime. Note the github.com /raw/ path (not raw.githubusercontent.com):
 * the zoo stores weights in Git LFS, and the raw host serves the 131-byte
 * LFS pointer instead of the weights.
 */
export const FACE_DETECT_DEFAULT_URL =
  "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx";
/** License of the default weights (OpenCV Zoo). */
export const FACE_DETECT_LICENSE = "Apache-2.0";
/** Override env for the weight URL (mirrors F8_OBJECT_DETECT_*). */
export const FACE_DETECT_URL_ENV = "F8_FACE_DETECT_URL";
export const FACE_DETECT_DIR_ENV = "F8_FACE_DETECT_DIR";
/** Set to "1" to disable weight downloads (server still serves the classical fallback). */
export const FACE_DETECT_OFFLINE_ENV = "F8_FACE_DETECT_OFFLINE";
/** Client downsample width for detect requests (long edge; keeps payloads small). */
export const FACE_DETECT_WORKING_WIDTH = 640;
/** YuNet prediction strides (grids are 80/40/20 at the 640 input). */
export const FACE_DETECT_STRIDES = [8, 16, 32] as const;
/** Minimum sqrt(cls * obj) score to keep a face (OpenCV default). */
export const FACE_DETECT_SCORE_THRESHOLD = 0.6;
/** NMS overlap above which the lower-scoring face is suppressed (OpenCV default). */
export const FACE_DETECT_IOU_THRESHOLD = 0.3;
/** Cap on reported faces. */
export const FACE_DETECT_MAX_FACES = 20;
/** Fixed confidence reported by the classical proposer (approximate by design). */
export const FACE_DETECT_CLASSIC_SCORE = 0.5;
/** Minimum skin pixels inside the faces for a skin-anchored WB (working res). */
export const FACE_SKIN_MIN_PIXELS = 64;
/** Mean face luminance (0..255) at or above which no lift applies. */
export const FACE_LIFT_TARGET_LUMINANCE = 112;
/** Maximum masked lift in EV. */
export const FACE_LIFT_MAX_AMOUNT = 1;

/** One detected face: normalized box plus image-space eye landmarks. */
export interface DetectedFace {
  box: FaceBox;
  /** 0..1; YuNet score, or 0.5 (approximate) from the classical fallback. */
  score: number;
  /** Image-left eye (min-x landmark), or the proportional estimate (classic). */
  leftEye: FacePoint | null;
  /** Image-right eye (max-x landmark), or the proportional estimate (classic). */
  rightEye: FacePoint | null;
}

/** Stretch-resize geometry mapping the 640 grid back to source pixels. */
export interface FaceDetectGeometry {
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
 * Pack an RGBA image to 1x3x640x640 float32 (BGR 0..255, NCHW channel-major)
 * via stretch resize. Matches the OpenCV YuNet input: blobFromImage with
 * defaults (scalefactor 1.0, no mean subtraction, no channel swap). Returns
 * the tensor plus the source size for mapping detections back.
 */
export function packFaceDetectInput(image: PixelImage): { data: Float32Array; geometry: FaceDetectGeometry } {
  assertValidImage(image);
  const size = FACE_DETECT_SIZE;
  const data = new Float32Array(3 * size * size);
  const plane = size * size;
  const scaleX = image.width / size;
  const scaleY = image.height / size;
  for (let gy = 0; gy < size; gy += 1) {
    for (let gx = 0; gx < size; gx += 1) {
      const sx = (gx + 0.5) * scaleX - 0.5;
      const sy = (gy + 0.5) * scaleY - 0.5;
      const p = gy * size + gx;
      data[p] = bilinearChannelAt(image.data, image.width, image.height, sx, sy, 2);
      data[plane + p] = bilinearChannelAt(image.data, image.width, image.height, sx, sy, 1);
      data[2 * plane + p] = bilinearChannelAt(image.data, image.width, image.height, sx, sy, 0);
    }
  }
  return { data, geometry: { srcWidth: image.width, srcHeight: image.height } };
}

/** Raw YuNet head outputs, one Float32Array per stride (8/16/32). */
export interface YuNetOutputs {
  /** Per-cell face confidence, length (640/stride)^2 each. */
  cls: ArrayLike<number>[];
  /** Per-cell objectness, same shape as cls. */
  obj: ArrayLike<number>[];
  /** Per-cell box deltas (dx, dy, dw, dh), length cells*4 each. */
  bbox: ArrayLike<number>[];
  /** Per-cell landmarks (5 x,y pairs), length cells*10 each. */
  kps: ArrayLike<number>[];
}

export interface ParseYuNetOptions {
  scoreThreshold?: number;
  iouThreshold?: number;
  maxFaces?: number;
}

function faceBoxIoU(a: FaceBox, b: FaceBox): number {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (inter <= 0) return 0;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Decode raw YuNet stride heads into faces. Per cell: score =
 * sqrt(clamp(cls) * clamp(obj)); box center = (cell + delta) * stride,
 * size = exp(delta) * stride; landmarks = (cell + delta) * stride — then
 * score-filter, map the 640 grid to normalized source coordinates (the
 * pack stretches, so the mapping is linear), apply NMS, and cap the count.
 * Returns score-descending faces. Throws RangeError on misshaped outputs
 * (the server answers with the classical fallback instead).
 */
export function parseYuNetFaces(
  outputs: YuNetOutputs,
  _geometry: FaceDetectGeometry,
  options: ParseYuNetOptions = {},
): DetectedFace[] {
  const strides = [...FACE_DETECT_STRIDES];
  if (outputs.cls.length !== 3 || outputs.obj.length !== 3 || outputs.bbox.length !== 3 || outputs.kps.length !== 3) {
    throw new RangeError("Expected YuNet outputs for 3 strides (cls/obj/bbox/kps).");
  }
  const scoreThreshold = options.scoreThreshold ?? FACE_DETECT_SCORE_THRESHOLD;
  const iouThreshold = options.iouThreshold ?? FACE_DETECT_IOU_THRESHOLD;
  const maxFaces = options.maxFaces ?? FACE_DETECT_MAX_FACES;
  const size = FACE_DETECT_SIZE;
  const candidates: DetectedFace[] = [];
  strides.forEach((stride, s) => {
    const grid = size / stride;
    const cells = grid * grid;
    const cls = outputs.cls[s]!;
    const obj = outputs.obj[s]!;
    const bbox = outputs.bbox[s]!;
    const kps = outputs.kps[s]!;
    if (cls.length !== cells || obj.length !== cells || bbox.length !== cells * 4 || kps.length !== cells * 10) {
      throw new RangeError(`YuNet stride-${stride} outputs have the wrong shape.`);
    }
    for (let r = 0; r < grid; r += 1) {
      for (let c = 0; c < grid; c += 1) {
        const idx = r * grid + c;
        const clsScore = Math.min(1, Math.max(0, cls[idx] ?? 0));
        const objScore = Math.min(1, Math.max(0, obj[idx] ?? 0));
        const score = Math.sqrt(clsScore * objScore);
        if (!Number.isFinite(score) || score < scoreThreshold) continue;
        const dx = bbox[idx * 4] ?? 0;
        const dy = bbox[idx * 4 + 1] ?? 0;
        const dw = bbox[idx * 4 + 2] ?? 0;
        const dh = bbox[idx * 4 + 3] ?? 0;
        if (![dx, dy, dw, dh].every(Number.isFinite)) continue;
        const cx = (c + dx) * stride;
        const cy = (r + dy) * stride;
        const w = Math.exp(Math.min(dw, 8)) * stride;
        const h = Math.exp(Math.min(dh, 8)) * stride;
        const x0 = Math.max(0, Math.min(1, (cx - w / 2) / size));
        const y0 = Math.max(0, Math.min(1, (cy - h / 2) / size));
        const x1 = Math.max(0, Math.min(1, (cx + w / 2) / size));
        const y1 = Math.max(0, Math.min(1, (cy + h / 2) / size));
        if (x1 <= x0 || y1 <= y0) continue;
        let leftEye: FacePoint | null = null;
        let rightEye: FacePoint | null = null;
        const ex0 = (kps[idx * 10] ?? 0) + c;
        const ey0 = (kps[idx * 10 + 1] ?? 0) + r;
        const ex1 = (kps[idx * 10 + 2] ?? 0) + c;
        const ey1 = (kps[idx * 10 + 3] ?? 0) + r;
        if ([ex0, ey0, ex1, ey1].every(Number.isFinite)) {
          const first = { x: Math.max(0, Math.min(1, (ex0 * stride) / size)), y: Math.max(0, Math.min(1, (ey0 * stride) / size)) };
          const second = { x: Math.max(0, Math.min(1, (ex1 * stride) / size)), y: Math.max(0, Math.min(1, (ey1 * stride) / size)) };
          leftEye = first.x <= second.x ? first : second;
          rightEye = first.x <= second.x ? second : first;
        }
        candidates.push({ box: { x0, y0, x1, y1 }, score, leftEye, rightEye });
      }
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  const kept: DetectedFace[] = [];
  for (const candidate of candidates) {
    if (kept.length >= maxFaces) break;
    if (kept.some((other) => faceBoxIoU(candidate.box, other.box) > iouThreshold)) continue;
    kept.push(candidate);
  }
  return kept;
}

/** Coarse grid width for the skin-tone connected-components pass. */
const CLASSIC_GRID_WIDTH = 160;
/** Minimum blob size as a fraction of image area (kills speckles). */
const CLASSIC_MIN_AREA_FRACTION = 0.004;
/** Maximum blob size as a fraction of image area (a face is never half the photo). */
const CLASSIC_MAX_AREA_FRACTION = 0.5;
/** Blob box expansion per side: skin under-covers hair, ears, and chin. */
const CLASSIC_BOX_EXPAND = 0.2;

/** Proportional eye estimates for a classical box (no landmarks available). */
export function estimateEyesForBox(box: FaceBox): { leftEye: FacePoint; rightEye: FacePoint } {
  const w = box.x1 - box.x0;
  const y = Math.max(0, Math.min(1, box.y0 + (box.y1 - box.y0) * 0.38));
  return {
    leftEye: { x: Math.max(0, Math.min(1, box.x0 + w * 0.3)), y },
    rightEye: { x: Math.max(0, Math.min(1, box.x0 + w * 0.7)), y },
  };
}

/**
 * Classical face proposer: near-square skin-tone blobs → face boxes with
 * proportional eye estimates. Serves when ONNX weights are absent (offline
 * first run, download disabled). Approximate by design — it misses
 * non-skin-visible faces and can fire on warm wood/brick — so results
 * always carry the fixed approximate score and the UI labels them as a
 * classical scan, never ML.
 */
export function proposeFaceCandidates(image: PixelImage): DetectedFace[] {
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
  const boxes: FaceBox[] = [];
  const minPixels = Math.max(4, Math.floor(gw * gh * CLASSIC_MIN_AREA_FRACTION));
  const maxPixels = Math.max(minPixels + 1, Math.floor(gw * gh * CLASSIC_MAX_AREA_FRACTION));
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
    if (count < minPixels || count > maxPixels) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bh / Math.max(1, bw);
    if (aspect < 0.6 || aspect > 1.7) continue;
    if (count / (bw * bh) < 0.35) continue;
    const ex = (bw * CLASSIC_BOX_EXPAND) / gw;
    const ey = (bh * CLASSIC_BOX_EXPAND) / gh;
    const box = {
      x0: Math.max(0, minX / gw - ex),
      y0: Math.max(0, minY / gh - ey),
      x1: Math.min(1, (maxX + 1) / gw + ex),
      y1: Math.min(1, (maxY + 1) / gh + ey),
    };
    // A face is never nearly the whole frame: sprawling warm regions are
    // walls and wood, and a full-frame "face" would turn the masked lift
    // into a global exposure shift.
    if (box.x1 - box.x0 > 0.85 || box.y1 - box.y0 > 0.85) continue;
    boxes.push(box);
  }
  // Merge overlaps (a face split by a shadow gap is one face).
  const merged: FaceBox[] = [];
  for (const box of boxes) {
    const hit = merged.find((other) => faceBoxIoU(box, other) > 0.3);
    if (!hit) {
      merged.push({ ...box });
    } else {
      hit.x0 = Math.min(hit.x0, box.x0);
      hit.y0 = Math.min(hit.y0, box.y0);
      hit.x1 = Math.max(hit.x1, box.x1);
      hit.y1 = Math.max(hit.y1, box.y1);
    }
  }
  return merged.slice(0, FACE_DETECT_MAX_FACES).map((box) => {
    const { leftEye, rightEye } = estimateEyesForBox(box);
    return { box, score: FACE_DETECT_CLASSIC_SCORE, leftEye, rightEye };
  });
}

/** Mean RGB of the skin pixels inside the face boxes. */
export interface FaceSkinMeans {
  r: number;
  g: number;
  b: number;
  /** Skin pixels counted (working res). */
  count: number;
}

/** Accumulate skin-tone means over every face box (dedupe-free; overlaps are rare). */
export function faceSkinMeans(image: PixelImage, faces: readonly DetectedFace[]): FaceSkinMeans {
  assertValidImage(image);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const face of faces) {
    const minX = Math.max(0, Math.floor(Math.min(face.box.x0, face.box.x1) * image.width));
    const maxX = Math.min(image.width - 1, Math.ceil(Math.max(face.box.x0, face.box.x1) * image.width) - 1);
    const minY = Math.max(0, Math.floor(Math.min(face.box.y0, face.box.y1) * image.height));
    const maxY = Math.min(image.height - 1, Math.ceil(Math.max(face.box.y0, face.box.y1) * image.height) - 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const i = (y * image.width + x) * 4;
        const pr = image.data[i] ?? 0;
        const pg = image.data[i + 1] ?? 0;
        const pb = image.data[i + 2] ?? 0;
        if (!isSkinPixel(pr, pg, pb)) continue;
        r += pr;
        g += pg;
        b += pb;
        count += 1;
      }
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0, count: 0 };
  return { r: r / count, g: g / count, b: b / count, count };
}

/**
 * Skin-anchored white balance: the classic WB mapping
 * (whiteBalancePatchFromMeans) fed with skin-tone means from inside the
 * face boxes instead of whole-image means, so a blue-hour backdrop cannot
 * drag faces orange. Returns null when too few skin pixels anchor on
 * (the caller falls back to the classic whole-image auto).
 */
export function computeFaceWhiteBalance(
  image: PixelImage,
  faces: readonly DetectedFace[],
): WhiteBalanceAutoPatch | null {
  if (faces.length === 0) return null;
  const means = faceSkinMeans(image, faces);
  if (means.count < FACE_SKIN_MIN_PIXELS) return null;
  return whiteBalancePatchFromMeans(means.r, means.g, means.b);
}

/**
 * Mean Rec.709 luminance inside a face box, over skin pixels when the box
 * holds enough of them (hair and backdrops would drag the mean), else over
 * the whole box.
 */
export function faceMeanLuminance(image: PixelImage, box: FaceBox): number {
  assertValidImage(image);
  const minX = Math.max(0, Math.floor(Math.min(box.x0, box.x1) * image.width));
  const maxX = Math.min(image.width - 1, Math.ceil(Math.max(box.x0, box.x1) * image.width) - 1);
  const minY = Math.max(0, Math.floor(Math.min(box.y0, box.y1) * image.height));
  const maxY = Math.min(image.height - 1, Math.ceil(Math.max(box.y0, box.y1) * image.height) - 1);
  let skinSum = 0;
  let skinCount = 0;
  let sum = 0;
  let count = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i] ?? 0;
      const g = image.data[i + 1] ?? 0;
      const b = image.data[i + 2] ?? 0;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luminance;
      count += 1;
      if (isSkinPixel(r, g, b)) {
        skinSum += luminance;
        skinCount += 1;
      }
    }
  }
  if (count === 0) return 0;
  return skinCount >= 16 ? skinSum / skinCount : sum / count;
}

/**
 * Masked lift in EV that would move a face mean toward the target
 * luminance, given the preview pipeline maps exposure EV to a
 * 2^(EV * 0.6) gain. Faces at/above target need nothing; the lift caps at
 * FACE_LIFT_MAX_AMOUNT so a nightclub face never turns to gray mush.
 */
export function faceLiftAmount(meanLuminance: number): number {
  if (!(meanLuminance > 0) || meanLuminance >= FACE_LIFT_TARGET_LUMINANCE) return 0;
  const amount = Math.log2(FACE_LIFT_TARGET_LUMINANCE / Math.max(8, meanLuminance)) / 0.6;
  return Math.round(Math.min(FACE_LIFT_MAX_AMOUNT, Math.max(0, amount)) * 100) / 100;
}

/**
 * True when a stored face adjust carries information worth showing: a
 * pixel-changing lift/red-eye fix, or a recorded scan (checked) even when
 * it found no faces. Ignores the toggle. Legacy empty records without the
 * flag still count as unstored.
 */
export function isFaceAdjustStored(state: FaceAdjustState | null | undefined): state is FaceAdjustState {
  if (!state) return false;
  return (state.amount > 0 && state.boxes.length > 0) || state.redEye.length > 0 || state.checked === true;
}

/** True when a stored face adjust changes at least one pixel (enabled and effective). A recorded empty scan is stored but never active. */
export function isFaceAdjustActive(state: FaceAdjustState | null | undefined): state is FaceAdjustState {
  if (!state || state.enabled === false) return false;
  return (state.amount > 0 && state.boxes.length > 0) || state.redEye.length > 0;
}

/**
 * Recipe record for a scan that found no faces: empty boxes, no lift, no
 * red-eye, flagged as checked so the UI shows the outcome (with Rescan)
 * instead of forgetting it. Renders as a no-op.
 */
export function emptyFaceScan(source: FaceAdjustState["source"]): FaceAdjustState {
  return { boxes: [], amount: 0, redEye: [], source, enabled: true, checked: true };
}

/**
 * True when the stored adjust already records an empty scan from this
 * source — re-storing would stack a duplicate undo entry. A stored hit
 * (boxes/red-eye) or a scan from the other source is not the same record.
 */
export function isEmptyFaceScanStored(
  state: FaceAdjustState | null | undefined,
  source: FaceAdjustState["source"],
): boolean {
  return (
    !!state &&
    state.checked === true &&
    state.boxes.length === 0 &&
    state.redEye.length === 0 &&
    state.source === source
  );
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Soft per-pixel lift mask (0..1) for face boxes: each box becomes an
 * ellipse with a feathered rim (full strength to 70% of the radius, gone
 * at the rim), max-combined across faces.
 */
export function faceLiftMask(boxes: readonly FaceBox[], width: number, height: number): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${width}x${height}.`);
  }
  const mask = new Float32Array(width * height);
  for (const box of boxes) {
    const x0 = Math.min(box.x0, box.x1) * width;
    const x1 = Math.max(box.x0, box.x1) * width;
    const y0 = Math.min(box.y0, box.y1) * height;
    const y1 = Math.max(box.y0, box.y1) * height;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = Math.max(0.5, (x1 - x0) / 2);
    const ry = Math.max(0.5, (y1 - y0) / 2);
    const minX = Math.max(0, Math.floor(x0));
    const maxX = Math.min(width - 1, Math.ceil(x1));
    const minY = Math.max(0, Math.floor(y0));
    const maxY = Math.min(height - 1, Math.ceil(y1));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        const m = 1 - smoothstep(0.7, 1, d);
        const p = y * width + x;
        if (m > (mask[p] ?? 0)) mask[p] = m;
      }
    }
  }
  return mask;
}

/**
 * Apply masked face lift in place: each channel gains up to 2^(amount*0.6)
 * inside the face ellipses, feathered to no change at the rims. The buffer
 * must be caller-owned (the pipeline passes its fresh output); tests pass
 * a copy. No-op when amount <= 0 or boxes are empty.
 */
export function applyFaceLift(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  boxes: readonly FaceBox[],
  amount: number,
): void {
  if (data.length !== width * height * 4) {
    throw new RangeError(`Buffer length ${data.length} does not match dimensions ${width}x${height}.`);
  }
  if (!(amount > 0) || boxes.length === 0) return;
  const mask = faceLiftMask(boxes, width, height);
  const gain = Math.pow(2, Math.min(FACE_LIFT_MAX_AMOUNT, amount) * 0.6);
  for (let p = 0; p < width * height; p += 1) {
    const m = mask[p] ?? 0;
    if (m <= 0) continue;
    const factor = 1 + (gain - 1) * m;
    const i = p * 4;
    data[i] = (data[i] ?? 0) * factor;
    data[i + 1] = (data[i + 1] ?? 0) * factor;
    data[i + 2] = (data[i + 2] ?? 0) * factor;
  }
}

/**
 * Apply red-eye fixes in place: inside each disc, red-dominant pixels have
 * their red channel pulled toward the green/blue mean (a dark pupil gray),
 * scaled by both the disc feather and the red excess — non-red pixels pass
 * through untouched. The buffer must be caller-owned.
 */
export function applyRedEyeFix(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  spots: readonly RedEyeSpot[],
): void {
  if (data.length !== width * height * 4) {
    throw new RangeError(`Buffer length ${data.length} does not match dimensions ${width}x${height}.`);
  }
  for (const spot of spots) {
    const cx = spot.x * width;
    const radius = Math.max(1, spot.radius * width);
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(spot.y * height - radius));
    const maxY = Math.min(height - 1, Math.ceil(spot.y * height + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const d = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - spot.y * height) * (y + 0.5 - spot.y * height)) / radius;
        if (d >= 1) continue;
        const i = (y * width + x) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const other = Math.max(g, b);
        if (r <= other) continue;
        const excess = (r - other) / Math.max(1, r);
        // 0.3 keeps warm skin (excess ≈ 0.24) untouched while a red pupil
        // (excess ≈ 0.8) still fixes at full strength.
        if (excess < 0.3) continue;
        const feather = 1 - smoothstep(0.6, 1, d);
        const strength = Math.min(1, excess * 2.5) * feather;
        data[i] = r + ((g + b) / 2 - r) * strength;
      }
    }
  }
}

/** Eye search radius as a fraction of face-box width. */
const RED_EYE_SEARCH_FRACTION = 0.1;
/** Minimum red pixels to call an eye cluster a red pupil (working res). */
const RED_EYE_MIN_PIXELS = 4;

/**
 * Find red-eye pupils: around each eye landmark (or proportional estimate),
 * cluster red-dominant pixels (strong red excess over green/blue) into one
 * fix disc per eye. Returns normalized spots; eyes without a red cluster
 * yield nothing, so flash-free portraits get zero spots.
 */
export function findRedEyeSpots(image: PixelImage, faces: readonly DetectedFace[]): RedEyeSpot[] {
  assertValidImage(image);
  const spots: RedEyeSpot[] = [];
  for (const face of faces) {
    const boxWidthPx = Math.max(1, (Math.max(face.box.x0, face.box.x1) - Math.min(face.box.x0, face.box.x1)) * image.width);
    const searchRadius = Math.max(3, boxWidthPx * RED_EYE_SEARCH_FRACTION);
    for (const eye of [face.leftEye, face.rightEye]) {
      if (!eye) continue;
      const cx = eye.x * image.width;
      const cy = eye.y * image.height;
      const minX = Math.max(0, Math.floor(cx - searchRadius));
      const maxX = Math.min(image.width - 1, Math.ceil(cx + searchRadius));
      const minY = Math.max(0, Math.floor(cy - searchRadius));
      const maxY = Math.min(image.height - 1, Math.ceil(cy + searchRadius));
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dist = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
          if (dist > searchRadius) continue;
          const i = (y * image.width + x) * 4;
          const r = image.data[i] ?? 0;
          const g = image.data[i + 1] ?? 0;
          const b = image.data[i + 2] ?? 0;
          // A flash pupil is far redder than skin (which reaches r-g ≈ 50
          // at a ≈ 1.3 red ratio); both gates must clear with margin.
          if (r < 70 || r - g < 60 || r - b < 60 || r < 2 * Math.max(g, b)) continue;
          sumX += x + 0.5;
          sumY += y + 0.5;
          count += 1;
        }
      }
      if (count < RED_EYE_MIN_PIXELS) continue;
      const radiusPx = Math.min(searchRadius, Math.max(2, Math.sqrt(count / Math.PI) * 1.4));
      spots.push({ x: sumX / count / image.width, y: sumY / count / image.height, radius: radiusPx / image.width });
    }
  }
  return spots;
}

/**
 * Build the recipe state for an enhance application: the lift boxes plus
 * the shared lift amount (the darkest face's need) and any red-eye discs.
 * Returns null when neither correction changes a pixel, so a no-op apply
 * stores no badge. Callers record a scan that found no faces with
 * emptyFaceScan instead.
 */
export function faceAdjustForFaces(
  image: PixelImage,
  faces: readonly DetectedFace[],
  source: FaceAdjustState["source"],
): FaceAdjustState | null {
  if (faces.length === 0) return null;
  let amount = 0;
  for (const face of faces) {
    amount = Math.max(amount, faceLiftAmount(faceMeanLuminance(image, face.box)));
  }
  const redEye = findRedEyeSpots(image, faces);
  if (!(amount > 0) && redEye.length === 0) return null;
  return { boxes: faces.map((face) => ({ ...face.box })), amount, redEye, source, enabled: true };
}

/** True when a full edit recipe carries an active face adjust. */
export function editHasFaceAdjust(edit: EditState): boolean {
  return isFaceAdjustActive(edit.faceAdjust);
}
