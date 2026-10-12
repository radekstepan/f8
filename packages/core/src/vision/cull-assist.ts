// Import-time cull assist: blur detection and near-duplicate grouping.
//
// Pure, dependency-free helpers shared by the photo server (which runs them
// over cached grid thumbs at import and from the album menu) and the tests.
// Inputs are never mutated. Only problems are reported — sharp photos carry
// no flag (there is no positive state).
//
// - Blur is classical first, per the task: variance of the 4-neighborhood
//   Laplacian over luma. Flat/defocused frames score near zero; textured
//   sharp frames score in the hundreds on grid thumbs.
// - Near-duplicates group by 64-bit DCT perceptual hash (32x32 luma,
//   top-left 8x8 low frequencies, median threshold), union-find merged at a
//   hamming radius. Each group's best (by a tiny logistic quality rank over
//   sharpness, exposure, contrast — coefficients set by inspection, like the
//   scene classifier) is spared the duplicate flag.
//
// Assessments cache in SQLite keyed by content hash, so a file is never
// re-detected; labels ride the shared photo_labels table with source "ml".

import type { PhotoLabel } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";

/** ML cull flags, stored as photo labels with source "ml". */
export const CULL_LABEL_BLURRY = "blurry";
export const CULL_LABEL_DUPLICATE = "duplicate";
export const CULL_LABELS = [CULL_LABEL_BLURRY, CULL_LABEL_DUPLICATE] as const;
export type CullLabel = (typeof CULL_LABELS)[number];

/**
 * Algorithm stamp on every cached assessment. A bump re-assesses instead of
 * mixing scores across algorithm versions; within a version a file is never
 * re-detected.
 */
export const CULL_ASSIST_VERSION = "v1-classical";

/**
 * Laplacian variance below this marks a photo blurry. Calibrated on 640px
 * cached grid thumbs (see docs/tasks/15-cull-assist-ml.md): the two haziest
 * dev-library frames score 85–86, the next-softest sharp frame 172, and
 * artificially blurred sharp frames 10–35 — so 90 flags true softness with
 * a 2x margin above the sharp floor.
 */
export const CULL_BLUR_THRESHOLD = 90;

/**
 * pHash hamming distance at or under this groups photos as near-duplicates.
 * Calibrated on dev-library thumbs (see docs/tasks/15-cull-assist-ml.md):
 * exposure/focus/shift variants of the same frame land at 0–8 bits while
 * the closest unrelated pair (of 703) sits at 18, so 8 catches realistic
 * burst differences with a 2x margin against false merges.
 */
export const CULL_DUPLICATE_HAMMING = 8;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Rec.709 luma plane (row-major, 0..255) for one image. */
export function grayLuma(image: PixelImage): Float32Array {
  assertValidImage(image);
  const gray = new Float32Array(image.width * image.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] =
      0.2126 * (image.data[p] ?? 0) + 0.7152 * (image.data[p + 1] ?? 0) + 0.0722 * (image.data[p + 2] ?? 0);
  }
  return gray;
}

