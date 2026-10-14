/** Zoom-in-view magnifier helpers.
 *
 * The View menu carries a "Zoom in View" submenu (under the Show items)
 * with 4x/8x/16x options — 8x is the default and the only one with a
 * shortcut (Z) — that is only meaningful on an open photo: while enabled,
 * a fixed square preview pane shows the region under the cursor
 * magnified, Photoshop-navigator style. The pane docks right of the
 * photo, bottom-aligned with the frame, when the stage has room (a
 * portrait photo in a wide stage); otherwise it overlays the photo's
 * bottom-right corner. The magnification is relative to the displayed
 * photo (the fitted/zoomed frame), not to source pixels — like the zoom
 * percentages in the canvas status bar.
 *
 * The pane itself lives in PhotoCanvas (it paints from the edited canvas
 * so crop, rotation, and adjustments match the frame, compositing the
 * original side while Compare is on); this module holds the pure geometry
 * so the factor and the cursor math stay unit-testable.
 */

import type { ViewMode } from "./types.js";

/** Preview magnification relative to the displayed photo (the default; see ZOOM_LENS_MAGNIFICATIONS). */
export const ZOOM_LENS_MAGNIFICATION = 8;

/** Magnifications offered by the "Zoom in View" submenu; 8x is the default. */
export const ZOOM_LENS_MAGNIFICATIONS = [4, 8, 16] as const;

/** One of the submenu's magnification options. */
export type ZoomLensMagnification = (typeof ZOOM_LENS_MAGNIFICATIONS)[number];

/** Preview pane side length in CSS pixels. */
export const ZOOM_LENS_SIZE_PX = 180;

/** Gap between the photo frame and the docked-outside preview, in CSS pixels. */
export const ZOOM_LENS_OUTSIDE_GAP_PX = 12;

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

/**
 * True when the preview docks right of the photo frame (bottom-aligned
 * with it) instead of overlaying its bottom-right corner: the centered
 * frame must leave room for the pane plus a gap on each side, and the
 * bottom-aligned pane must not poke above the stage. The inner box grows
 * past the stage when the frame overflows it at high zoom (64px/48px of
 * stage padding, mirroring `.canvas-stage-inner` and the fit math in
 * PhotoCanvas), so a zoomed frame always fails the sideways check and
 * keeps the corner overlay. Degenerate inputs yield false.
 */
