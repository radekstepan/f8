// Retouch stroke grouping: every stamp painted in one drag shares a stroke
// id, so the inspector can list paint strokes as groups instead of a flat
// stamp count. Legacy points without a stroke id collapse into one group;
// new strokes always use positive ids.

import type { RetouchPoint } from "./types.js";

/** Group id for repair stamps painted before stroke ids existed. */
export const LEGACY_REPAIR_STROKE = 0;

export interface RetouchStrokeGroup {
  id: number;
  kind: "repair";
  points: RetouchPoint[];
}

/** Stable group id for one stamp: its stroke, or the legacy bucket. */
export function strokeIdForPoint(point: RetouchPoint): number {
  if (Number.isInteger(point.stroke) && (point.stroke as number) > 0) return point.stroke as number;
  return LEGACY_REPAIR_STROKE;
}

/** Group stamps into paint strokes, preserving first-seen order. */
export function groupRetouchStrokes(points: readonly RetouchPoint[]): RetouchStrokeGroup[] {
  const groups = new Map<number, RetouchStrokeGroup>();
  for (const point of points) {
    const id = strokeIdForPoint(point);
    const existing = groups.get(id);
    if (existing) {
      existing.points.push(point);
    } else {
      groups.set(id, { id, kind: point.kind, points: [point] });
    }
  }
  return [...groups.values()];
}

/** Next positive stroke id after the ids already present; never a legacy id. */
export function nextRetouchStrokeId(points: readonly RetouchPoint[]): number {
  let max = 0;
  for (const point of points) {
    if (Number.isInteger(point.stroke) && (point.stroke as number) > max) max = point.stroke as number;
  }
  return max + 1;
}

// Rotation turns repair stamps with the image: stamps live in normalized
// final-canvas coordinates (after rotation and the centered crop), so a
// quarter turn must remap them or they heal the wrong pixels. The mapping
// mirrors geometryCanvas: stamps move from the old crop window into the
// rotated canvas, turn with it, then move into the new crop window. Flips
// and straighten cancel out of a pure rotation delta, so only the two
// rotation values, the crop ratio, and the source aspect matter. Stamps
// that leave the visible window are kept (rotating back restores them);
// the mask rasterizer safely skips off-canvas stamps.

export interface RotateRetouchesOptions {
  fromRotation: number;
  toRotation: number;
  /** Resolved crop ratio (width/height); null/unknown means Original. */
  cropRatio: number | null;
  /** Upright source aspect (width/height); without it the brush keeps its size. */
  sourceAspect?: number;
}

/** True when the rotation swaps canvas width and height; mirrors geometryCanvas. */
function swapsForRotation(rotation: number): boolean {
  return Math.abs(rotation % 180) === 90;
}

/** Fraction of the rotated canvas the centered crop keeps (1,1 without a crop). */
function cropFractions(cropRatio: number | null, rotatedAspect: number): { cw: number; ch: number } {
  if (typeof cropRatio !== "number" || !(cropRatio > 0)) return { cw: 1, ch: 1 };
  if (!Number.isFinite(rotatedAspect) || rotatedAspect <= 0) return { cw: 1, ch: 1 };
  if (rotatedAspect > cropRatio) return { cw: cropRatio / rotatedAspect, ch: 1 };
  return { cw: 1, ch: rotatedAspect / cropRatio };
}

/**
 * Remap stamps so each stays on its image feature across a rotation change.
 * Only quarter-turn deltas move stamps; anything else returns equal copies.
 * The brush grows/shrinks with the canvas width so its pixel radius survives
 * the turn (square windows need no rescale). Never mutates the input.
 */
export function rotateRetouches(
  points: readonly RetouchPoint[],
  options: RotateRetouchesOptions,
): RetouchPoint[] {
  const copy = () => points.map((point) => ({ ...point }));
  const delta = options.toRotation - options.fromRotation;
  const steps = Math.round(delta / 90);
  if (!Number.isFinite(steps) || Math.abs(delta - steps * 90) > 1e-6) return copy();
  const clockwise = ((steps % 4) + 4) % 4;
  if (clockwise === 0) return copy();

  const aspect = options.sourceAspect;
  const hasAspect = typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0;
  const ratio = options.cropRatio;
  const fromSwapped = swapsForRotation(options.fromRotation);
  const toSwapped = swapsForRotation(options.toRotation);
  const oldAspect = hasAspect ? (fromSwapped ? 1 / (aspect as number) : (aspect as number)) : Number.NaN;
  const newAspect = hasAspect ? (toSwapped ? 1 / (aspect as number) : (aspect as number)) : Number.NaN;
  const oldCrop = cropFractions(ratio, oldAspect);
  const newCrop = cropFractions(ratio, newAspect);

  // Symbolic canvas widths (unit-height source): their ratio rescales the
  // brush. Without an aspect there is no width change to measure.
  let sizeRatio = 1;
  if (hasAspect) {
    const sourceWidth = aspect as number;
    const oldWidth = (fromSwapped ? 1 : sourceWidth) * oldCrop.cw;
    const newWidth = (toSwapped ? 1 : sourceWidth) * newCrop.cw;
    if (Number.isFinite(oldWidth) && Number.isFinite(newWidth) && newWidth > 0) {
      sizeRatio = oldWidth / newWidth;
    }
  }

  return points.map((point) => {
    const rotX = (1 - oldCrop.cw) / 2 + point.x * oldCrop.cw;
    const rotY = (1 - oldCrop.ch) / 2 + point.y * oldCrop.ch;
    let turnedX = rotX;
    let turnedY = rotY;
    if (clockwise === 1) {
      turnedX = 1 - rotY;
      turnedY = rotX;
    } else if (clockwise === 2) {
      turnedX = 1 - rotX;
      turnedY = 1 - rotY;
    } else {
      turnedX = rotY;
      turnedY = 1 - rotX;
    }
    return {
      ...point,
      x: (turnedX - (1 - newCrop.cw) / 2) / newCrop.cw,
      y: (turnedY - (1 - newCrop.ch) / 2) / newCrop.ch,
      size: point.size * sizeRatio,
    };
  });
}

