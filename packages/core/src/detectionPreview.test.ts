import { describe, expect, it } from "vitest";
import { previewFrameGeometry } from "./detectionPreview.js";

describe("previewFrameGeometry", () => {
  it("maps a person box to frame pixels", () => {
    expect(
      previewFrameGeometry({ kind: "box", box: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.8 } }, 1000, 500),
    ).toEqual({ kind: "rect", x: 100, y: 100, width: 400, height: 300 });
  });

  it("maps a dust disc to a healed-style circle", () => {
    expect(previewFrameGeometry({ kind: "disc", x: 0.25, y: 0.5, radius: 0.01 }, 800, 600)).toEqual({
      kind: "circle",
      cx: 200,
      cy: 300,
      r: 8,
    });
  });

  it("keeps sub-pixel dust visible with a minimum radius", () => {
    const geometry = previewFrameGeometry({ kind: "disc", x: 0.5, y: 0.5, radius: 0.0005 }, 800, 600);
    expect(geometry).toEqual({ kind: "circle", cx: 400, cy: 300, r: 3 });
  });

  it("never reports a negative box size", () => {
    expect(
      previewFrameGeometry({ kind: "box", box: { x0: 0.6, y0: 0.6, x1: 0.5, y1: 0.5 } }, 1000, 1000),
    ).toEqual({ kind: "rect", x: 600, y: 600, width: 0, height: 0 });
  });
});
