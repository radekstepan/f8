import { describe, expect, it } from "vitest";
import {
  decodeMovePayload,
  encodeMovePayload,
  extendPhotoRange,
  marqueeSelectedIds,
  rectsIntersect,
  resolveMoveTargets,
  togglePhotoSelection,
} from "./photoSelection.js";

describe("togglePhotoSelection", () => {
  it("adds a missing id and keeps order stable", () => {
    expect(togglePhotoSelection(["p1", "p2"], "p3")).toEqual(["p1", "p2", "p3"]);
  });

  it("removes a present id", () => {
    expect(togglePhotoSelection(["p1", "p2"], "p1")).toEqual(["p2"]);
  });
});

describe("extendPhotoRange", () => {
  const order = ["p1", "p2", "p3", "p4"];

  it("unions the anchor..target range into the selection", () => {
    expect(extendPhotoRange(order, ["p1"], "p1", "p3")).toEqual({ selected: ["p1", "p2", "p3"], anchor: "p1" });
  });

  it("works backwards from the anchor", () => {
    expect(extendPhotoRange(order, [], "p4", "p2")).toEqual({ selected: ["p2", "p3", "p4"], anchor: "p4" });
  });

  it("falls back to a toggle without an anchor", () => {
    expect(extendPhotoRange(order, ["p1"], null, "p3")).toEqual({ selected: ["p1", "p3"], anchor: "p3" });
  });

  it("falls back to a toggle when the anchor left the grid", () => {
    expect(extendPhotoRange(order, [], "gone", "p2")).toEqual({ selected: ["p2"], anchor: "p2" });
  });
});

describe("resolveMoveTargets", () => {
  it("moves the whole selection when the target is selected", () => {
    expect(resolveMoveTargets(["p1", "p2"], "p2")).toEqual(["p1", "p2"]);
  });

  it("re-targets to the photo alone when it is outside the selection", () => {
    expect(resolveMoveTargets(["p1", "p2"], "p3")).toEqual(["p3"]);
  });

  it("moves the photo alone with no selection", () => {
    expect(resolveMoveTargets([], "p3")).toEqual(["p3"]);
  });
});

describe("marquee hit-testing", () => {
  it("intersects overlapping rects and touching edges", () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("returns hit ids in grid order", () => {
    const entries = [
      { id: "p1", rect: { x: 0, y: 0, width: 10, height: 10 } },
      { id: "p2", rect: { x: 100, y: 100, width: 10, height: 10 } },
      { id: "p3", rect: { x: 5, y: 5, width: 10, height: 10 } },
    ];
    expect(marqueeSelectedIds(entries, { x: 0, y: 0, width: 12, height: 12 })).toEqual(["p1", "p3"]);
  });
});

describe("move payload", () => {
  it("round-trips photo ids", () => {
    expect(decodeMovePayload(encodeMovePayload(["p1", "p2"]))).toEqual(["p1", "p2"]);
  });

  it("never throws on garbage", () => {
    expect(decodeMovePayload("not json")).toEqual([]);
    expect(decodeMovePayload('{"nope":true}')).toEqual([]);
    expect(decodeMovePayload('["p1",42]')).toEqual(["p1"]);
  });
});