/**
 * Variance of the 4-neighborhood Laplacian (4c - top - bottom - left - right)
 * over the interior pixels. Images under 3px in either dimension have no
 * interior and score 0.
 */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${width}x${height}.`);
  }
  if (gray.length !== width * height) {
    throw new RangeError(`Luma length ${gray.length} does not match dimensions ${width}x${height}.`);
  }
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        4 * (gray[i] ?? 0) - (gray[i - 1] ?? 0) - (gray[i + 1] ?? 0) - (gray[i - width] ?? 0) - (gray[i + width] ?? 0);
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  // Round-off guard: variance is non-negative by construction.
  return Math.max(0, sumSq / count - mean * mean);
}

/** Laplacian blur score of one image (higher is sharper). */
export function blurScore(image: PixelImage): number {
  assertValidImage(image);
  return laplacianVariance(grayLuma(image), image.width, image.height);
}

/** True when a blur score lands under the blurry threshold. */
export function isBlurryScore(score: number): boolean {
  return Number.isFinite(score) && score < CULL_BLUR_THRESHOLD;
}

/**
 * Blurry-label confidence 0..1: a flat frame (score 0) is certainly blurry,
 * a frame just under the threshold is a borderline call.
 */
export function blurConfidence(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return clamp01(1 - Math.max(0, score) / CULL_BLUR_THRESHOLD);
}

export interface LumaStats {
  /** Mean luma 0..255. */
  mean: number;
  /** Standard deviation of luma (contrast proxy). */
  std: number;
}

/** Mean + standard deviation of a luma plane. */
export function lumaStats(gray: ArrayLike<number>): LumaStats {
  if (!gray.length) return { mean: 0, std: 0 };
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i] ?? 0;
  const mean = sum / gray.length;
  let sq = 0;
  for (let i = 0; i < gray.length; i++) {
    const delta = (gray[i] ?? 0) - mean;
    sq += delta * delta;
  }
  return { mean, std: Math.sqrt(Math.max(0, sq / gray.length)) };
}

export interface AestheticFeatures {
  /** Blur score normalized against the blurry threshold (1 at 3x threshold). */
  sharp: number;
  /** 1 at mid-gray mean, fading toward black/white clipping. */
  exposure: number;
  /** Luma std normalized (1 at a contrasty 55). */
  contrast: number;
}

/** Handcrafted 0..1 features for the tiny group-best ranker. */
export function aestheticFeatures(blur: number, stats: LumaStats): AestheticFeatures {
  return {
    sharp: clamp01(blur / (3 * CULL_BLUR_THRESHOLD)),
    exposure: 1 - Math.min(1, Math.abs(stats.mean - 128) / 110),
    contrast: clamp01(stats.std / 55),
  };
}

/**
 * Tiny logistic quality rank: sigmoid(w·features + bias). Coefficients set
 * by inspection (sharpness dominates; exposure and contrast nudge), like the
 * scene classifier — no fitted weights, no download, no separate license.
 * Only used to pick each duplicate group's best; it never becomes a label.
 */
export const CULL_AESTHETIC_WEIGHTS = { sharp: 2.4, exposure: 1.1, contrast: 0.9, bias: -2.1 } as const;
export type CullAestheticWeights = { sharp: number; exposure: number; contrast: number; bias: number };

/** Quality rank 0..1 for one feature vector. */
export function aestheticScore(
  features: AestheticFeatures,
  weights: CullAestheticWeights = CULL_AESTHETIC_WEIGHTS,
): number {
  const z =
    weights.sharp * features.sharp +
    weights.exposure * features.exposure +
    weights.contrast * features.contrast +
    weights.bias;
  return 1 / (1 + Math.exp(-z));
}

/** Downsample grid for the perceptual hash. */
export const CULL_PHASH_SIZE = 32;
/** Low-frequency DCT block (8x8 = 64 bits). */
export const CULL_PHASH_DCT = 8;

// Cosine table for the 8x8 low block of a 32-point DCT-II: cosTable[u][x].
// Built once — every hash reuses it.
const PHASH_COS: number[][] = (() => {
  const table: number[][] = [];
  for (let u = 0; u < CULL_PHASH_DCT; u++) {
    const row: number[] = [];
    for (let x = 0; x < CULL_PHASH_SIZE; x++) {
      row.push(Math.cos(((2 * x + 1) * u * Math.PI) / (2 * CULL_PHASH_SIZE)));
    }
    table.push(row);
  }
  return table;
})();

function grayBilinearAt(gray: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const cx = Math.max(0, Math.min(width - 1.001, x));
  const cy = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const v00 = gray[y0 * width + x0] ?? 0;
  const v10 = gray[y0 * width + x1] ?? 0;
  const v01 = gray[y1 * width + x0] ?? 0;
  const v11 = gray[y1 * width + x1] ?? 0;
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/**
 * 64-bit DCT perceptual hash of a luma plane: bilinear 32x32 downsample,
 * top-left 8x8 DCT-II low block (the orthonormal scale cancels in the median
 * compare, so it is skipped), one bit per coefficient above the AC median
 * (the DC term never votes in the median, so flat brightness never skews it).
 * Bit i (row-major over the 8x8 block) is 1 << i.
 */
export function perceptualHashFromGray(gray: ArrayLike<number>, width: number, height: number): bigint {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${width}x${height}.`);
  }
  if (gray.length !== width * height) {
    throw new RangeError(`Luma length ${gray.length} does not match dimensions ${width}x${height}.`);
  }
  const size = CULL_PHASH_SIZE;
  const small = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      small[y * size + x] = grayBilinearAt(gray, width, height, ((x + 0.5) * width) / size - 0.5, ((y + 0.5) * height) / size - 0.5);
    }
  }
  const block = CULL_PHASH_DCT;
  const coeffs = new Float64Array(block * block);
  for (let v = 0; v < block; v++) {
    const cosV = PHASH_COS[v] ?? [];
    for (let u = 0; u < block; u++) {
      const cosU = PHASH_COS[u] ?? [];
      let sum = 0;
      for (let y = 0; y < size; y++) {
        const cy = cosV[y] ?? 0;
        for (let x = 0; x < size; x++) sum += (small[y * size + x] ?? 0) * (cosU[x] ?? 0) * cy;
      }
      coeffs[v * block + u] = sum;
    }
  }
  const ac = Array.from(coeffs.slice(1)).sort((a, b) => a - b);
  const median = ac[Math.floor(ac.length / 2)] ?? 0;
  let hash = 0n;
  for (let i = 0; i < coeffs.length; i++) {
    if ((coeffs[i] ?? 0) > median) hash |= 1n << BigInt(i);
  }
  return hash;
}

