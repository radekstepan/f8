import { describe, expect, it } from "vitest";
import {
  LEGACY_REPAIR_STROKE,
  groupRetouchStrokes,
  nextRetouchStrokeId,
  remapRetouchesForStraighten,
  rotateRetouches,
  strokeIdForPoint,
} from "./retouch.js";
import type { RetouchPoint } from "./types.js";

function stamp(overrides: Partial<RetouchPoint> = {}): RetouchPoint {
  return { x: 0.5, y: 0.5, size: 0.1, strength: 100, kind: "repair", ...overrides };
}

describe("groupRetouchStrokes", () => {
  it("returns no groups for no stamps", () => {
    expect(groupRetouchStrokes([])).toEqual([]);
  });

  it("groups stamps by stroke id in first-seen order", () => {
    const groups = groupRetouchStrokes([
      stamp({ stroke: 2 }),
      stamp({ stroke: 1 }),
      stamp({ stroke: 2 }),
    ]);
    expect(groups.map((group) => group.id)).toEqual([2, 1]);
    expect(groups[0]?.points).toHaveLength(2);
    expect(groups[1]?.points).toHaveLength(1);
  });

  it("collapses legacy stamps without a stroke into one group", () => {
    const groups = groupRetouchStrokes([
      stamp({ kind: "repair" }),
      stamp({ kind: "repair" }),
    ]);
    expect(groups.map((group) => group.id)).toEqual([LEGACY_REPAIR_STROKE]);
    expect(groups[0]?.points).toHaveLength(2);
    expect(groups[0]?.kind).toBe("repair");
  });

  it("treats non-positive stroke ids as legacy", () => {
    expect(strokeIdForPoint(stamp({ stroke: 0 }))).toBe(LEGACY_REPAIR_STROKE);
    expect(strokeIdForPoint(stamp({ stroke: -4 }))).toBe(LEGACY_REPAIR_STROKE);
    expect(strokeIdForPoint(stamp({ stroke: 3 }))).toBe(3);
  });
});

describe("nextRetouchStrokeId", () => {
  it("starts at 1 and never returns a legacy id", () => {
    expect(nextRetouchStrokeId([])).toBe(1);
    expect(nextRetouchStrokeId([stamp({}), stamp({})])).toBe(1);
  });

  it("returns one past the largest positive stroke id", () => {
    expect(nextRetouchStrokeId([stamp({ stroke: 1 }), stamp({ stroke: 4 }), stamp({})])).toBe(5);
  });
});

