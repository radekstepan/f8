import { describe, expect, it } from "vitest";
import { midtoneWeight } from "./adjustments.js";
import {
  MAX_CURVE_POINTS,
  MIDTONE_CURVE_RESPONSE,
  addCurvePoint,
  buildToneCurveTable,
  evaluateToneCurve,
  isCurvePointsActive,
  midtoneDisplayBend,
  moveCurvePoint,
  normalizeCurvePoints,
  removeCurvePoint,
  toneCurveDisplayPath,
} from "./toneCurve.js";
import type { CurvePoint } from "./types.js";

const point = (x: number, y: number): CurvePoint => ({ x, y });

const frozen = (points: CurvePoint[]): string => JSON.stringify(points);

describe("normalizeCurvePoints", () => {
  it("sorts by input, stably", () => {
    expect(normalizeCurvePoints([point(0.8, 0.1), point(0.2, 0.9)])).toEqual([
      point(0.2, 0.9),
      point(0.8, 0.1),
    ]);
  });

  it("clamps to 0..1", () => {
    expect(normalizeCurvePoints([point(-0.5, 1.5)])).toEqual([point(0, 1)]);
  });

  it("drops non-finite anchors", () => {
    expect(
      normalizeCurvePoints([point(0.5, 0.5), point(NaN, 0.5), point(0.5, Infinity)]),
    ).toEqual([point(0.5, 0.5)]);
  });

  it("merges shared inputs keeping the latest drop", () => {
    expect(normalizeCurvePoints([point(0.5, 0.2), point(0.5, 0.8)])).toEqual([point(0.5, 0.8)]);
  });

  it("caps the anchor count", () => {
    const many = Array.from({ length: MAX_CURVE_POINTS + 4 }, (_, i) =>
      point((i + 1) / (MAX_CURVE_POINTS + 5), 0.5),
    );
    expect(normalizeCurvePoints(many)).toHaveLength(MAX_CURVE_POINTS);
  });

  it("treats nullish lists as empty", () => {
    expect(normalizeCurvePoints(null)).toEqual([]);
    expect(normalizeCurvePoints(undefined)).toEqual([]);
  });

  it("never mutates the input", () => {
    const input = [point(0.8, 0.1), point(0.2, 0.9)];
    const before = frozen(input);
    normalizeCurvePoints(input);
    expect(frozen(input)).toBe(before);
  });
});

describe("isCurvePointsActive", () => {
  it("is false for empty, nullish, and garbage lists", () => {
    expect(isCurvePointsActive([])).toBe(false);
    expect(isCurvePointsActive(null)).toBe(false);
    expect(isCurvePointsActive(undefined)).toBe(false);
    expect(isCurvePointsActive([point(NaN, NaN)])).toBe(false);
  });

  it("is true for one usable anchor", () => {
    expect(isCurvePointsActive([point(0.5, 0.6)])).toBe(true);
  });
});

describe("addCurvePoint", () => {
  it("appends in sorted position", () => {
    expect(addCurvePoint([point(0.2, 0.2), point(0.8, 0.8)], 0.5, 0.6)).toEqual([
      point(0.2, 0.2),
      point(0.5, 0.6),
      point(0.8, 0.8),
    ]);
  });

  it("clamps out-of-range drops", () => {
    expect(addCurvePoint([], -0.2, 1.4)).toEqual([point(0, 1)]);
  });

  it("returns the input unchanged at the cap", () => {
    const full = Array.from({ length: MAX_CURVE_POINTS }, (_, i) =>
      point((i + 1) / (MAX_CURVE_POINTS + 1), 0.5),
    );
    expect(addCurvePoint(full, 0.5, 0.9)).toBe(full);
  });

  it("returns the input unchanged for non-finite drops", () => {
    const current = [point(0.5, 0.5)];
    expect(addCurvePoint(current, NaN, 0.5)).toBe(current);
  });

  it("never mutates the input", () => {
    const input = [point(0.2, 0.2)];
    const before = frozen(input);
    addCurvePoint(input, 0.5, 0.5);
    expect(frozen(input)).toBe(before);
  });
});

describe("moveCurvePoint", () => {
  const anchors = [point(0.2, 0.2), point(0.5, 0.5), point(0.8, 0.8)];

  it("moves within range", () => {
    expect(moveCurvePoint(anchors, 1, 0.55, 0.6)[1]).toEqual(point(0.55, 0.6));
  });

  it("clamps the output to 0..1", () => {
    expect(moveCurvePoint(anchors, 1, 0.5, 1.4)[1]).toEqual(point(0.5, 1));
    expect(moveCurvePoint(anchors, 1, 0.5, -1.4)[1]).toEqual(point(0.5, 0));
  });

  it("stops at the neighbors instead of reordering", () => {
    const right = moveCurvePoint(anchors, 1, 0.95, 0.5)[1];
    expect(right?.x).toBeLessThan(0.8);
    expect(right?.x).toBeGreaterThan(0.5);
    const left = moveCurvePoint(anchors, 1, 0.05, 0.5)[1];
    expect(left?.x).toBeGreaterThan(0.2);
    expect(left?.x).toBeLessThan(0.5);
  });

  it("clamps the edge anchors to the graph ends", () => {
    expect(moveCurvePoint(anchors, 0, -0.5, 0.2)[0]).toEqual(point(0, 0.2));
    expect(moveCurvePoint(anchors, 2, 1.5, 0.8)[2]).toEqual(point(1, 0.8));
  });

  it("ignores out-of-range and non-finite moves", () => {
    expect(moveCurvePoint(anchors, 9, 0.5, 0.5)).toEqual(anchors);
    expect(moveCurvePoint(anchors, 1, NaN, 0.5)).toEqual(anchors);
  });

  it("never mutates the input", () => {
    const before = frozen(anchors);
    moveCurvePoint(anchors, 1, 0.55, 0.6);
    expect(frozen(anchors)).toBe(before);
  });
});

