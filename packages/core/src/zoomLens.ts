/** Zoom-in-view magnifier helpers.
 *
 * The View menu carries a "Zoom in View" toggle (shortcut Z) that is only
 * meaningful on an open photo: while enabled, a fixed square preview pane
 * sits in the bottom-right corner of the photo and shows the region under
 * the cursor magnified, Photoshop-navigator style. The magnification is
 * relative to the displayed photo (the fitted/zoomed frame), not to source
 * pixels — like the zoom percentages in the canvas status bar.
 *
 * The pane itself lives in PhotoCanvas (it paints from the edited canvas
 * so crop, rotation, and adjustments match the frame); this module holds
 * the pure geometry so the factor and the cursor math stay unit-testable.
 */

import type { ViewMode } from "./types.js";

/** Preview magnification relative to the displayed photo. */
export const ZOOM_LENS_MAGNIFICATION = 8;

/** Preview pane side length in CSS pixels. */
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

/** Backing-store source rectangle for one preview paint. */
export interface ZoomLensSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** True only when the preview may show: toggled on and in photo (editor) view. */
export function shouldShowZoomLens(view: ViewMode, enabled: boolean): boolean {
  return enabled && view === "editor";
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Source rectangle (in canvas backing-store pixels) for the preview paint:
 * the on-screen region is the pane side divided by the magnification,
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
