import { describe, expect, it } from "vitest";
import {
  ZOOM_LENS_MAGNIFICATION,
  ZOOM_LENS_MAGNIFICATIONS,
  ZOOM_LENS_OUTSIDE_GAP_PX,
  ZOOM_LENS_SIZE_PX,
  shouldDockZoomLensOutside,
  shouldShowZoomLens,
  zoomLensBrushRadius,
  zoomLensDestPoint,
  zoomLensOriginalOverlay,
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

  it("offers 4x/8x/16x with 8x as the default", () => {
    expect([...ZOOM_LENS_MAGNIFICATIONS]).toEqual([4, 8, 16]);
    expect(ZOOM_LENS_MAGNIFICATIONS).toContain(ZOOM_LENS_MAGNIFICATION);
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

  it("scales the source extent with the submenu magnification", () => {
    // Same cursor and frame: 4x previews twice the region of 8x, 16x
    // half of it.
    const at4 = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, frame, ZOOM_LENS_SIZE_PX, 4);
    const at8 = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, frame, ZOOM_LENS_SIZE_PX, 8);
    const at16 = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, frame, ZOOM_LENS_SIZE_PX, 16);
    expect(at4.sw).toBeCloseTo(at8.sw * 2, 6);
    expect(at16.sw).toBeCloseTo(at8.sw / 2, 6);
    expect(at4.sh).toBeCloseTo(at8.sh * 2, 6);
    expect(at16.sh).toBeCloseTo(at8.sh / 2, 6);
  });
});

describe("zoomLensDestPoint", () => {
  const canvas = { width: 1200, height: 800 };
  const lens = { width: 360, height: 360 };

  it("lands a centered cursor in the pane center", () => {
    const rect = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, { width: 600, height: 400 });
    const point = zoomLensDestPoint({ fx: 0.5, fy: 0.5 }, canvas, rect, lens);
    expect(point.dx).toBeCloseTo(180, 6);
    expect(point.dy).toBeCloseTo(180, 6);
  });

  it("slides off-center where the source clamps at the frame edges", () => {
    const rect = zoomLensSourceRect({ fx: 0, fy: 0 }, canvas, { width: 600, height: 400 });
    const point = zoomLensDestPoint({ fx: 0, fy: 0 }, canvas, rect, lens);
    // The source clamps at the origin while the cursor sits at the very
    // edge, so the cursor maps left/above the pane center.
    expect(point.dx).toBeCloseTo(180 - (rect.sw / 2 / rect.sw) * 360, 6);
    expect(point.dx).toBeLessThan(180);
    expect(point.dy).toBeLessThan(180);
  });

  it("falls back to the pane center for degenerate inputs instead of NaN", () => {
    const rect = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, { width: 600, height: 400 });
    expect(zoomLensDestPoint({ fx: 0.5, fy: 0.5 }, canvas, { ...rect, sw: 0 }, lens)).toEqual({ dx: 180, dy: 180 });
    expect(zoomLensDestPoint({ fx: 0.5, fy: 0.5 }, { width: 0, height: 800 }, rect, lens)).toEqual({ dx: 180, dy: 180 });
  });
});

describe("zoomLensOriginalOverlay", () => {
  const canvas = { width: 1200, height: 800 };
  const lens = { width: 360, height: 360 };
  const frame = { width: 600, height: 400 };

  it("paints nothing when the divider sits right of the pane source", () => {
    // Cursor on the edited (right) side with the divider left of the
    // pane's source: the whole pane shows edited pixels.
    const rect = zoomLensSourceRect({ fx: 0.9, fy: 0.5 }, canvas, frame);
    expect(zoomLensOriginalOverlay(50, canvas, rect, lens)).toBeNull();
  });

  it("paints the full pane when its source sits fully left of the divider", () => {
    const rect = zoomLensSourceRect({ fx: 0.1, fy: 0.5 }, canvas, frame);
    expect(zoomLensOriginalOverlay(50, canvas, rect, lens)).toEqual({
      sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh,
      dx: 0, dy: 0, dw: 360, dh: 360,
    });
  });

  it("paints the divider's left slice when the pane straddles the split", () => {
    // Cursor exactly on the divider: the pane splits down the middle —
    // original left, edited right.
    const rect = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, frame);
    const overlay = zoomLensOriginalOverlay(50, canvas, rect, lens);
    expect(overlay).not.toBeNull();
    expect(overlay!.dx).toBe(0);
    expect(overlay!.dy).toBe(0);
    expect(overlay!.dw).toBeCloseTo(180, 6);
    expect(overlay!.dh).toBe(360);
    expect(overlay!.sx).toBeCloseTo(rect.sx, 6);
    expect(overlay!.sw).toBeCloseTo(rect.sw / 2, 6);
    expect(overlay!.sh).toBeCloseTo(rect.sh, 6);
  });

  it("returns null for degenerate inputs instead of NaN", () => {
    const rect = zoomLensSourceRect({ fx: 0.5, fy: 0.5 }, canvas, frame);
    expect(zoomLensOriginalOverlay(50, { width: 0, height: 800 }, rect, lens)).toBeNull();
    expect(zoomLensOriginalOverlay(50, canvas, { ...rect, sw: 0 }, lens)).toBeNull();
    expect(zoomLensOriginalOverlay(Number.NaN, canvas, rect, lens)).toBeNull();
  });
});