describe("rotateRetouches", () => {
  const ORIGINAL: number | null = null;

  it("returns no stamps for no stamps", () => {
    expect(rotateRetouches([], { fromRotation: 0, toRotation: 90, cropRatio: ORIGINAL })).toEqual([]);
  });

  it("keeps a repair on the same feature for rotate right (+90)", () => {
    const out = rotateRetouches(
      [stamp({ x: 0.1, y: 0.1 }), stamp({ x: 0.2, y: 0.8 })],
      { fromRotation: 0, toRotation: 90, cropRatio: ORIGINAL },
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.x).toBeCloseTo(0.9, 6);
    expect(out[0]?.y).toBeCloseTo(0.1, 6);
    expect(out[1]?.x).toBeCloseTo(0.2, 6);
    expect(out[1]?.y).toBeCloseTo(0.2, 6);
  });

  it("keeps a repair on the same feature for rotate left (-90)", () => {
    const out = rotateRetouches([stamp({ x: 0.1, y: 0.1 })], {
      fromRotation: 0,
      toRotation: -90,
      cropRatio: ORIGINAL,
    });
    expect(out[0]?.x).toBeCloseTo(0.1, 6);
    expect(out[0]?.y).toBeCloseTo(0.9, 6);
  });

  it("maps 180 degrees to the opposite corner and keeps the brush size", () => {
    const out = rotateRetouches([stamp({ x: 0.1, y: 0.2, size: 0.1 })], {
      fromRotation: 0,
      toRotation: 180,
      cropRatio: ORIGINAL,
      sourceAspect: 1.5,
    });
    expect(out[0]?.x).toBeCloseTo(0.9, 6);
    expect(out[0]?.y).toBeCloseTo(0.8, 6);
    expect(out[0]?.size).toBeCloseTo(0.1, 6);
  });

  it("handles negative rotation values and round-trips a full circle", () => {
    const start = [stamp({ x: 0.25, y: 0.4, size: 0.1 })];
    // -90 -> -180 is one more step left (270 -> 180).
    const left = rotateRetouches(start, { fromRotation: -90, toRotation: -180, cropRatio: ORIGINAL });
    expect(left[0]?.x).toBeCloseTo(0.4, 6);
    expect(left[0]?.y).toBeCloseTo(0.75, 6);
    // Four left turns return to the start values.
    let points = start;
    for (const [from, to] of [[0, -90], [-90, -180], [-180, -270], [-270, -360]] as const) {
      points = rotateRetouches(points, { fromRotation: from, toRotation: to, cropRatio: ORIGINAL });
    }
    expect(points[0]?.x).toBeCloseTo(0.25, 6);
    expect(points[0]?.y).toBeCloseTo(0.4, 6);
  });

  it("rescales the brush so its pixel radius survives a 90-degree swap", () => {
    const out = rotateRetouches([stamp({ x: 0.5, y: 0.5, size: 0.1 })], {
      fromRotation: 0,
      toRotation: 90,
      cropRatio: ORIGINAL,
      sourceAspect: 1.5,
    });
    // Old canvas width 1.5 units, new width 1 unit: same pixels need 1.5x size.
    expect(out[0]?.size).toBeCloseTo(0.15, 6);
    const back = rotateRetouches(out, {
      fromRotation: 90,
      toRotation: 0,
      cropRatio: ORIGINAL,
      sourceAspect: 1.5,
    });
    expect(back[0]?.size).toBeCloseTo(0.1, 6);
  });

  it("preserves stroke identity and never mutates the input", () => {
    const input = [stamp({ x: 0.1, y: 0.1, size: 0.1, strength: 80, stroke: 3 })];
    const snapshot = structuredClone(input);
    const out = rotateRetouches(input, {
      fromRotation: 0,
      toRotation: 90,
      cropRatio: ORIGINAL,
      sourceAspect: 1.5,
    });
    expect(input).toEqual(snapshot);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0]?.strength).toBe(80);
    expect(out[0]?.kind).toBe("repair");
    expect(out[0]?.stroke).toBe(3);
  });

  it("maps through a square crop without resizing the brush", () => {
    const out = rotateRetouches(
      [stamp({ x: 0.5, y: 0.5, size: 0.1 }), stamp({ x: 0, y: 0, size: 0.1 })],
      { fromRotation: 0, toRotation: 90, cropRatio: 1, sourceAspect: 1.5 },
    );
    // The crop center is fixed; the top-left crop corner moves to top-right.
    expect(out[0]?.x).toBeCloseTo(0.5, 6);
    expect(out[0]?.y).toBeCloseTo(0.5, 6);
    expect(out[1]?.x).toBeCloseTo(1, 6);
    expect(out[1]?.y).toBeCloseTo(0, 6);
    // Both canvases are the same square: no rescale.
    expect(out[0]?.size).toBeCloseTo(0.1, 6);
    expect(out[1]?.size).toBeCloseTo(0.1, 6);
  });

  it("keeps repairs cropped out by the new window instead of dropping them", () => {
    // 3:2 photo in a 16:9 window: the old crop keeps full width, the new
    // portrait-rotated window keeps a short central band.
    const out = rotateRetouches([stamp({ x: 0, y: 0 })], {
      fromRotation: 0,
      toRotation: 90,
      cropRatio: 16 / 9,
      sourceAspect: 1.5,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.x).toBeCloseTo(0.921875, 6);
    // Out of range: the feature left the visible window (rotating back restores it).
    expect(out[0]?.y ?? 0).toBeLessThan(0);
    expect(out[0]?.y).toBeCloseTo(-0.833333, 5);
  });

  it("treats a matching-ratio crop as no crop on the way out", () => {
    // 3:2 photo in a 3:2 window at rotation 0 shows everything; after a
    // right turn the same window crops hard.
    const out = rotateRetouches([stamp({ x: 0, y: 0 })], {
      fromRotation: 0,
      toRotation: 90,
      cropRatio: 3 / 2,
      sourceAspect: 1.5,
    });
    expect(out[0]?.x).toBeCloseTo(1, 6);
    expect(out[0]?.y ?? 0).toBeLessThan(0);
  });

  it("falls back to the plain turn when the aspect is missing", () => {
    for (const sourceAspect of [undefined, Number.NaN, 0, -2]) {
      const out = rotateRetouches([stamp({ x: 0.1, y: 0.1, size: 0.1 })], {
        fromRotation: 0,
        toRotation: 90,
        cropRatio: ORIGINAL,
        sourceAspect,
      });
      expect(out[0]?.x).toBeCloseTo(0.9, 6);
      expect(out[0]?.y).toBeCloseTo(0.1, 6);
      expect(out[0]?.size).toBeCloseTo(0.1, 6);
    }
  });

  it("treats unknown crop ratios as Original", () => {
    const out = rotateRetouches([stamp({ x: 0.1, y: 0.1 })], {
      fromRotation: 0,
      toRotation: 90,
      cropRatio: Number.NaN,
      sourceAspect: 1.5,
    });
    expect(out[0]?.x).toBeCloseTo(0.9, 6);
    expect(out[0]?.y).toBeCloseTo(0.1, 6);
  });

  it("leaves stamps alone when the turn is not a quarter turn", () => {
    const input = [stamp({ x: 0.1, y: 0.2, size: 0.1 })];
    const out = rotateRetouches(input, { fromRotation: 0, toRotation: 45, cropRatio: ORIGINAL });
    expect(out).toEqual(input);
  });
});