/** 64-bit DCT perceptual hash of one image. */
export function perceptualHash(image: PixelImage): bigint {
  assertValidImage(image);
  return perceptualHashFromGray(grayLuma(image), image.width, image.height);
}

/** Canonical 16-char lowercase hex of a 64-bit hash. */
export function phashToHex(hash: bigint): string {
  if (hash < 0n || hash >= 1n << 64n) throw new RangeError(`Perceptual hash ${hash} is outside the 64-bit range.`);
  return hash.toString(16).padStart(16, "0");
}

/** Parse canonical pHash hex (16 hex chars); RangeError on anything else. */
export function parsePhashHex(hex: string): bigint {
  if (!/^[0-9a-fA-F]{16}$/.test(hex)) {
    throw new RangeError(`Invalid perceptual hash "${hex.slice(0, 32)}" (expected 16 hex chars).`);
  }
  return BigInt(`0x${hex}`);
}

function requireHash64(hash: bigint): void {
  if (hash < 0n || hash >= 1n << 64n) throw new RangeError(`Perceptual hash ${hash} is outside the 64-bit range.`);
}

/** Hamming distance (differing bits, 0..64) of two 64-bit hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  requireHash64(a);
  requireHash64(b);
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

function asHash(value: bigint | string): bigint {
  return typeof value === "string" ? parsePhashHex(value) : (requireHash64(value), value);
}

/**
 * Near-duplicate groups (union-find at the hamming radius, so grouping is
 * transitive: A~B and B~C group A with C). Only groups of 2+ return;
 * members sort by id, groups by first member — fully deterministic.
 */
export function groupNearDuplicates(
  entries: readonly { id: string; phash: bigint | string }[],
  maxDistance: number = CULL_DUPLICATE_HAMMING,
): string[][] {
  if (!Number.isInteger(maxDistance) || maxDistance < 0) {
    throw new RangeError(`Expected a non-negative integer hamming radius, got ${maxDistance}.`);
  }
  const hashes = entries.map((entry) => ({ id: entry.id, hash: asHash(entry.phash) }));
  const parent = hashes.map((_, index) => index);
  const find = (index: number): number => {
    let root = parent[index] ?? index;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    let cursor = index;
    while ((parent[cursor] ?? cursor) !== root) {
      const next = parent[cursor] ?? cursor;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      if (hammingDistance(hashes[i]?.hash ?? 0n, hashes[j]?.hash ?? 0n) <= maxDistance) {
        parent[find(i)] = find(j);
      }
    }
  }
  const members = new Map<number, string[]>();
  for (let i = 0; i < hashes.length; i++) {
    const root = find(i);
    const id = hashes[i]?.id ?? "";
    const group = members.get(root);
    if (group) group.push(id);
    else members.set(root, [id]);
  }
  return [...members.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort())
    .sort((a, b) => ((a[0] ?? "") < (b[0] ?? "") ? -1 : 1));
}

