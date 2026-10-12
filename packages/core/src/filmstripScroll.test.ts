import { describe, expect, it } from "vitest";
import { filmstripArrowIndex, filmstripCenteredScrollOffset, filmstripGridArrowIndex, filmstripOverflows, filmstripWheelShift, type FilmstripCenterIntent, type FilmstripWheelIntent } from "./filmstripScroll.js";

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

  it("leaves the wheel native when rows overflow vertically", () => {
    expect(filmstripWheelShift({ ...base, canScrollY: true })).toBe(0);
    expect(filmstripWheelShift({ ...base, canScrollY: true, canScrollX: false })).toBe(0);
  });

  it("still translates when only horizontal overflow exists", () => {
    expect(filmstripWheelShift({ ...base, canScrollY: false })).toBe(120);
    // The single-row strip omits canScrollY: no vertical overflow is assumed.
    expect(filmstripWheelShift(base)).toBe(120);
  });

  it("scales line-mode deltas to pixels", () => {
    expect(filmstripWheelShift({ ...base, deltaMode: 1, deltaY: 3 })).toBe(48);
  });

  it("scales page-mode deltas to one viewport in the wheel direction", () => {
    expect(filmstripWheelShift({ ...base, deltaMode: 2, deltaY: 1 })).toBe(800);
    expect(filmstripWheelShift({ ...base, deltaMode: 2, deltaY: -2 })).toBe(-800);
  });
});

