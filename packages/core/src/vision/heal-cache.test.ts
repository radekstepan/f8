import { describe, expect, it, vi } from "vitest";
import type { PixelImage } from "./analyze.js";
import { solidColor } from "./fixtures.js";
import {
  bboxForMask,
  clockwiseStepsForRotation,
  enforceHealCacheLimit,
  featheredBboxForGroup,
  geometryKeyForHealCache,
  geometryPrefixForKey,
  healSingleGroup,
  pasteHealPatches,
  partitionHealGroups,
  pointsHashForGroup,
  pointsKeyForGroup,
  reusableOverlayForGroup,
  rotateHealPatch,
  signatureForHealGroup,
  signaturePointsHash,
  type CachedHealPatch,
  type HealCacheParams,
  type StoredHealPatch,
} from "./heal-cache.js";
import { groupRetouchStrokes, rotateRetouches } from "../retouch.js";
import type { RetouchPoint } from "../types.js";

function repair(
  x: number,
  y: number,
  size: number,
  stroke: number,
  strength = 100,
): RetouchPoint {
  return { x, y, size, strength, kind: "repair", stroke };
}

function params(overrides: Partial<HealCacheParams> = {}): HealCacheParams {
  return {
    method: "ml-heal",
    quality: "balanced",
    seamlessLight: false,
    featherPx: 2,
    geometryKey: "photo|4/3|0|0|0|0|100x80",
    ...overrides,
  };
}

function patch(
  id: number,
  points: RetouchPoint[],
  width: number,
  height: number,
  extra: Partial<HealCacheParams> = {},
): { cache: Map<number, CachedHealPatch>; groups: ReturnType<typeof groupRetouchStrokes> } {
  const p = params(extra);
  const groups = groupRetouchStrokes(points).filter((g) => g.kind === "repair");
  const cache = new Map<number, CachedHealPatch>();
  for (const group of groups) {
    const bbox = featheredBboxForGroup(group, width, height, p.featherPx);
    if (!bbox) continue;
    cache.set(id, {
      signature: signatureForHealGroup(group, p),
      x0: bbox.x0,
      y0: bbox.y0,
      width: bbox.width,
      height: bbox.height,
      data: new Uint8ClampedArray(bbox.width * bbox.height * 4).fill(7),
    });
  }
  return { cache, groups };
}

describe("geometryKeyForHealCache", () => {
  it("changes with geometry edits and resolution", () => {
    const edit = { cropRatio: "4/3", rotation: 0, straighten: 0, flipH: false, flipV: false };
    const base = geometryKeyForHealCache("src", edit, 100, 80);
    expect(geometryKeyForHealCache("src", { ...edit, rotation: 90 }, 100, 80)).not.toBe(base);
    expect(geometryKeyForHealCache("src", edit, 200, 80)).not.toBe(base);
    expect(geometryKeyForHealCache("other", edit, 100, 80)).not.toBe(base);
    expect(geometryKeyForHealCache("src", edit, 100, 80)).toBe(base);
  });
});

