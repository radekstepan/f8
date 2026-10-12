import { describe, expect, it } from "vitest";
import { filmstripArrowIndex, filmstripWheelShift, type FilmstripWheelIntent } from "./filmstripScroll.js";

const base: FilmstripWheelIntent = { deltaX: 0, deltaY: 120, deltaMode: 0, zoomChord: false, canScrollX: true, clientWidth: 800 };

describe("filmstripWheelShift", () => {
  it("translates a vertical wheel into horizontal scroll", () => {
    expect(filmstripWheelShift(base)).toBe(120);
    expect(filmstripWheelShift({ ...base, deltaY: -60 })).toBe(-60);
  });

  it("leaves horizontal-dominant gestures to native scrolling", () => {
    expect(filmstripWheelShift({ ...base, deltaX: 120, deltaY: 40 })).toBe(0);
    // A tie is still horizontal enough to leave alone.
    expect(filmstripWheelShift({ ...base, deltaX: 120, deltaY: 120 })).toBe(0);
    expect(filmstripWheelShift({ ...base, deltaX: -30, deltaY: 0 })).toBe(0);
  });

  it("never hijacks pinch-zoom or browser-zoom chords", () => {
    expect(filmstripWheelShift({ ...base, zoomChord: true })).toBe(0);
  });

  it("does nothing when the strip fits without scrolling", () => {
    expect(filmstripWheelShift({ ...base, canScrollX: false })).toBe(0);
  });

  it("scales line-mode deltas to pixels", () => {
    expect(filmstripWheelShift({ ...base, deltaMode: 1, deltaY: 3 })).toBe(48);
  });

  it("scales page-mode deltas to one viewport in the wheel direction", () => {
    expect(filmstripWheelShift({ ...base, deltaMode: 2, deltaY: 1 })).toBe(800);
    expect(filmstripWheelShift({ ...base, deltaMode: 2, deltaY: -2 })).toBe(-800);
  });
});

describe("filmstripArrowIndex", () => {
  it("steps left and right through the row", () => {
    expect(filmstripArrowIndex("ArrowRight", 2, 5)).toBe(3);
    expect(filmstripArrowIndex("ArrowLeft", 2, 5)).toBe(1);
  });

  it("holds at the row ends instead of wrapping", () => {
    expect(filmstripArrowIndex("ArrowRight", 4, 5)).toBe(-1);
    expect(filmstripArrowIndex("ArrowLeft", 0, 5)).toBe(-1);
  });

  it("jumps to the ends with Home and End", () => {
    expect(filmstripArrowIndex("Home", 3, 5)).toBe(0);
    expect(filmstripArrowIndex("End", 3, 5)).toBe(4);
    expect(filmstripArrowIndex("Home", 0, 5)).toBe(-1);
    expect(filmstripArrowIndex("End", 4, 5)).toBe(-1);
  });

  it("ignores other keys, empty rows, and focus outside the row", () => {
    expect(filmstripArrowIndex("ArrowDown", 2, 5)).toBe(-1);
    expect(filmstripArrowIndex("Enter", 2, 5)).toBe(-1);
    expect(filmstripArrowIndex("ArrowRight", 0, 0)).toBe(-1);
    expect(filmstripArrowIndex("ArrowRight", -1, 5)).toBe(-1);
    expect(filmstripArrowIndex("ArrowRight", 5, 5)).toBe(-1);
  });
});
