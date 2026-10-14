import { describe, expect, it } from "vitest";
import {
  ZOOM_LENS_MAGNIFICATION,
  ZOOM_LENS_SIZE_PX,
  shouldShowZoomLens,
  zoomLensSourceRect,
} from "./zoomLens.js";

describe("shouldShowZoomLens", () => {
  it("shows the preview when toggled on in photo view", () => {
    expect(shouldShowZoomLens("editor", true)).toBe(true);
  });

  it("hides the preview in the library grid even when toggled on", () => {
    expect(shouldShowZoomLens("library", true)).toBe(false);
  });

  it("restores the normal view when toggled off", () => {
    expect(shouldShowZoomLens("editor", false)).toBe(false);
    expect(shouldShowZoomLens("library", false)).toBe(false);
  });
});

describe("ZOOM_LENS_MAGNIFICATION", () => {
  it("magnifies 8x", () => {
    expect(ZOOM_LENS_MAGNIFICATION).toBe(8);
  });
});

describe("zoomLensSourceRect", () => {
  const canvas = { width: 1200, height: 800 };
  const frame = { width: 600, height: 400 };

  it("centers the source on the cursor fraction", () => {
    // On-screen source extent is 180/8 = 22.5 CSS px; the frame maps 2:1
    // into backing pixels, so 45 x 45 backing px around the center.
    const rect = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, frame);
    expect(rect.sw).toBeCloseTo(45, 6);
    expect(rect.sh).toBeCloseTo(45, 6);
    expect(rect.sx).toBeCloseTo(600 - 22.5, 6);
    expect(rect.sy).toBeCloseTo(400 - 22.5, 6);
  });

  it("follows the cursor to a corner", () => {
    const rect = zoomLensSourceRect({ fx: 0.25, fy: 0.75 }, canvas, frame);
    expect(rect.sx).toBeCloseTo(300 - rect.sw / 2, 6);
    expect(rect.sy).toBeCloseTo(600 - rect.sh / 2, 6);
  });

  it("clamps the source inside the canvas at the edges", () => {
    const topLeft = zoomLensSourceRect({ fx: 0, fy: 0 }, canvas, frame);
    expect(topLeft.sx).toBe(0);
    expect(topLeft.sy).toBe(0);
    const bottomRight = zoomLensSourceRect({ fx: 1, fy: 1 }, canvas, frame);
    expect(bottomRight.sx).toBeCloseTo(canvas.width - bottomRight.sw, 6);
    expect(bottomRight.sy).toBeCloseTo(canvas.height - bottomRight.sh, 6);
  });

  it("clamps a source larger than the canvas on a tiny frame", () => {
    // An 8px frame is narrower than the 22.5px on-screen source extent, so
    // the backing-store source would exceed the canvas and clamps to it.
    const tinyFrame = { width: 8, height: 8 };
    const rect = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, tinyFrame);
    expect(rect.sw).toBe(canvas.width);
    expect(rect.sh).toBe(canvas.height);
    expect(rect.sx).toBe(0);
    expect(rect.sy).toBe(0);
  });

  it("returns an empty rect for degenerate inputs instead of NaN", () => {
    expect(zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, { width: 0, height: 800 }, frame)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, { width: 0, height: 400 })).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, frame, ZOOM_LENS_SIZE_PX, 0)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});