describe("partitionHealGroups", () => {
  it("returns everything dirty on a cold cache", () => {
    const points = [repair(0.2, 0.2, 0.1, 1), repair(0.7, 0.7, 0.1, 2)];
    const { valid, dirty } = partitionHealGroups(points, new Map(), params(), 100, 80);
    expect(valid).toEqual([]);
    expect(dirty.map((g) => g.id).sort()).toEqual([1, 2]);
  });

  it("hits the cache when nothing changed, so no worker call is needed", () => {
    const points = [repair(0.2, 0.2, 0.1, 1)];
    const { cache } = patch(1, points, 100, 80);
    const { valid, dirty } = partitionHealGroups(points, cache, params(), 100, 80);
    expect(dirty).toEqual([]);
    expect(valid.map((g) => g.id)).toEqual([1]);
  });

  it("only the new group is dirty when a second area is added", () => {
    const first = [repair(0.2, 0.2, 0.08, 1)];
    const { cache } = patch(1, first, 100, 80);
    const both = [...first, repair(0.8, 0.8, 0.08, 2)];
    const { valid, dirty } = partitionHealGroups(both, cache, params(), 100, 80);
    expect(valid.map((g) => g.id)).toEqual([1]);
    expect(dirty.map((g) => g.id)).toEqual([2]);
  });

  it("keeps the cached area valid when a new overlapping stroke is added (never re-heals)", () => {
    const first = [repair(0.3, 0.3, 0.15, 1)];
    const { cache } = patch(1, first, 100, 80);
    const both = [...first, repair(0.34, 0.32, 0.15, 2)];
    const { valid, dirty } = partitionHealGroups(both, cache, params(), 100, 80);
    expect(valid.map((g) => g.id)).toEqual([1]);
    expect(dirty.map((g) => g.id)).toEqual([2]);
  });

  it("keeps saved work across quality/method/feather changes; geometry still busts", () => {
    const points = [repair(0.2, 0.2, 0.1, 1)];
    const { cache } = patch(1, points, 100, 80);
    expect(partitionHealGroups(points, new Map(cache), params({ quality: "best" }), 100, 80).dirty).toHaveLength(0);
    expect(partitionHealGroups(points, new Map(cache), params({ method: "heal" }), 100, 80).dirty).toHaveLength(0);
    expect(partitionHealGroups(points, new Map(cache), params({ featherPx: 8 }), 100, 80).dirty).toHaveLength(0);
    expect(
      partitionHealGroups(points, new Map(cache), params({ geometryKey: "other" }), 100, 80).dirty,
    ).toHaveLength(1);
  });

  it("reuses persisted overlays saved with the legacy method-scoped signature", () => {
    // Persisted overlays carry a separate geometryKey field, so reuse matches
    // by points key and survives the migration; in-memory entries with a stale
    // format simply reheal once.
    const points = [repair(0.2, 0.2, 0.1, 1)];
    const p = params();
    const group = groupRetouchStrokes(points).filter((g) => g.kind === "repair")[0]!;
    const legacySig = `id:1|m:ml-heal|q:balanced|s:0|f:2|g:${p.geometryKey}|p:${pointsKeyForGroup(group)}`;
    const overlay = {
      groupId: 1,
      signature: legacySig,
      x0: 0, y0: 0, width: 2, height: 2,
      geometryKey: p.geometryKey,
      canvasWidth: 100, canvasHeight: 80,
      data: new Uint8ClampedArray(16),
    };
    expect(reusableOverlayForGroup([overlay], group, params({ method: "heal", quality: "best" }))).not.toBeNull();
  });

  it("evicts deleted strokes", () => {
    const points = [repair(0.2, 0.2, 0.1, 1)];
    const { cache } = patch(1, points, 100, 80);
    cache.set(99, { signature: "stale", x0: 0, y0: 0, width: 1, height: 1, data: new Uint8ClampedArray(4) });
    partitionHealGroups(points, cache, params(), 100, 80);
    expect(cache.has(99)).toBe(false);
    expect(cache.has(1)).toBe(true);
  });
});