describe("remapRetouchesForStraighten", () => {
  const ORIGINAL: number | null = null;

  it("keeps the canvas center fixed for any angle", () => {
    for (const [from, to] of [[0, 10], [-6, 4.2], [12, -12]] as const) {
      const out = remapRetouchesForStraighten([stamp({ x: 0.5, y: 0.5 })], {
        fromStraighten: from,
        toStraighten: to,
        rotation: 0,
        cropRatio: ORIGINAL,
        sourceAspect: 1.5,
      });
      expect(out[0]?.x).toBeCloseTo(0.5, 9);
      expect(out[0]?.y).toBeCloseTo(0.5, 9);
    }
  });

  it("turns stamps clockwise for positive angles, matching canvas convention", () => {
    // Top-of-frame point swings right under a clockwise (+5deg) turn.
    const out = remapRetouchesForStraighten([stamp({ x: 0.5, y: 0.2 })], {
      fromStraighten: 0,
      toStraighten: 5,
      rotation: 0,
      cropRatio: ORIGINAL,
      sourceAspect: 1.5,
    });
    expect(out[0]?.x ?? 0).toBeGreaterThan(0.5);
    expect(out[0]?.y ?? 1).toBeLessThan(0.2);
  });

  it("matches hand-computed rotation plus content zoom on a square canvas", () => {
    // Square, no crop, aspect 1: canvas is unit square, k1 = 1,
    // k2 = 1 + sin(10deg) = 1.173648. Point (0.6, 0.5) sits 0.1 right of
    // center: unzoomed (0.1, 0), turned 10deg, rezoomed, uncentered.
    const out = remapRetouchesForStraighten([stamp({ x: 0.6, y: 0.5, size: 0.1 })], {
      fromStraighten: 0,
      toStraighten: 10,
      rotation: 0,
      cropRatio: ORIGINAL,
      sourceAspect: 1,
    });
    expect(out[0]?.x).toBeCloseTo(0.615582, 5);
    expect(out[0]?.y).toBeCloseTo(0.52038, 5);
    expect(out[0]?.size).toBeCloseTo(0.117365, 5);
  });

  it("rescales the brush with the content zoom and preserves it across symmetric angles", () => {
    const grown = remapRetouchesForStraighten([stamp({ size: 0.1 })], {
      fromStraighten: 0,
      toStraighten: 10,
      rotation: 0,
      cropRatio: ORIGINAL,
      sourceAspect: 1.5,
    });
    // k = 1 + sin(10deg) * 1.5 = 1.260472.
    expect(grown[0]?.size).toBeCloseTo(0.126047, 5);
    // |sin| is symmetric: -5deg and +5deg zoom identically, so no rescale.
    const symmetric = remapRetouchesForStraighten([stamp({ size: 0.1 })], {
      fromStraighten: -5,
      toStraighten: 5,
      rotation: 0,
      cropRatio: ORIGINAL,
      sourceAspect: 1.5,
    });
    expect(symmetric[0]?.size).toBeCloseTo(0.1, 9);
  });

  it("round-trips back to the start values", () => {
    const start = [stamp({ x: 0.25, y: 0.4, size: 0.1 })];
    const opts = { rotation: 0, cropRatio: ORIGINAL, sourceAspect: 1.5 } as const;
    const turned = remapRetouchesForStraighten(start, { ...opts, fromStraighten: 0, toStraighten: 7.3 });
    const back = remapRetouchesForStraighten(turned, { ...opts, fromStraighten: 7.3, toStraighten: 0 });
    expect(back[0]?.x).toBeCloseTo(0.25, 9);
    expect(back[0]?.y).toBeCloseTo(0.4, 9);
    expect(back[0]?.size).toBeCloseTo(0.1, 9);
  });

  it("maps through a square crop with the crop center fixed", () => {
    const out = remapRetouchesForStraighten(
      [stamp({ x: 0.5, y: 0.5 }), stamp({ x: 0.5, y: 0.2 })],
      { fromStraighten: 0, toStraighten: 8, rotation: 0, cropRatio: 1, sourceAspect: 1.5 },
    );
    expect(out[0]?.x).toBeCloseTo(0.5, 9);
    expect(out[0]?.y).toBeCloseTo(0.5, 9);
    expect(out[1]?.x ?? 0).toBeGreaterThan(0.5);
  });

  it("uses the rotation for the canvas aspect", () => {
    // Off-centerline point: aspect skews the rotation radius, so landscape
    // and portrait canvases must disagree. (Centerline points are
    // aspect-independent because the canvas width cancels out.)
    const input = [stamp({ x: 0.6, y: 0.3 })];
    const landscape = remapRetouchesForStraighten(input, {
      fromStraighten: 0, toStraighten: 6, rotation: 0, cropRatio: ORIGINAL, sourceAspect: 1.5,
    });
    const portrait = remapRetouchesForStraighten(input, {
      fromStraighten: 0, toStraighten: 6, rotation: 90, cropRatio: ORIGINAL, sourceAspect: 1.5,
    });
    expect(portrait[0]?.x).not.toBeCloseTo(landscape[0]?.x ?? 0, 3);
  });

  it("returns equal copies for a zero delta, bad angles, or a missing aspect", () => {
    const input = [stamp({ x: 0.3, y: 0.3, size: 0.1 })];
    const base = { rotation: 0, cropRatio: ORIGINAL, sourceAspect: 1.5 } as const;
    expect(remapRetouchesForStraighten(input, { ...base, fromStraighten: 2, toStraighten: 2 })).toEqual(input);
    for (const [from, to] of [[Number.NaN, 5], [0, Number.NaN], [0, Number.POSITIVE_INFINITY]] as const) {
      expect(
        remapRetouchesForStraighten(input, { ...base, fromStraighten: from, toStraighten: to }),
      ).toEqual(input);
    }
    for (const sourceAspect of [undefined, Number.NaN, 0, -2]) {
      expect(
        remapRetouchesForStraighten(input, {
          rotation: 0, cropRatio: ORIGINAL, sourceAspect,
          fromStraighten: 0, toStraighten: 5,
        }),
      ).toEqual(input);
    }
    expect(remapRetouchesForStraighten([], {
      ...base, fromStraighten: 0, toStraighten: 5,
    })).toEqual([]);
  });

  it("preserves stroke identity and never mutates the input", () => {
    const input = [stamp({ x: 0.3, y: 0.3, size: 0.1, strength: 80, stroke: 3 })];
    const snapshot = structuredClone(input);
    const out = remapRetouchesForStraighten(input, {
      fromStraighten: 0, toStraighten: 5, rotation: 0, cropRatio: ORIGINAL, sourceAspect: 1.5,
    });
    expect(input).toEqual(snapshot);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0]?.strength).toBe(80);
    expect(out[0]?.kind).toBe("repair");
    expect(out[0]?.stroke).toBe(3);
  });
});
