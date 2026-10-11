import { describe, expect, it } from "vitest";
import {
  LEGACY_CLONE_STROKE,
  LEGACY_REPAIR_STROKE,
  groupRetouchStrokes,
  nextRetouchStrokeId,
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

  it("collapses legacy stamps without a stroke into one group per kind", () => {
    const groups = groupRetouchStrokes([
      stamp({ kind: "repair" }),
      stamp({ kind: "clone" }),
      stamp({ kind: "repair" }),
    ]);
    expect(groups.map((group) => group.id)).toEqual([LEGACY_REPAIR_STROKE, LEGACY_CLONE_STROKE]);
    expect(groups[0]?.points).toHaveLength(2);
    expect(groups[1]?.kind).toBe("clone");
  });

  it("treats non-positive stroke ids as legacy", () => {
    expect(strokeIdForPoint(stamp({ stroke: 0 }))).toBe(LEGACY_REPAIR_STROKE);
    expect(strokeIdForPoint(stamp({ kind: "clone", stroke: -4 }))).toBe(LEGACY_CLONE_STROKE);
    expect(strokeIdForPoint(stamp({ stroke: 3 }))).toBe(3);
  });
});

describe("nextRetouchStrokeId", () => {
  it("starts at 1 and never returns a legacy id", () => {
    expect(nextRetouchStrokeId([])).toBe(1);
    expect(nextRetouchStrokeId([stamp({}), stamp({ kind: "clone" })])).toBe(1);
  });

  it("returns one past the largest positive stroke id", () => {
    expect(nextRetouchStrokeId([stamp({ stroke: 1 }), stamp({ stroke: 4 }), stamp({})])).toBe(5);
  });
});