describe("hashed signatures", () => {
  // A normal interpolated drag is hundreds of stamps; verbatim points blew
  // the server's 4KB signature cap and every PUT failed with 400.
  function longStroke(n: number): RetouchPoint[] {
    return Array.from({ length: n }, (_, i) => repair(0.2 + (i % 50) * 0.001, 0.2 + Math.floor(i / 50) * 0.001, 0.08, 7));
  }

  it("stays far under the server cap for long strokes", () => {
    const points = longStroke(3000);
    const group = groupRetouchStrokes(points).filter((g) => g.kind === "repair")[0]!;
    expect(pointsKeyForGroup(group).length).toBeGreaterThan(4096);
    expect(signatureForHealGroup(group, params()).length).toBeLessThan(300);
  });

  it("round-trips long strokes through persisted overlays", () => {
    const points = longStroke(500);
    const p = params();
    const group = groupRetouchStrokes(points).filter((g) => g.kind === "repair")[0]!;
    const overlay: StoredHealPatch = {
      groupId: group.id,
      signature: signatureForHealGroup(group, p),
      x0: 0, y0: 0, width: 2, height: 2,
      geometryKey: p.geometryKey,
      canvasWidth: 100, canvasHeight: 80,
      data: new Uint8ClampedArray(16),
    };
    expect(reusableOverlayForGroup([overlay], group, params({ method: "heal", quality: "best" }))).not.toBeNull();
  });

  it("distinguishes strokes and normalizes legacy tails to the same hash", () => {
    const a = groupRetouchStrokes([repair(0.2, 0.2, 0.1, 1)]).filter((g) => g.kind === "repair")[0]!;
    const b = groupRetouchStrokes([repair(0.6, 0.6, 0.1, 1)]).filter((g) => g.kind === "repair")[0]!;
    expect(pointsHashForGroup(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(pointsHashForGroup(a)).not.toBe(pointsHashForGroup(b));
    expect(signaturePointsHash(signatureForHealGroup(a, params()))).toBe(pointsHashForGroup(a));
    expect(signaturePointsHash(`id:1|m:ml-heal|q:balanced|s:0|f:2|g:x|p:${pointsKeyForGroup(a)}`)).toBe(
      pointsHashForGroup(a),
    );
  });
});

describe("enforceHealCacheLimit", () => {
  it("evicts oldest first", () => {
    const cache = new Map<number, CachedHealPatch>();
    for (let i = 1; i <= 5; i += 1) {
      cache.set(i, { signature: `${i}`, x0: 0, y0: 0, width: 1, height: 1, data: new Uint8ClampedArray(4) });
    }
    enforceHealCacheLimit(cache, 3);
    expect([...cache.keys()]).toEqual([3, 4, 5]);
  });
});

describe("bboxForMask", () => {
  it("returns null for an empty mask", () => {
    expect(bboxForMask({ width: 4, height: 4, data: new Uint8ClampedArray(16) })).toBeNull();
  });
});

describe("healSingleGroup", () => {
  it("runs the transport once and returns a cropped patch", async () => {
    const source: PixelImage = solidColor(32, 32, 10, 20, 30);
    const group = groupRetouchStrokes([repair(0.5, 0.5, 0.2, 1)]).filter((g) => g.kind === "repair")[0]!;
    const filled: PixelImage = solidColor(32, 32, 200, 10, 10);
    const run = vi.fn().mockResolvedValue(filled);
    const result = await healSingleGroup(source, group, "ml-heal", run, { featherPx: 2 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[3]).toBe("ml-heal");
    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.data.length).toBe(result!.width * result!.height * 4);
    // Cropped patch is smaller than the full frame.
    expect(result!.width * result!.height).toBeLessThan(32 * 32);
  });

  it("returns null for an empty group mask", async () => {
    const source: PixelImage = solidColor(16, 16, 1, 2, 3);
    const group = groupRetouchStrokes([{ x: 5, y: 5, size: 0, strength: 100, kind: "repair", stroke: 1 }]).filter(
      (g) => g.kind === "repair",
    )[0]!;
    const run = vi.fn();
    expect(await healSingleGroup(source, group, "ml-heal", run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("pasteHealPatches", () => {
  it("pastes patches and skips dimension mismatches", () => {
    const base: PixelImage = solidColor(8, 8, 1, 2, 3);
    const patchData = new Uint8ClampedArray([9, 9, 9, 255, 8, 8, 8, 255, 7, 7, 7, 255, 6, 6, 6, 255]);
    const out = pasteHealPatches(base, [
      { signature: "a", x0: 0, y0: 0, width: 2, height: 2, data: patchData },
      { signature: "bad", x0: 7, y0: 7, width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) },
    ]);
    expect(out.data[0]).toBe(9);
    expect(out.data[4]).toBe(8);
    // Untouched pixel passes through.
    expect(out.data[(7 * 8 + 7) * 4]).toBe(1);
    // Inputs are not mutated.
    expect(base.data[0]).toBe(1);
  });
});

describe("reusableOverlayForGroup", () => {
  function stored(points: RetouchPoint[], width: number, height: number, p: HealCacheParams): StoredHealPatch {
    const group = groupRetouchStrokes(points).filter((g) => g.kind === "repair")[0]!;
    const bbox = featheredBboxForGroup(group, width, height, p.featherPx) ?? { x0: 0, y0: 0, width: 1, height: 1 };
    return {
      groupId: group.id,
      signature: signatureForHealGroup(group, p),
      x0: bbox.x0,
      y0: bbox.y0,
      width: bbox.width,
      height: bbox.height,
      geometryKey: p.geometryKey,
      canvasWidth: width,
      canvasHeight: height,
      data: new Uint8ClampedArray(bbox.width * bbox.height * 4),
    };
  }

  it("matches the same strokes at a different resolution (export rescale)", () => {
    const points = [repair(0.2, 0.2, 0.1, 1)];
    const preview = params();
    const overlay = stored(points, 100, 80, preview);
    const group = groupRetouchStrokes(points).filter((g) => g.kind === "repair")[0]!;
    const exportParams = params({ geometryKey: `${geometryPrefixForKey(preview.geometryKey)}|200x160` });
    expect(reusableOverlayForGroup([overlay], group, exportParams)).not.toBeNull();
  });

  it("reuses across method/quality/feather changes; rejects geometry edits and moved strokes", () => {
    const points = [repair(0.2, 0.2, 0.1, 1)];
    const p = params();
    const overlay = stored(points, 100, 80, p);
    const group = groupRetouchStrokes(points).filter((g) => g.kind === "repair")[0]!;
    expect(reusableOverlayForGroup([overlay], group, params({ quality: "best" }))).not.toBeNull();
    expect(reusableOverlayForGroup([overlay], group, params({ method: "heal" }))).not.toBeNull();
    expect(reusableOverlayForGroup([overlay], group, params({ featherPx: 8 }))).not.toBeNull();
    expect(reusableOverlayForGroup([overlay], group, params({ geometryKey: "other|1x1" }))).toBeNull();
    const moved = [repair(0.6, 0.6, 0.1, 1)];
    const movedGroup = groupRetouchStrokes(moved).filter((g) => g.kind === "repair")[0]!;
    expect(reusableOverlayForGroup([overlay], movedGroup, p)).toBeNull();
  });
});

describe("clockwiseStepsForRotation", () => {
  it("maps quarter-turn deltas to 0-3 clockwise steps", () => {
    expect(clockwiseStepsForRotation(0, 90)).toBe(1);
    expect(clockwiseStepsForRotation(0, -90)).toBe(3);
    expect(clockwiseStepsForRotation(0, 180)).toBe(2);
    expect(clockwiseStepsForRotation(-90, -180)).toBe(3);
    expect(clockwiseStepsForRotation(90, 90)).toBe(0);
  });

  it("returns null when the delta is not a quarter turn", () => {
    expect(clockwiseStepsForRotation(0, 45)).toBeNull();
    expect(clockwiseStepsForRotation(0, Number.NaN)).toBeNull();
  });
});

describe("rotateHealPatch", () => {
  // 2x3 patch with distinct red values per pixel (row-major 1..6).
  function labeledPatch(x0 = 1, y0 = 2): CachedHealPatch {
    const data = new Uint8ClampedArray(2 * 3 * 4);
    for (let i = 0; i < 6; i += 1) {
      data[i * 4] = i + 1;
      data[i * 4 + 1] = 10;
      data[i * 4 + 2] = 20;
      data[i * 4 + 3] = 255;
    }
    return { signature: "sig", x0, y0, width: 2, height: 3, data };
  }

  function reds(patch: CachedHealPatch): number[] {
    const out: number[] = [];
    for (let i = 0; i < patch.data.length; i += 4) out.push(patch.data[i] ?? -1);
    return out;
  }

  it("turns bbox and pixels clockwise and round-trips back", () => {
    const patch = labeledPatch(1, 2);
    const turned = rotateHealPatch(patch, 10, 8, 8, 10, 1)!;
    expect(turned).not.toBeNull();
    expect([turned.x0, turned.y0, turned.width, turned.height]).toEqual([8 - 2 - 3, 1, 3, 2]);
    // CW: old columns become rows reversed.
    expect(reds(turned)).toEqual([5, 3, 1, 6, 4, 2]);
    const back = rotateHealPatch(turned, 8, 10, 10, 8, 3)!;
    expect([back.x0, back.y0, back.width, back.height]).toEqual([1, 2, 2, 3]);
    expect(reds(back)).toEqual([1, 2, 3, 4, 5, 6]);
    // Input untouched.
    expect(reds(patch)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("turns counter-clockwise for rotate left", () => {
    const turned = rotateHealPatch(labeledPatch(1, 2), 10, 8, 8, 10, 3)!;
    expect([turned.x0, turned.y0, turned.width, turned.height]).toEqual([2, 10 - 1 - 2, 3, 2]);
    expect(reds(turned)).toEqual([2, 4, 6, 1, 3, 5]);
  });

  it("turns 180 degrees in place", () => {
    const turned = rotateHealPatch(labeledPatch(1, 2), 10, 8, 10, 8, 2)!;
    expect([turned.x0, turned.y0, turned.width, turned.height]).toEqual([10 - 1 - 2, 8 - 2 - 3, 2, 3]);
    expect(reds(turned)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("returns null for crop-window changes, bad dims, and corrupt patches", () => {
    const patch = labeledPatch();
    // Same dims on a 90-degree turn means the crop window changed: reheal.
    expect(rotateHealPatch(patch, 10, 8, 10, 8, 1)).toBeNull();
    // Swapped dims on a 180-degree turn: reheal.
    expect(rotateHealPatch(patch, 10, 8, 8, 10, 2)).toBeNull();
    expect(rotateHealPatch(patch, 10, 8, 8, 10, 1.5 as unknown as number)).toBeNull();
    const outside = labeledPatch(9, 7);
    expect(rotateHealPatch(outside, 10, 8, 8, 10, 1)).toBeNull();
    const corrupt = { ...labeledPatch(), data: new Uint8ClampedArray(4) };
    expect(rotateHealPatch(corrupt, 10, 8, 8, 10, 1)).toBeNull();
  });

  it("keeps a healed group cache-valid across heal-then-rotate (no rerun)", () => {
    const oldPoints = [repair(0.2, 0.3, 0.1, 1)];
    const oldEdit = { cropRatio: "Original", rotation: 0, straighten: 0, flipH: false, flipV: false };
    const oldParams = params({ geometryKey: geometryKeyForHealCache("src", oldEdit, 120, 80) });
    const oldGroup = groupRetouchStrokes(oldPoints).filter((g) => g.kind === "repair")[0]!;
    const bbox = featheredBboxForGroup(oldGroup, 120, 80, oldParams.featherPx)!;
    const cache = new Map<number, CachedHealPatch>([
      [1, { signature: signatureForHealGroup(oldGroup, oldParams), x0: bbox.x0, y0: bbox.y0, width: bbox.width, height: bbox.height, data: new Uint8ClampedArray(bbox.width * bbox.height * 4).fill(9) }],
    ]);

    const newPoints = rotateRetouches(oldPoints, { fromRotation: 0, toRotation: 90, cropRatio: null, sourceAspect: 1.5 });
    const newEdit = { ...oldEdit, rotation: 90 };
    const newParams = params({ geometryKey: geometryKeyForHealCache("src", newEdit, 80, 120) });
    const newGroup = groupRetouchStrokes(newPoints).filter((g) => g.kind === "repair")[0]!;
    const steps = clockwiseStepsForRotation(0, 90)!;
    const rotated = rotateHealPatch(cache.get(1)!, 120, 80, 80, 120, steps)!;
    rotated.signature = signatureForHealGroup(newGroup, newParams);
    cache.set(1, rotated);

    const { valid, dirty } = partitionHealGroups(newPoints, cache, newParams, 80, 120);
    expect(dirty).toEqual([]);
    expect(valid.map((g) => g.id)).toEqual([1]);
  });
});
