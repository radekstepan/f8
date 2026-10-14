// Interactive RGB tone curve: user-placed anchors over the Midtones bend.
//
// The Curves section pairs two looks: the Midtones slider (a fixed midtone
// bell in the pixel pipeline) and up to MAX_CURVE_POINTS draggable anchors.
// The anchors define a smooth spline through normalized (input, output)
// levels over implicit (0,0) and (1,1) endpoints; the pipeline remaps every
// channel through its 256-entry table after the tonal offsets, and the
// inspector graph draws the same mapping so the editor is WYSIWYG. Pure
// functions only — no DOM — so the pipeline, the editor, and tests share it.

import type { CurvePoint } from "./types.js";

/** Hard cap on user anchors: bounds recipe size and keeps the graph legible. */
export const MAX_CURVE_POINTS = 16;

/** Graph geometry in svg units, shared by the editor and its display path. */
export const TONE_CURVE_WIDTH = 240;
export const TONE_CURVE_HEIGHT = 160;

/**
 * Midtone-slider response: levels of lift per slider unit at middle gray.
 * Shared with the pixel pipeline so the graph bend matches the render.
 */
export const MIDTONE_CURVE_RESPONSE = 0.6;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const isFinitePoint = (point: CurvePoint): boolean =>
  Number.isFinite(point?.x) && Number.isFinite(point?.y);

/**
 * Sort by input, clamp to 0..1, drop non-finite anchors, merge shared
 * inputs (the latest drop wins — a curve is single-valued), and cap the
 * count. Always returns a fresh array; never mutates the input.
 */
export function normalizeCurvePoints(points: readonly CurvePoint[] | null | undefined): CurvePoint[] {
  if (!Array.isArray(points)) return [];
  const cleaned = points
    .filter(isFinitePoint)
    .map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }));
  // Array sort is stable: equal inputs keep insertion order for the merge.
  cleaned.sort((a, b) => a.x - b.x);
  const merged: CurvePoint[] = [];
  for (const point of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.x === point.x) merged[merged.length - 1] = point;
    else merged.push(point);
  }
  return merged.slice(0, MAX_CURVE_POINTS);
}

/** True when the list holds at least one usable anchor. Nullish-safe. */
export function isCurvePointsActive(points: readonly CurvePoint[] | null | undefined): boolean {
  return normalizeCurvePoints(points).length > 0;
}

/**
 * Append an anchor, keeping the list normalized. Returns the input
 * unchanged (same reference) at the cap or for non-finite drops, so the
 * caller can tell a rejected drop from an accepted one.
 */
export function addCurvePoint(
  points: readonly CurvePoint[],
  x: number,
  y: number,
): CurvePoint[] {
  const current = normalizeCurvePoints(points);
  if (current.length >= MAX_CURVE_POINTS || !Number.isFinite(x) || !Number.isFinite(y)) return points as CurvePoint[];
  return normalizeCurvePoints([...current, { x, y }]);
}

/**
 * Move one anchor by normalized index. Inputs clamp between the neighbors
 * (a drag stops rather than reordering), outputs clamp to 0..1.
 * Out-of-range moves return the normalized input unchanged.
 */
export function moveCurvePoint(
  points: readonly CurvePoint[],
  index: number,
  x: number,
  y: number,
): CurvePoint[] {
  const current = normalizeCurvePoints(points);
  const anchor = current[index];
  if (!anchor || !Number.isFinite(x) || !Number.isFinite(y)) return current;
  const gap = 1 / TONE_CURVE_WIDTH;
  const lo = index === 0 ? 0 : (current[index - 1]?.x ?? 0) + gap;
  const hi = index === current.length - 1 ? 1 : (current[index + 1]?.x ?? 1) - gap;
  if (lo > hi) return current;
  return current.map((point, i) =>
    i === index ? { x: Math.min(hi, Math.max(lo, x)), y: clamp01(y) } : point,
  );
}

/** Drop one anchor by normalized index; out-of-range removes nothing. */
export function removeCurvePoint(points: readonly CurvePoint[], index: number): CurvePoint[] {
  const current = normalizeCurvePoints(points);
  if (index < 0 || index >= current.length) return current;
  return current.filter((_, i) => i !== index);
}

/**
 * Fritsch–Carlson monotone cubic through the anchors over pinned (0,0)
 * and (1,1) endpoints. The slope limiter keeps every segment inside its
 * endpoint range, so the curve never overshoots past a placed anchor.
 * Callers pass normalized points (exact-x duplicates would divide by zero).
 */
