/** Zoom-in-view magnifier (loupe) helpers.
 *
 * The View menu carries a "Zoom in View" toggle that is only meaningful on
 * an open photo: while enabled, a circular loupe follows the cursor over
 * the photo and shows the region under it magnified. The magnification is
 * relative to the displayed photo (the fitted/zoomed frame), not to source
 * pixels — like the zoom percentages in the canvas status bar.
 *
 * The loupe itself lives in PhotoCanvas (it paints from the edited canvas
 * so crop, rotation, and adjustments match the frame); this module holds
 * the pure geometry so the factor and the cursor math stay unit-testable.
 */

import type { ViewMode } from "./types.js";

/** Loupe magnification relative to the displayed photo. */
export const ZOOM_LENS_MAGNIFICATION = 16;

/** Loupe diameter in CSS pixels. */
export const ZOOM_LENS_SIZE_PX = 180;

/** Frame-fraction point (0..1 in each axis). */
export interface LensFraction {
  fx: number;
  fy: number;
}

/** Pixel size. */
export interface LensSize {
  width: number;
  height: number;
}

/** Pixel point. */
export interface LensPoint {
  x: number;
  y: number;
}

/** Backing-store source rectangle for one loupe paint. */
export interface ZoomLensSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** True only when the loupe may show: toggled on and in photo (editor) view. */
export function shouldShowZoomLens(view: ViewMode, enabled: boolean): boolean {
  return enabled && view === "editor";
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Source rectangle (in canvas backing-store pixels) for the loupe paint:
 * the on-screen region is the loupe diameter divided by the magnification,
 * centered on the cursor fraction and clamped inside the canvas. Degenerate
 * inputs (zero-size frame or canvas) yield an empty rect at the origin
 * instead of NaN, and a source larger than the canvas clamps to the canvas.
 */
export function zoomLensSourceRect(
  cursor: LensFraction,
  canvas: LensSize,
  frame: LensSize,
  lensSize: number = ZOOM_LENS_SIZE_PX,
  magnification: number = ZOOM_LENS_MAGNIFICATION,
): ZoomLensSourceRect {
  if (
    !Number.isFinite(lensSize) || lensSize <= 0 ||
    !Number.isFinite(magnification) || magnification <= 0 ||
    !Number.isFinite(frame.width) || frame.width <= 0 ||
    !Number.isFinite(frame.height) || frame.height <= 0 ||
    !Number.isFinite(canvas.width) || canvas.width <= 0 ||
    !Number.isFinite(canvas.height) || canvas.height <= 0
  ) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  // On-screen source extent (CSS px of the displayed frame), scaled into
  // backing-store pixels through the frame-to-canvas ratio per axis.
  const sw = Math.min(canvas.width, ((lensSize / magnification) / frame.width) * canvas.width);
  const sh = Math.min(canvas.height, ((lensSize / magnification) / frame.height) * canvas.height);
  const sx = clamp(cursor.fx * canvas.width - sw / 2, 0, Math.max(0, canvas.width - sw));
  const sy = clamp(cursor.fy * canvas.height - sh / 2, 0, Math.max(0, canvas.height - sh));
  return { sx, sy, sw, sh };
}

/**
 * Loupe center in frame CSS pixels: the cursor point, clamped so the whole
 * loupe stays over the photo. When the frame is smaller than the loupe in
 * an axis there is no fitting center, so that axis centers on the frame.
 */
export function clampZoomLensCenter(
  cursor: LensPoint,
  frame: LensSize,
  lensSize: number = ZOOM_LENS_SIZE_PX,
): LensPoint {
  if (!Number.isFinite(lensSize) || lensSize <= 0) return { x: cursor.x, y: cursor.y };
  const radius = lensSize / 2;
  return {
    x: frame.width <= lensSize ? frame.width / 2 : clamp(cursor.x, radius, frame.width - radius),
    y: frame.height <= lensSize ? frame.height / 2 : clamp(cursor.y, radius, frame.height - radius),
  };
}
