import { describe, expect, it } from "vitest";
import { panScrollFromDrag, resolveCanvasDrag, type CanvasDragIntent } from "./canvasPan.js";

const base: CanvasDragIntent = { canPaint: false, pannable: true, button: 0, pointerType: "mouse", spaceHeld: false };

describe("resolveCanvasDrag", () => {
  it("pans a primary drag when zoomed in and not painting", () => {
    expect(resolveCanvasDrag(base)).toBe("pan");
  });

  it("does nothing when the frame fits the stage", () => {
    expect(resolveCanvasDrag({ ...base, pannable: false })).toBe("none");
  });

  it("lets the repair brush paint instead of panning", () => {
    expect(resolveCanvasDrag({ ...base, canPaint: true })).toBe("paint");
  });

  it("treats Space as a grab-tool override that pans even in the brush", () => {
    expect(resolveCanvasDrag({ ...base, canPaint: true, spaceHeld: true })).toBe("pan");
  });

  it("does nothing for Space when there is nowhere to pan", () => {
    expect(resolveCanvasDrag({ ...base, pannable: false, spaceHeld: true })).toBe("none");
  });

  it("pans a middle-drag on any tool, including the brush", () => {
    expect(resolveCanvasDrag({ ...base, button: 1 })).toBe("pan");
    expect(resolveCanvasDrag({ ...base, button: 1, canPaint: true })).toBe("pan");
  });

  it("does nothing for a middle press when the frame fits", () => {
    expect(resolveCanvasDrag({ ...base, button: 1, pannable: false })).toBe("none");
  });

  it("ignores secondary and auxiliary buttons", () => {
    expect(resolveCanvasDrag({ ...base, button: 2 })).toBe("none");
    expect(resolveCanvasDrag({ ...base, button: 3 })).toBe("none");
  });

  it("lets touch paint but never captures it for panning (native scroll)", () => {
    expect(resolveCanvasDrag({ ...base, pointerType: "touch" })).toBe("none");
    expect(resolveCanvasDrag({ ...base, pointerType: "touch", canPaint: true })).toBe("paint");
    expect(resolveCanvasDrag({ ...base, pointerType: "touch", canPaint: true, spaceHeld: true })).toBe("none");
  });

  it("treats pen like a mouse", () => {
    expect(resolveCanvasDrag({ ...base, pointerType: "pen" })).toBe("pan");
    expect(resolveCanvasDrag({ ...base, pointerType: "pen", canPaint: true })).toBe("paint");
  });
});

describe("panScrollFromDrag", () => {
  it("tracks the pointer 1:1, dragging the view with the press point", () => {
    const start = { scrollLeft: 100, scrollTop: 50, clientX: 400, clientY: 300 };
    // Drag left/up: the viewport moves right/down into the photo.
    expect(panScrollFromDrag(start, { clientX: 250, clientY: 220 })).toEqual({ scrollLeft: 250, scrollTop: 130 });
    // Drag right/down: the viewport moves back toward the origin.
    expect(panScrollFromDrag(start, { clientX: 460, clientY: 340 })).toEqual({ scrollLeft: 40, scrollTop: 10 });
  });

  it("holds still without pointer movement", () => {
    const start = { scrollLeft: 100, scrollTop: 50, clientX: 400, clientY: 300 };
    expect(panScrollFromDrag(start, { clientX: 400, clientY: 300 })).toEqual({ scrollLeft: 100, scrollTop: 50 });
  });
});