export function shouldDockZoomLensOutside(
  stage: LensSize,
  frame: LensSize,
  lensSize: number = ZOOM_LENS_SIZE_PX,
  gap: number = ZOOM_LENS_OUTSIDE_GAP_PX,
): boolean {
  if (
    !Number.isFinite(stage.width) || stage.width <= 0 ||
    !Number.isFinite(stage.height) || stage.height <= 0 ||
    !Number.isFinite(frame.width) || frame.width <= 0 ||
    !Number.isFinite(frame.height) || frame.height <= 0 ||
    !Number.isFinite(lensSize) || lensSize <= 0 ||
    !Number.isFinite(gap) || gap < 0
  ) {
    return false;
  }
  const innerWidth = Math.max(stage.width, frame.width + 64);
  const innerHeight = Math.max(stage.height, frame.height + 48);
  const frameLeft = (innerWidth - frame.width) / 2;
  const frameTop = (innerHeight - frame.height) / 2;
  const paneRight = frameLeft + frame.width + gap + lensSize;
  const paneTop = frameTop + frame.height - lensSize;
  return paneRight <= innerWidth - gap && paneTop >= 0;
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

/** Pixel point in the preview pane's backing store. */
export interface ZoomLensDestPoint {
  dx: number;
  dy: number;
}

/**
 * Where a frame-fraction point lands in the preview pane (backing-store
 * pixels): the same source-to-pane mapping the paint uses, so overlays
 * (the repair brush circle) sit exactly over the magnified pixels. Near
 * the frame edges the source clamps while the cursor keeps moving, so the
 * point slides off-center — including outside the pane (the caller clips).
 * Degenerate inputs yield the pane center instead of NaN.
 */
export function zoomLensDestPoint(
  cursor: LensFraction,
  canvas: LensSize,
  rect: ZoomLensSourceRect,
  lens: LensSize,
): ZoomLensDestPoint {
  if (
    !Number.isFinite(rect.sw) || rect.sw <= 0 ||
    !Number.isFinite(rect.sh) || rect.sh <= 0 ||
    !Number.isFinite(canvas.width) || canvas.width <= 0 ||
    !Number.isFinite(canvas.height) || canvas.height <= 0 ||
    !Number.isFinite(lens.width) || lens.width <= 0 ||
    !Number.isFinite(lens.height) || lens.height <= 0
  ) {
    return { dx: lens.width / 2, dy: lens.height / 2 };
  }
  return {
    dx: ((cursor.fx * canvas.width - rect.sx) / rect.sw) * lens.width,
    dy: ((cursor.fy * canvas.height - rect.sy) / rect.sh) * lens.height,
  };
}

/** Original-side paint for one preview frame while Compare is on. */
export interface ZoomLensOriginalOverlay {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * The original-side slice to paint over the edited preview while Compare
 * splits the frame: the frame shows the original left of the divider
 * (splitPercent of the width) and the edit right of it, so the preview
 * overpaints exactly the divider's left part with original pixels from the
 * same source rect. Null when no original shows in the pane (the divider
 * sits at or right of the pane's source), full-pane when the pane's source
 * sits fully left of the divider. Degenerate inputs yield null (edited
 * only) instead of NaN.
 */
export function zoomLensOriginalOverlay(
  splitPercent: number,
  canvas: LensSize,
  rect: ZoomLensSourceRect,
  lens: LensSize,
): ZoomLensOriginalOverlay | null {
  if (
    !Number.isFinite(splitPercent) ||
    !Number.isFinite(canvas.width) || canvas.width <= 0 ||
    !Number.isFinite(rect.sx) || !Number.isFinite(rect.sw) || rect.sw <= 0 ||
    !Number.isFinite(rect.sy) || !Number.isFinite(rect.sh) || rect.sh <= 0 ||
    !Number.isFinite(lens.width) || lens.width <= 0 ||
    !Number.isFinite(lens.height) || lens.height <= 0
  ) {
    return null;
  }
  // Divider in backing-store pixels, mapped into pane pixels through the
  // same source-to-pane scale the paint uses.
  const dividerX = (splitPercent / 100) * canvas.width;
  const dw = ((dividerX - rect.sx) / rect.sw) * lens.width;
  if (dw <= 0) return null;
  if (dw >= lens.width) {
    return { sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh, dx: 0, dy: 0, dw: lens.width, dh: lens.height };
  }
  const sw = rect.sw * (dw / lens.width);
  return { sx: rect.sx, sy: rect.sy, sw, sh: rect.sh, dx: 0, dy: 0, dw, dh: lens.height };
}

/**
 * Backing-store radius for the repair brush circle in the preview pane, or
 * null when the circle must not draw: the magnified brush (frame diameter
 * times the magnification) has to fit inside the pane — a brush larger
 * than the previewed region would paint the whole pane, so it stays out.
 * Degenerate inputs yield null.
 */
export function zoomLensBrushRadius(
  brushSize: number,
  frameWidth: number,
  magnification: number,
  lensBackingWidth: number,
  lensSize: number = ZOOM_LENS_SIZE_PX,
): number | null {
  if (
    !Number.isFinite(brushSize) || brushSize <= 0 ||
    !Number.isFinite(frameWidth) || frameWidth <= 0 ||
    !Number.isFinite(magnification) || magnification <= 0 ||
    !Number.isFinite(lensBackingWidth) || lensBackingWidth <= 0 ||
    !Number.isFinite(lensSize) || lensSize <= 0
  ) {
    return null;
  }
  // Frame diameter in CSS px (the same brushSize/800 fraction the canvas
  // brush cursor uses), magnified into pane CSS px.
  const diameter = (brushSize / 800) * frameWidth * magnification;
  if (diameter > lensSize) return null;
  return (diameter / 2) * (lensBackingWidth / lensSize);
}