export interface CullGroupMember {
  id: string;
  aesthetic: number;
  blur: number;
}

/**
 * Group best: highest aesthetic wins, ties break toward sharper, then
 * toward the lowest id — deterministic whatever the input order.
 */
export function pickGroupBest(members: readonly CullGroupMember[]): string {
  if (!members.length) throw new RangeError("Cannot pick the best of an empty group.");
  const ranked = [...members].sort(
    (a, b) => b.aesthetic - a.aesthetic || b.blur - a.blur || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return ranked[0]?.id ?? "";
}

export interface CullPhotoMetrics {
  blur: number;
  phash: bigint | string;
  aesthetic: number;
}

/**
 * Cull flags for one album pass over cached metrics (no pixels here — the
 * server assesses pixels once per content hash and plans labels from the
 * cache, so grouping always sees the whole album while detection never
 * re-runs). Only flagged photos appear in the map:
 *
 * - blurry: the blur score lands under the threshold (confidence fades as
 *   the score nears it).
 * - duplicate: a group member that is not the group best (score is the
 *   similarity to the best, near 1 by construction).
 *
 * Sharp, unique photos get no label — there is no positive state.
 */
export function assignCullLabels(
  items: readonly { id: string; metrics: CullPhotoMetrics }[],
  maxDistance: number = CULL_DUPLICATE_HAMMING,
): Map<string, PhotoLabel[]> {
  const byId = new Map(items.map((item) => [item.id, item.metrics]));
  const hashes = new Map(items.map((item) => [item.id, asHash(item.metrics.phash)]));
  const groups = groupNearDuplicates(
    items.map((item) => ({ id: item.id, phash: hashes.get(item.id) ?? 0n })),
    maxDistance,
  );
  const bestOf = new Map<string, string>();
  for (const group of groups) {
    const best = pickGroupBest(
      group.map((id) => {
        const metrics = byId.get(id);
        return { id, aesthetic: metrics?.aesthetic ?? 0, blur: metrics?.blur ?? 0 };
      }),
    );
    for (const member of group) bestOf.set(member, best);
  }
  const labels = new Map<string, PhotoLabel[]>();
  for (const { id, metrics } of items) {
    const flagged: PhotoLabel[] = [];
    const blurry = isBlurryScore(metrics.blur);
    if (blurry) flagged.push({ label: CULL_LABEL_BLURRY, score: blurConfidence(metrics.blur), source: "ml" });
    const best = bestOf.get(id);
    const duplicate = best !== undefined && best !== id;
    if (duplicate) {
      const distance = hammingDistance(hashes.get(id) ?? 0n, hashes.get(best) ?? 0n);
      flagged.push({ label: CULL_LABEL_DUPLICATE, score: 1 - distance / 64, source: "ml" });
    }
    if (flagged.length) labels.set(id, flagged);
  }
  return labels;
}

export interface CullAssessment {
  /** Laplacian variance (higher is sharper). */
  blur: number;
  blurry: boolean;
  /** Canonical 16-char pHash hex. */
  phash: string;
  /** Quality rank 0..1 (group-best picking only, never labeled). */
  aesthetic: number;
}

/** Full one-photo assessment: blur + perceptual hash + quality rank. */
export function assessPixels(image: PixelImage): CullAssessment {
  assertValidImage(image);
  const gray = grayLuma(image);
  const blur = laplacianVariance(gray, image.width, image.height);
  const aesthetic = aestheticScore(aestheticFeatures(blur, lumaStats(gray)));
  return {
    blur,
    blurry: isBlurryScore(blur),
    phash: phashToHex(perceptualHashFromGray(gray, image.width, image.height)),
    aesthetic,
  };
}