describe("shouldDockZoomLensOutside", () => {
  it("docks the pane beside a portrait frame with room to spare", () => {
    // Stage 1000x600, portrait frame 300x450: each side holds 350px,
    // well past the 180px pane plus a gap on each side.
    expect(shouldDockZoomLensOutside({ width: 1000, height: 600 }, { width: 300, height: 450 })).toBe(true);
  });

  it("keeps the corner overlay when a landscape frame fills the width", () => {
    // 900px frame in a 1000px stage: 50px a side cannot hold the pane.
    expect(shouldDockZoomLensOutside({ width: 1000, height: 600 }, { width: 900, height: 560 })).toBe(false);
  });

  it("keeps the corner overlay once zooming pushes the frame past the stage", () => {
    expect(shouldDockZoomLensOutside({ width: 800, height: 520 }, { width: 1472, height: 920 })).toBe(false);
  });

  it("keeps the corner overlay when the stage is too short for the bottom-aligned pane", () => {
    // Plenty of side room (350px) but the 180px pane would poke above
    // the 200px stage when bottom-aligned with the 150px frame.
    expect(shouldDockZoomLensOutside({ width: 800, height: 200 }, { width: 100, height: 150 })).toBe(false);
  });

  it("docks with exactly enough room on each side", () => {
    // Each side holds exactly the pane plus a gap on both sides.
    const side = ZOOM_LENS_SIZE_PX + ZOOM_LENS_OUTSIDE_GAP_PX * 2;
    const frame = { width: 300, height: 450 };
    expect(shouldDockZoomLensOutside({ width: 300 + side * 2, height: 600 }, frame)).toBe(true);
    expect(shouldDockZoomLensOutside({ width: 300 + side * 2 - 1, height: 600 }, frame)).toBe(false);
  });

  it("honors a custom pane size and gap", () => {
    // 350px a side holds a 300px pane with a 12px gap but not a 340px one.
    expect(shouldDockZoomLensOutside({ width: 1000, height: 600 }, { width: 300, height: 450 }, 300, 12)).toBe(true);
    expect(shouldDockZoomLensOutside({ width: 1000, height: 600 }, { width: 300, height: 450 }, 340, 12)).toBe(false);
  });

  it("returns false for degenerate inputs", () => {
    const stage = { width: 1000, height: 600 };
    const frame = { width: 300, height: 450 };
    expect(shouldDockZoomLensOutside({ width: 0, height: 600 }, frame)).toBe(false);
    expect(shouldDockZoomLensOutside(stage, { width: 300, height: 0 })).toBe(false);
    expect(shouldDockZoomLensOutside({ width: Number.NaN, height: 600 }, frame)).toBe(false);
    expect(shouldDockZoomLensOutside(stage, frame, 0)).toBe(false);
    expect(shouldDockZoomLensOutside(stage, frame, ZOOM_LENS_SIZE_PX, -1)).toBe(false);
  });
});

describe("zoomLensBrushRadius", () => {
  // Backing store is 2x the 180px CSS pane.
  const lensBacking = ZOOM_LENS_SIZE_PX * 2;

  it("returns the magnified brush radius in backing pixels when it fits", () => {
    // brushSize 45 on a 600px frame: 33.75px diameter, 270px at 8x —
    // too big. brushSize 20: 15px diameter, 120px at 8x — fits.
    expect(zoomLensBrushRadius(45, 600, 8, lensBacking)).toBeNull();
    const radius = zoomLensBrushRadius(20, 600, 8, lensBacking);
    // 15px * 8 = 120 CSS px diameter → 60 CSS px radius → 120 backing px.
    expect(radius).toBeCloseTo(120, 6);
  });

  it("draws a brush exactly the pane's size", () => {
    // brushSize 30 on a 600px frame: 22.5px diameter, exactly 180px at
    // 8x — same size as the preview, so the circle shows.
    const radius = zoomLensBrushRadius(30, 600, 8, lensBacking);
    expect(radius).toBeCloseTo(180, 6);
  });

  it("shrinks the fitted brush with the magnification", () => {
    // brushSize 20 on a 600px frame at 4x: 15px * 4 = 60px diameter.
    expect(zoomLensBrushRadius(20, 600, 4, lensBacking)).toBeCloseTo(60, 6);
  });

  it("returns null for degenerate inputs", () => {
    expect(zoomLensBrushRadius(0, 600, 8, lensBacking)).toBeNull();
    expect(zoomLensBrushRadius(20, 0, 8, lensBacking)).toBeNull();
    expect(zoomLensBrushRadius(20, 600, 0, lensBacking)).toBeNull();
    expect(zoomLensBrushRadius(20, 600, 8, 0)).toBeNull();
  });
});