describe("removeCurvePoint", () => {
  it("drops the anchor by index", () => {
    expect(removeCurvePoint([point(0.2, 0.2), point(0.8, 0.8)], 0)).toEqual([point(0.8, 0.8)]);
  });

  it("ignores out-of-range indexes", () => {
    const anchors = [point(0.5, 0.5)];
    expect(removeCurvePoint(anchors, 4)).toEqual(anchors);
  });

  it("never mutates the input", () => {
    const input = [point(0.2, 0.2), point(0.8, 0.8)];
    const before = frozen(input);
    removeCurvePoint(input, 0);
    expect(frozen(input)).toBe(before);
  });
});

describe("evaluateToneCurve", () => {
  it("is identity for empty and nullish lists", () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(evaluateToneCurve([], x)).toBeCloseTo(x, 12);
      expect(evaluateToneCurve(null, x)).toBeCloseTo(x, 12);
    }
    expect(evaluateToneCurve([], 1.5)).toBe(1);
    expect(evaluateToneCurve([], -0.2)).toBe(0);
  });

  it("passes through every anchor and pins black and white", () => {
    const anchors = [point(0.25, 0.1), point(0.5, 0.75), point(0.8, 0.9)];
    expect(evaluateToneCurve(anchors, 0)).toBe(0);
    expect(evaluateToneCurve(anchors, 1)).toBe(1);
    for (const anchor of anchors) {
      expect(evaluateToneCurve(anchors, anchor.x)).toBeCloseTo(anchor.y, 9);
    }
  });

  it("stays in range and never overshoots past its anchors", () => {
    // A peak and a valley: each segment must stay inside its endpoint range.
    const anchors = [point(0.3, 0.8), point(0.7, 0.2)];
    for (let i = 0; i <= 100; i += 1) {
      const x = i / 100;
      const y = evaluateToneCurve(anchors, x);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      if (x >= 0.3 && x <= 0.7) {
        expect(y).toBeGreaterThanOrEqual(0.2 - 1e-9);
        expect(y).toBeLessThanOrEqual(0.8 + 1e-9);
      }
    }
  });

  it("keeps monotone anchors monotone", () => {
    const anchors = [point(0.25, 0.3), point(0.6, 0.55), point(0.85, 0.9)];
    let prev = -1;
    for (let i = 0; i <= 100; i += 1) {
      const y = evaluateToneCurve(anchors, i / 100);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
    }
  });
});

describe("buildToneCurveTable", () => {
  it("is null while the curve is identity", () => {
    expect(buildToneCurveTable([])).toBeNull();
    expect(buildToneCurveTable(null)).toBeNull();
  });

  it("remaps 256 levels and pins the extremes", () => {
    const table = buildToneCurveTable([point(0.5, 0.75)])!;
    expect(table).toHaveLength(256);
    expect(table[0]).toBe(0);
    expect(table[255]).toBe(255);
    expect(table[128] ?? 0).toBeGreaterThan(128);
  });
});

describe("midtoneDisplayBend", () => {
  it("pins black and white at any slider value", () => {
    expect(midtoneDisplayBend(0, 100)).toBe(0);
    expect(midtoneDisplayBend(1, -100)).toBe(1);
  });

  it("matches the pipeline's midtone bell and response", () => {
    const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
    for (const midtone of [-100, -37, 0, 42, 100]) {
      for (let i = 0; i <= 20; i += 1) {
        const x = i / 20;
        expect(midtoneDisplayBend(x, midtone)).toBeCloseTo(
          clamp01(x + (midtone * midtoneWeight(x) * 0.6) / 255),
          12,
        );
      }
    }
    // The shared response constant is the pipeline's historical 0.6 scale.
    expect(MIDTONE_CURVE_RESPONSE).toBe(0.6);
  });
});

describe("toneCurveDisplayPath", () => {
  it("draws the diagonal for the default recipe", () => {
    expect(toneCurveDisplayPath([], 0, 3)).toBe("M0 160L120 80L240 0");
  });

  it("pins black and white with anchors and bend combined", () => {
    const d = toneCurveDisplayPath([point(0.3, 0.8), point(0.7, 0.2)], -60);
    expect(d.startsWith("M0 160")).toBe(true);
    expect(d.endsWith("L240 0")).toBe(true);
  });

  it("bends the middle with the Midtones slider", () => {
    expect(toneCurveDisplayPath([], 100, 3)).toBe("M0 160L120 42.4L240 0");
    expect(toneCurveDisplayPath([], -100, 3)).toBe("M0 160L120 117.6L240 0");
  });

  it("pulls the line through a placed anchor", () => {
    expect(toneCurveDisplayPath([point(0.5, 0.75)], 0, 3)).toBe("M0 160L120 40L240 0");
  });

  it("needs at least two samples", () => {
    expect(toneCurveDisplayPath([], 0, 1)).toBe("M0 160L240 0");
  });
});