function toneSpline(anchors: readonly CurvePoint[]): (x: number) => number {
  const xs = [0, ...anchors.map((point) => point.x), 1];
  const ys = [0, ...anchors.map((point) => point.y), 1];
  const n = xs.length;
  const widths: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const width = (xs[i + 1] ?? 0) - (xs[i] ?? 0);
    widths.push(width);
    slopes.push(((ys[i + 1] ?? 0) - (ys[i] ?? 0)) / width);
  }
  const tangents = new Array<number>(n).fill(0);
  tangents[0] = slopes[0] ?? 0;
  tangents[n - 1] = slopes[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i += 1) {
    const prev = slopes[i - 1] ?? 0;
    const next = slopes[i] ?? 0;
    if (prev === 0 || next === 0 || Math.sign(prev) !== Math.sign(next)) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * (widths[i] ?? 0) + (widths[i - 1] ?? 0);
      const w2 = (widths[i] ?? 0) + 2 * (widths[i - 1] ?? 0);
      tangents[i] = (w1 + w2) / (w1 / prev + w2 / next);
    }
  }
  for (let i = 0; i < n - 1; i += 1) {
    const slope = slopes[i] ?? 0;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = (tangents[i] ?? 0) / slope;
    const beta = (tangents[i + 1] ?? 0) / slope;
    const squared = alpha * alpha + beta * beta;
    if (squared > 9) {
      const tau = 3 / Math.sqrt(squared);
      tangents[i] = tau * alpha * slope;
      tangents[i + 1] = tau * beta * slope;
    }
  }
  return (x: number): number => {
    const clamped = clamp01(x);
    let i = 0;
    while (i < n - 2 && clamped > (xs[i + 1] ?? 0)) i += 1;
    const h = widths[i] ?? 1;
    const s = (clamped - (xs[i] ?? 0)) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const y0 = ys[i] ?? 0;
    const y1 = ys[i + 1] ?? 0;
    const t0 = tangents[i] ?? 0;
    const t1 = tangents[i + 1] ?? 0;
    return clamp01(
      (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * t0 +
        (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * t1,
    );
  };
}

/** Map one normalized input level through the anchors (identity when empty). */
export function evaluateToneCurve(
  points: readonly CurvePoint[] | null | undefined,
  x: number,
): number {
  const anchors = normalizeCurvePoints(points);
  if (anchors.length === 0) return clamp01(x);
  return toneSpline(anchors)(x);
}

/**
 * The 256-entry channel remap table, or null when the curve is identity
 * (the pipeline skips the lookup entirely). Entries are 0..255 levels.
 */
export function buildToneCurveTable(
  points: readonly CurvePoint[] | null | undefined,
): Float32Array | null {
  const anchors = normalizeCurvePoints(points);
  if (anchors.length === 0) return null;
  const spline = toneSpline(anchors);
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = spline(i / 255) * 255;
  return table;
}

/**
 * The Midtones slider's bend in normalized levels: the same bell and
 * response the pixel pipeline applies, so the graph matches the render.
 * (The bell mirrors midtoneWeight in adjustments.ts — toneCurve.test.ts
 * pins the two against each other to stop silent drift.)
 */
export function midtoneDisplayBend(x01: number, midtone: number): number {
  const bell = Math.sin(Math.PI * clamp01(x01));
  return clamp01(x01 + (midtone * bell * MIDTONE_CURVE_RESPONSE) / 255);
}

/**
 * The svg path `d` for the graph: the anchor spline composed over the
 * Midtones bend, sampled across the graph width. Black and white stay
 * pinned in every case — the bell is zero at both extremes and the
 * spline pins its endpoints.
 */
export function toneCurveDisplayPath(
  points: readonly CurvePoint[] | null | undefined,
  midtone: number,
  samples = 60,
): string {
  const anchors = normalizeCurvePoints(points);
  const spline = anchors.length === 0 ? (x: number): number => clamp01(x) : toneSpline(anchors);
  const count = Math.max(2, Math.floor(samples));
  const format = (value: number): string => String(Math.round(value * 10) / 10);
  let d = "";
  for (let i = 0; i < count; i += 1) {
    const x = i / (count - 1);
    const y = spline(midtoneDisplayBend(x, midtone));
    d += `${i === 0 ? "M" : "L"}${format(x * TONE_CURVE_WIDTH)} ${format((1 - y) * TONE_CURVE_HEIGHT)}`;
  }
  return d;
}
