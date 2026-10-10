import { describe, expect, it } from "vitest";
import {
  foldLineAngle,
  segmentAngleDeg,
  voteStraightenAngle,
  type LineSegment,
} from "./straighten.js";

function seg(x1: number, y1: number, x2: number, y2: number): LineSegment {
  return { x1, y1, x2, y2 };
}

/** Segment of `length` px at a screen angle of `degrees` (+clockwise). */
function tilted(degrees: number, length = 300): LineSegment {
  const theta = (degrees * Math.PI) / 180;
  return seg(0, 0, Math.cos(theta) * length, Math.sin(theta) * length);
}

describe("foldLineAngle", () => {
  it("leaves near-horizontal angles untouched", () => {
    expect(foldLineAngle(5)).toBe(5);
    expect(foldLineAngle(-12.5)).toBe(-12.5);
    expect(foldLineAngle(0)).toBe(0);
  });

  it("folds direction-flipped horizontals back to the same angle", () => {
    // atan2 of a reversed segment differs by 180 degrees.
    expect(foldLineAngle(185)).toBeCloseTo(5, 10);
    expect(foldLineAngle(-175)).toBeCloseTo(5, 10);
  });

  it("folds verticals to -90", () => {
    expect(foldLineAngle(90)).toBe(-90);
    expect(foldLineAngle(-90)).toBe(-90);
    expect(foldLineAngle(270)).toBe(-90);
  });
});

describe("segmentAngleDeg", () => {
  it("reports 0 for horizontal segments however endpoints are ordered", () => {
    expect(segmentAngleDeg(seg(10, 40, 200, 40))).toBe(0);
    expect(segmentAngleDeg(seg(200, 40, 10, 40))).toBe(0);
  });

  it("is direction-invariant on diagonals", () => {
    expect(segmentAngleDeg(seg(0, 0, 100, 100))).toBeCloseTo(45, 10);
    expect(segmentAngleDeg(seg(100, 100, 0, 0))).toBeCloseTo(45, 10);
  });

  it("measures known tilts in screen coordinates", () => {
    expect(segmentAngleDeg(tilted(5))).toBeCloseTo(5, 9);
    expect(segmentAngleDeg(tilted(-8))).toBeCloseTo(-8, 9);
  });
});

describe("voteStraightenAngle", () => {
  it("returns the negated tilt for a single line at a known angle", () => {
    // A horizon running +5 deg clockwise needs a -5 deg correction.
    const vote = voteStraightenAngle([tilted(5)]);
    expect(vote.angle).toBeCloseTo(-5, 1);
    expect(vote.confidence).toBe(1);
  });

  it("stays neutral for a level horizon", () => {
    expect(voteStraightenAngle([seg(0, 100, 400, 100)])).toEqual({ angle: 0, confidence: 1 });
  });

  it("weights inliers by segment length", () => {
    // (4 * 300 + -8 * 100) / 400 = 1 deg mean tilt -> -1 correction.
    const vote = voteStraightenAngle([tilted(4, 300), tilted(-8, 100)]);
    expect(vote.angle).toBeCloseTo(-1, 1);
    expect(vote.confidence).toBeGreaterThan(0.4);
  });

  it("ignores outlier angles for the vote but counts them against confidence", () => {
    const vote = voteStraightenAngle([seg(0, 100, 200, 100), seg(50, 0, 50, 200)]);
    expect(vote.angle).toBe(0);
    expect(vote.confidence).toBe(0.5);
  });

  it("treats beyond-range tilts as outliers", () => {
    const vote = voteStraightenAngle([tilted(30, 200), seg(0, 100, 200, 100)]);
    expect(vote.angle).toBe(0);
    expect(vote.confidence).toBe(0.5);
  });

  it("yields zero confidence when inliers fully disagree", () => {
    const vote = voteStraightenAngle([tilted(15, 200), tilted(-15, 200)]);
    expect(vote.angle).toBe(0);
    expect(vote.confidence).toBe(0);
  });

  it("rounds the correction to slider precision", () => {
    const vote = voteStraightenAngle([tilted(2.34, 250)]);
    expect(vote.angle).toBeCloseTo(-2.3, 10);
  });

  it("yields a zero angle with zero confidence when no lines are found", () => {
    expect(voteStraightenAngle([])).toEqual({ angle: 0, confidence: 0 });
  });

  it("yields a zero angle with zero confidence for vertical-only input", () => {
    expect(voteStraightenAngle([seg(50, 0, 50, 200), seg(150, 0, 150, 200)])).toEqual({
      angle: 0,
      confidence: 0,
    });
  });

  it("skips degenerate and non-finite segments", () => {
    const vote = voteStraightenAngle([
      seg(10, 10, 10, 10),
      { x1: NaN, y1: 0, x2: 10, y2: 0 },
      seg(0, 100, 400, 100),
    ]);
    expect(vote).toEqual({ angle: 0, confidence: 1 });
    expect(voteStraightenAngle([seg(7, 7, 7, 7)])).toEqual({ angle: 0, confidence: 0 });
  });
});