describe("filmstripOverflows", () => {
  it("reports overflow only past the sub-pixel tolerance", () => {
    expect(filmstripOverflows(200, 100)).toBe(true);
    expect(filmstripOverflows(100, 100)).toBe(false);
    expect(filmstripOverflows(100.5, 100)).toBe(false);
    expect(filmstripOverflows(101, 100)).toBe(false);
    expect(filmstripOverflows(101.5, 100)).toBe(true);
    expect(filmstripOverflows(50, 100)).toBe(false);
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

describe("filmstripGridArrowIndex", () => {
  // 10 items in 4 columns: rows [0-3], [4-7], [8-9] (last row partial).
  it("steps up and down one row in the same column", () => {
    expect(filmstripGridArrowIndex("ArrowDown", 1, 10, 4)).toBe(5);
    expect(filmstripGridArrowIndex("ArrowUp", 5, 10, 4)).toBe(1);
    expect(filmstripGridArrowIndex("ArrowDown", 5, 10, 4)).toBe(9);
    expect(filmstripGridArrowIndex("ArrowUp", 9, 10, 4)).toBe(5);
  });

  it("holds at the first and last rows instead of wrapping", () => {
    expect(filmstripGridArrowIndex("ArrowUp", 2, 10, 4)).toBe(-1);
    expect(filmstripGridArrowIndex("ArrowDown", 8, 10, 4)).toBe(-1);
    expect(filmstripGridArrowIndex("ArrowDown", 9, 10, 4)).toBe(-1);
  });

  it("holds when the partial last row has no cell below", () => {
    expect(filmstripGridArrowIndex("ArrowDown", 6, 10, 4)).toBe(-1);
    expect(filmstripGridArrowIndex("ArrowDown", 7, 10, 4)).toBe(-1);
  });

  it("matches the linear helper for Left, Right, Home, and End", () => {
    for (const [key, index] of [["ArrowRight", 2], ["ArrowLeft", 2], ["ArrowRight", 9], ["ArrowLeft", 0], ["Home", 3], ["End", 3], ["Enter", 2]] as const) {
      expect(filmstripGridArrowIndex(key, index, 10, 4)).toBe(filmstripArrowIndex(key, index, 10));
    }
  });

  it("holds Up and Down in a single row or with unknown columns", () => {
    expect(filmstripGridArrowIndex("ArrowDown", 2, 5, 5)).toBe(-1);
    expect(filmstripGridArrowIndex("ArrowUp", 2, 5, 5)).toBe(-1);
    expect(filmstripGridArrowIndex("ArrowDown", 2, 5, 0)).toBe(-1);
    expect(filmstripGridArrowIndex("ArrowUp", 2, 5, -1)).toBe(-1);
  });

  it("ignores empty grids and focus outside the grid", () => {
    expect(filmstripGridArrowIndex("ArrowDown", 0, 0, 4)).toBe(-1);
    expect(filmstripGridArrowIndex("ArrowDown", -1, 10, 4)).toBe(-1);
    expect(filmstripGridArrowIndex("ArrowDown", 10, 10, 4)).toBe(-1);
  });
});

describe("filmstripCenteredScrollOffset", () => {
  // Single-row strip, 800px viewport over 2000px of content; item 91px wide.
  const row: FilmstripCenterIntent = {
    scrollLeft: 0, scrollTop: 0, clientWidth: 800, clientHeight: 80,
    scrollWidth: 2000, scrollHeight: 80,
    itemLeft: 1000, itemTop: 0, itemWidth: 91, itemHeight: 72,
  };

  it("centers a middle item on the viewport", () => {
    // Item center 1045.5 - viewport half 400 = 645.5.
    expect(filmstripCenteredScrollOffset(row)).toEqual({ scrollLeft: 645.5, scrollTop: 0 });
  });

  it("recenters even when the item is already fully visible", () => {
    // Visible at the right edge (the old inline:nearest landing spot).
    const atEdge = { ...row, scrollLeft: 200, itemLeft: 900 };
    expect(filmstripCenteredScrollOffset(atEdge).scrollLeft).toBe(545.5);
  });

  it("clamps to the start and end instead of showing empty space", () => {
    expect(filmstripCenteredScrollOffset({ ...row, itemLeft: 0 }).scrollLeft).toBe(0);
    expect(filmstripCenteredScrollOffset({ ...row, itemLeft: 100 }).scrollLeft).toBe(0);
    expect(filmstripCenteredScrollOffset({ ...row, itemLeft: 1909 }).scrollLeft).toBe(1200);
    expect(filmstripCenteredScrollOffset({ ...row, itemLeft: 1800 }).scrollLeft).toBe(1200);
  });

  it("keeps the current offset on axes without overflow", () => {
    const fits = { ...row, scrollWidth: 800, scrollLeft: 0 };
    expect(filmstripCenteredScrollOffset(fits)).toEqual({ scrollLeft: 0, scrollTop: 0 });
    // Sub-pixel overflow within tolerance still counts as fitting.
    expect(filmstripCenteredScrollOffset({ ...fits, scrollWidth: 800.5 })).toEqual({ scrollLeft: 0, scrollTop: 0 });
    // A non-positive viewport never scrolls.
    expect(filmstripCenteredScrollOffset({ ...row, clientWidth: 0, scrollLeft: 7 }).scrollLeft).toBe(7);
  });

  // Wrapped strip: 3+ rows over an 800x160 viewport, 72px rows + 9px gaps.
  const grid: FilmstripCenterIntent = {
    scrollLeft: 0, scrollTop: 0, clientWidth: 800, clientHeight: 160,
    scrollWidth: 800, scrollHeight: 400,
    itemLeft: 400, itemTop: 0, itemWidth: 91, itemHeight: 72,
  };

  it("reveals rows below and above with nearest semantics", () => {
    // Third row (top 162) below the 160px viewport: bottom-align it.
    expect(filmstripCenteredScrollOffset({ ...grid, itemTop: 162 })).toEqual({ scrollLeft: 0, scrollTop: 74 });
    // First row while scrolled down: top-align it.
    expect(filmstripCenteredScrollOffset({ ...grid, scrollTop: 100, itemTop: 0 })).toEqual({ scrollLeft: 0, scrollTop: 0 });
  });

  it("leaves a visible row alone vertically", () => {
    expect(filmstripCenteredScrollOffset({ ...grid, itemTop: 81 })).toEqual({ scrollLeft: 0, scrollTop: 0 });
    expect(filmstripCenteredScrollOffset({ ...grid, scrollTop: 74, itemTop: 81 })).toEqual({ scrollLeft: 0, scrollTop: 74 });
  });

  it("clamps the vertical reveal at the content end", () => {
    // Last row bottom 400 with a 160px viewport pins to max 240.
    expect(filmstripCenteredScrollOffset({ ...grid, itemTop: 328 })).toEqual({ scrollLeft: 0, scrollTop: 240 });
  });
});
