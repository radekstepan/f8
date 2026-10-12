import { describe, expect, it } from "vitest";
import { computeGridWindow } from "./virtualGrid.js";

describe("computeGridWindow", () => {
  it("renders everything when the list fits or has no measurement", () => {
    const fitting = computeGridWindow({
      itemCount: 6, columns: 3, scrollTop: 0, viewportHeight: 800,
      rowHeight: 300, rowGap: 24, overscanRows: 2,
    });
    expect(fitting).toMatchObject({ startRow: 0, endRow: 2, startIndex: 0, endIndex: 6, topSpacerHeight: 0, bottomSpacerHeight: 0, rowCount: 2 });

    const unmeasured = computeGridWindow({
      itemCount: 100, columns: 4, scrollTop: 500, viewportHeight: 800,
      rowHeight: 0, rowGap: 24, overscanRows: 2,
    });
    expect(unmeasured).toMatchObject({ startIndex: 0, endIndex: 100, topSpacerHeight: 0, bottomSpacerHeight: 0 });

    const empty = computeGridWindow({
      itemCount: 0, columns: 3, scrollTop: 0, viewportHeight: 800,
      rowHeight: 300, rowGap: 24, overscanRows: 2,
    });
    expect(empty).toMatchObject({ startIndex: 0, endIndex: 0, rowCount: 0 });
  });

  it("windows the middle rows with overscan on both sides", () => {
    const window = computeGridWindow({
      itemCount: 100, columns: 4, scrollTop: 1000, viewportHeight: 600,
      rowHeight: 200, rowGap: 20, overscanRows: 1,
    });
    // Stride 220: rows 4..7 visible, overscan adds one row each side.
    expect(window).toMatchObject({ rowCount: 25, startRow: 3, endRow: 9, startIndex: 12, endIndex: 36 });
    expect(window.topSpacerHeight).toBe(3 * 220 - 20);
    expect(window.bottomSpacerHeight).toBe(16 * 220 - 20);
  });

  it("clamps the window at the top and bottom edges", () => {
    const top = computeGridWindow({
      itemCount: 50, columns: 5, scrollTop: 0, viewportHeight: 500,
      rowHeight: 200, rowGap: 20, overscanRows: 3,
    });
    expect(top).toMatchObject({ startRow: 0, startIndex: 0, topSpacerHeight: 0 });
    expect(top.endRow).toBeGreaterThan(0);

    const bottom = computeGridWindow({
      itemCount: 50, columns: 5, scrollTop: 100000, viewportHeight: 500,
      rowHeight: 200, rowGap: 20, overscanRows: 3,
    });
    expect(bottom).toMatchObject({ endRow: 10, endIndex: 50, bottomSpacerHeight: 0 });
    expect(bottom.startRow).toBeLessThan(10);
  });

  it("conserves total grid height across spacers, rows, and grid gaps", () => {
    const rowHeight = 187;
    const rowGap = 23;
    const check = (scrollTop: number, viewportHeight: number): void => {
      const window = computeGridWindow({
        itemCount: 97, columns: 3, scrollTop, viewportHeight,
        rowHeight, rowGap, overscanRows: 2,
      });
      const full = window.rowCount * rowHeight + (window.rowCount - 1) * rowGap;
      const visibleRows = window.endRow - window.startRow;
      const spacerCount = (window.topSpacerHeight > 0 ? 1 : 0) + (window.bottomSpacerHeight > 0 ? 1 : 0);
      const gridGaps = visibleRows + spacerCount > 0 ? visibleRows + spacerCount - 1 : 0;
      const rendered = window.topSpacerHeight + visibleRows * rowHeight + window.bottomSpacerHeight + gridGaps * rowGap;
      expect(rendered).toBe(full);
    };
    // Top, middle, bottom, and a viewport taller than the list.
    check(0, 700);
    check(1500, 700);
    check(9000, 700);
    check(0, 20000);
  });

  it("clamps hostile inputs instead of producing negative ranges", () => {
    const window = computeGridWindow({
      itemCount: 40, columns: 0, scrollTop: -50, viewportHeight: -100,
      rowHeight: 200, rowGap: -10, overscanRows: -2,
    });
    expect(window.startRow).toBe(0);
    expect(window.startIndex).toBe(0);
    expect(window.endIndex).toBeGreaterThan(0);
    expect(window.topSpacerHeight).toBe(0);
    expect(window.bottomSpacerHeight).toBeGreaterThanOrEqual(0);
  });
});