// Straighten turns the content by a free angle, so repair stamps must turn
// with it or they heal the wrong pixels. Unlike quarter turns the content
// zoom changes too (geometryCanvas scales by straightenScale), and flips
// cancel out (same mirror both sides, and the scalar zoom commutes through
// it). Rotation, crop, and canvas size are identical on both sides — only
// the straighten delta moves stamps, about the canvas center.

export interface RemapStraightenOptions {
  fromStraighten: number;
  toStraighten: number;
  /** User rotation (quarter turns); canvas dims derive from it. */
  rotation: number;
  /** Resolved crop ratio (width/height); null/unknown means Original. */
  cropRatio: number | null;
  /** Upright source aspect (width/height); without it stamps stay put. */
  sourceAspect?: number;
}

/** Content zoom geometryCanvas applies for a straighten angle; mirrored exactly. Exported for patch resampling, which must match stamp remapping. */
export function straightenZoom(straighten: number, sourceAspect: number): number {
  return (
    1 +
    Math.abs(Math.sin((straighten * Math.PI) / 180)) *
      Math.max(sourceAspect, 1 / sourceAspect)
  );
}

/**
 * Remap stamps so each stays on its image feature across a straighten
 * change. A zero delta, a non-finite angle, or a missing aspect returns
 * equal copies (never a partial move). The brush rescales with the content
 * zoom so it keeps covering its feature. Never mutates the input.
 */
export function remapRetouchesForStraighten(
  points: readonly RetouchPoint[],
  options: RemapStraightenOptions,
): RetouchPoint[] {
  const copy = () => points.map((point) => ({ ...point }));
  const { fromStraighten, toStraighten, rotation, cropRatio } = options;
  if (!Number.isFinite(fromStraighten) || !Number.isFinite(toStraighten)) return copy();
  const deltaDeg = toStraighten - fromStraighten;
  if (deltaDeg === 0) return copy();
  const aspect = options.sourceAspect;
  if (typeof aspect !== "number" || !Number.isFinite(aspect) || aspect <= 0) return copy();
  const rotatedAspect = swapsForRotation(rotation) ? 1 / aspect : aspect;
  const crop = cropFractions(cropRatio, rotatedAspect);
  const canvasAspect = (rotatedAspect * crop.cw) / crop.ch;
  if (!Number.isFinite(canvasAspect) || canvasAspect <= 0) return copy();
  const k1 = straightenZoom(fromStraighten, aspect);
  const k2 = straightenZoom(toStraighten, aspect);
  if (!(k1 > 0) || !(k2 > 0) || !Number.isFinite(k1) || !Number.isFinite(k2)) return copy();
  // Symbolic canvas (unit height): rotation needs aspect-true pixel space,
  // normalized coordinates would skew it on non-square canvases.
  const W = canvasAspect;
  const theta = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const sizeRatio = k2 / k1;
  return points.map((point) => {
    const X = ((1 - crop.cw) / 2 + point.x * crop.cw) * W;
    const Y = (1 - crop.ch) / 2 + point.y * crop.ch;
    // Unzoom (old content scale), turn with the content by the delta angle
    // in canvas convention (y-down, positive clockwise, matching ctx.rotate),
    // then rezoom (new content scale).
    const dx = (X - W / 2) / k1;
    const dy = (Y - 1 / 2) / k1;
    const turnedX = W / 2 + (dx * cos - dy * sin) * k2;
    const turnedY = 1 / 2 + (dx * sin + dy * cos) * k2;
    return {
      ...point,
      x: (turnedX / W - (1 - crop.cw) / 2) / crop.cw,
      y: (turnedY - (1 - crop.ch) / 2) / crop.ch,
      size: point.size * sizeRatio,
    };
  });
}
