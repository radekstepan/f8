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
  HEAL_RESAMPLE_DEG_BUDGET,
  healSingleGroup,
  pasteHealPatches,
  partitionHealGroups,
  pointsHashForGroup,
  pointsKeyForGroup,
  resampleHealPatchForStraighten,
  reusableOverlayForGroup,
  rotateHealPatch,
  signatureForHealGroup,
  signaturePointsHash,
  straightenResampleAllowed,
  type CachedHealPatch,
  type HealCacheParams,
  type StoredHealPatch,
} from "./heal-cache.js";
import { groupRetouchStrokes, remapRetouchesForStraighten, rotateRetouches } from "../retouch.js";
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
      resampleDeg: 0,
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
      resampleDeg: 0,
    };
    expect(reusableOverlayForGroup([overlay], group, params({ method: "heal", quality: "best" }))).not.toBeNull();
  });

  it("evicts deleted strokes", () => {
    const points = [repair(0.2, 0.2, 0.1, 1)];
    const { cache } = patch(1, points, 100, 80);
    cache.set(99, { signature: "stale", x0: 0, y0: 0, width: 1, height: 1, data: new Uint8ClampedArray(4), resampleDeg: 0 });
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
      resampleDeg: 0,
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
      cache.set(i, { signature: `${i}`, x0: 0, y0: 0, width: 1, height: 1, data: new Uint8ClampedArray(4), resampleDeg: 0 });
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
      { signature: "a", x0: 0, y0: 0, width: 2, height: 2, data: patchData, resampleDeg: 0 },
      { signature: "bad", x0: 7, y0: 7, width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4), resampleDeg: 0 },
    ]);
    expect(out.data[0]).toBe(9);
    expect(out.data[4]).toBe(8);
    // Untouched pixel passes through.
    expect(out.data[(7 * 8 + 7) * 4]).toBe(1);
    // Inputs are not mutated.
    expect(base.data[0]).toBe(1);
  });

  it("clips overhanging patches to the visible intersection", () => {
    const base: PixelImage = solidColor(8, 8, 1, 2, 3);
    // Opaque 4x4 patch hanging off the top-left: only its bottom-right 2x2
    // (patch-local x 2..3, y 2..3) lands on base pixels (0..1, 0..1).
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i += 1) {
      data[i * 4] = 100 + i;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }
    const out = pasteHealPatches(base, [
      { signature: "a", x0: -2, y0: -2, width: 4, height: 4, data, resampleDeg: 0 },
      // Fully outside: pastes nothing, never throws, never corrupts.
      { signature: "b", x0: 20, y0: 20, width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4).fill(200), resampleDeg: 0 },
    ]);
    expect(out.data[0]).toBe(100 + 2 * 4 + 2);
    expect(out.data[4]).toBe(100 + 2 * 4 + 3);
    expect(out.data[8 * 4]).toBe(100 + 3 * 4 + 2);
    expect(out.data[8 * 4 + 4]).toBe(100 + 3 * 4 + 3);
    // Just outside the intersection the base shows through untouched.
    expect(out.data[8]).toBe(1);
    expect(out.data[(7 * 8 + 7) * 4]).toBe(1);
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
      resampleDeg: 0,
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
    return { signature: "sig", x0, y0, width: 2, height: 3, data, resampleDeg: 0 };
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
    const corrupt = { ...labeledPatch(), data: new Uint8ClampedArray(4) };
    expect(rotateHealPatch(corrupt, 10, 8, 8, 10, 1)).toBeNull();
  });

  it("carries overhanging patches through quarter turns", () => {
    // Carried off-canvas pixels (from a straighten swing) turn with the
    // rest instead of forcing a reheal: same permutation, overhang intact.
    const turned = rotateHealPatch(labeledPatch(9, 7), 10, 8, 8, 10, 1)!;
    expect(turned).not.toBeNull();
    expect([turned.x0, turned.y0, turned.width, turned.height]).toEqual([8 - 7 - 3, 9, 3, 2]);
    expect(turned.x0).toBeLessThan(0);
    expect(turned.y0 + turned.height).toBeGreaterThan(10);
    expect(reds(turned)).toEqual([5, 3, 1, 6, 4, 2]);
  });

  it("keeps a healed group cache-valid across heal-then-rotate (no rerun)", () => {
    const oldPoints = [repair(0.2, 0.3, 0.1, 1)];
    const oldEdit = { cropRatio: "Original", rotation: 0, straighten: 0, flipH: false, flipV: false };
    const oldParams = params({ geometryKey: geometryKeyForHealCache("src", oldEdit, 120, 80) });
    const oldGroup = groupRetouchStrokes(oldPoints).filter((g) => g.kind === "repair")[0]!;
    const bbox = featheredBboxForGroup(oldGroup, 120, 80, oldParams.featherPx)!;
    const cache = new Map<number, CachedHealPatch>([
      [1, { signature: signatureForHealGroup(oldGroup, oldParams), x0: bbox.x0, y0: bbox.y0, width: bbox.width, height: bbox.height, data: new Uint8ClampedArray(bbox.width * bbox.height * 4).fill(9), resampleDeg: 0 }],
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

describe("straightenResampleAllowed", () => {
  it("allows resamples within the budget and rejects past it", () => {
    expect(straightenResampleAllowed(0, 10)).toBe(true);
    expect(straightenResampleAllowed(40, 5)).toBe(true);
    expect(straightenResampleAllowed(40, 5.1)).toBe(false);
    expect(straightenResampleAllowed(HEAL_RESAMPLE_DEG_BUDGET, 0.1)).toBe(false);
    expect(straightenResampleAllowed(-1, 5)).toBe(false);
    expect(straightenResampleAllowed(0, Number.NaN)).toBe(false);
    expect(straightenResampleAllowed(Number.NaN, 5)).toBe(false);
  });
});

describe("resampleHealPatchForStraighten", () => {
  function flatPatch(x0: number, y0: number, w: number, h: number, v = 9): CachedHealPatch {
    return {
      signature: "sig", x0, y0, width: w, height: h,
      data: new Uint8ClampedArray(w * h * 4).fill(v),
      resampleDeg: 0,
    };
  }

  it("returns an exact copy for a zero delta", () => {
    const patch = flatPatch(10, 10, 8, 6, 42);
    const out = resampleHealPatchForStraighten(patch, 100, 80, { fromStraighten: 3, toStraighten: 3, sourceAspect: 1.5 })!;
    expect(out).not.toBeNull();
    expect([out.x0, out.y0, out.width, out.height]).toEqual([10, 10, 8, 6]);
    expect(out.data).toEqual(patch.data);
    expect(out.resampleDeg).toBe(0);
    expect(out.data).not.toBe(patch.data);
  });

  it("keeps flat colors flat and accumulates the resample budget", () => {
    const patch = flatPatch(30, 30, 12, 12, 77);
    const out = resampleHealPatchForStraighten(patch, 100, 100, { fromStraighten: 0, toStraighten: 10, sourceAspect: 1 })!;
    expect(out).not.toBeNull();
    expect(out.resampleDeg).toBeCloseTo(10, 9);
    // RGB stays flat; alpha is the validity mask (uniform 77 resamples to
    // 77 inside the rotated rect, 0 past it — never smeared opaque).
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(77);
      expect(out.data[i + 1]).toBe(77);
      expect(out.data[i + 2]).toBe(77);
      expect(out.data[i + 3] === 0 || out.data[i + 3] === 77).toBe(true);
    }
    const centerAlpha = (p: CachedHealPatch): number =>
      p.data[(Math.floor(p.height / 2) * p.width + Math.floor(p.width / 2)) * 4 + 3] ?? -1;
    expect(centerAlpha(out)).toBe(77);
    const back = resampleHealPatchForStraighten(out, 100, 100, { fromStraighten: 10, toStraighten: 0, sourceAspect: 1 })!;
    expect(back.resampleDeg).toBeCloseTo(20, 9);
    for (let i = 0; i < back.data.length; i += 4) {
      expect(back.data[i]).toBe(77);
      expect(back.data[i + 1]).toBe(77);
      expect(back.data[i + 2]).toBe(77);
    }
    expect(centerAlpha(back)).toBe(77);
  });

  it("moves the patch bbox with the content turn", () => {
    // 100x100 canvas, patch right of center: a clockwise (+10deg) turn
    // swings it downward. The AABB center tracks the transformed rect
    // center to within a pixel (floor/ceil rounding only).
    const patch = flatPatch(60, 45, 10, 10);
    const out = resampleHealPatchForStraighten(patch, 100, 100, { fromStraighten: 0, toStraighten: 10, sourceAspect: 1 })!;
    expect(out).not.toBeNull();
    const k2 = 1 + Math.sin((10 * Math.PI) / 180);
    const theta = (10 * Math.PI) / 180;
    const dx = 65 - 50;
    const dy = 50 - 50;
    const ex = 50 + (dx * Math.cos(theta) - dy * Math.sin(theta)) * k2;
    const ey = 50 + (dx * Math.sin(theta) + dy * Math.cos(theta)) * k2;
    expect(ex).toBeGreaterThan(65);
    expect(ey).toBeGreaterThan(50);
    expect(Math.abs(out.x0 + out.width / 2 - ex)).toBeLessThan(1);
    expect(Math.abs(out.y0 + out.height / 2 - ey)).toBeLessThan(1);
  });

  it("carries overhang instead of nulling on clip; still nulls corrupt inputs", () => {
    // A flush-corner patch swung partly out of the canvas keeps its
    // off-canvas pixels (carried for the reverse turn) instead of forcing
    // a reheal that would lose them.
    const corner = flatPatch(0, 0, 20, 20);
    const swung = resampleHealPatchForStraighten(corner, 100, 100, { fromStraighten: 0, toStraighten: 15, sourceAspect: 1 })!;
    expect(swung).not.toBeNull();
    expect(swung.y0).toBeLessThan(0);
    expect(swung.data.length).toBe(swung.width * swung.height * 4);
    // An already-overhanging source resamples fine (validity is patch-local).
    const outside = flatPatch(95, 95, 10, 10);
    expect(resampleHealPatchForStraighten(outside, 100, 100, { fromStraighten: 0, toStraighten: 5, sourceAspect: 1 })).not.toBeNull();
    const nearCorner = flatPatch(5, 5, 20, 20);
    expect(resampleHealPatchForStraighten(nearCorner, 100, 100, { fromStraighten: 0, toStraighten: 1, sourceAspect: 1 })).not.toBeNull();
    const ok = flatPatch(30, 30, 10, 10);
    expect(resampleHealPatchForStraighten(ok, 100, 100, { fromStraighten: 0, toStraighten: 5 })).toBeNull();
    expect(resampleHealPatchForStraighten(ok, 100, 100, { fromStraighten: 0, toStraighten: 5, sourceAspect: Number.NaN })).toBeNull();
    expect(resampleHealPatchForStraighten(ok, 100, 100, { fromStraighten: Number.NaN, toStraighten: 5, sourceAspect: 1 })).toBeNull();
    expect(resampleHealPatchForStraighten({ ...ok, data: new Uint8ClampedArray(4) }, 100, 100, { fromStraighten: 0, toStraighten: 5, sourceAspect: 1 })).toBeNull();
    expect(resampleHealPatchForStraighten({ ...ok, resampleDeg: -1 }, 100, 100, { fromStraighten: 0, toStraighten: 5, sourceAspect: 1 })).toBeNull();
  });

  it("keeps a healed group cache-valid across a straighten tweak (no rerun)", () => {
    const oldPoints = [repair(0.4, 0.4, 0.1, 1)];
    const oldEdit = { cropRatio: "Original", rotation: 0, straighten: 0, flipH: false, flipV: false };
    const oldParams = params({ geometryKey: geometryKeyForHealCache("src", oldEdit, 120, 120) });
    const oldGroup = groupRetouchStrokes(oldPoints).filter((g) => g.kind === "repair")[0]!;
    const bbox = featheredBboxForGroup(oldGroup, 120, 120, oldParams.featherPx)!;
    const cache = new Map<number, CachedHealPatch>([
      [1, { signature: signatureForHealGroup(oldGroup, oldParams), x0: bbox.x0, y0: bbox.y0, width: bbox.width, height: bbox.height, data: new Uint8ClampedArray(bbox.width * bbox.height * 4).fill(9), resampleDeg: 0 }],
    ]);

    const newPoints = remapRetouchesForStraighten(oldPoints, { fromStraighten: 0, toStraighten: 6, rotation: 0, cropRatio: null, sourceAspect: 1 });
    const newEdit = { ...oldEdit, straighten: 6 };
    const newParams = params({ geometryKey: geometryKeyForHealCache("src", newEdit, 120, 120) });
    const newGroup = groupRetouchStrokes(newPoints).filter((g) => g.kind === "repair")[0]!;
    const resampled = resampleHealPatchForStraighten(cache.get(1)!, 120, 120, { fromStraighten: 0, toStraighten: 6, sourceAspect: 1 })!;
    resampled.signature = signatureForHealGroup(newGroup, newParams);
    cache.set(1, resampled);

    const { valid, dirty } = partitionHealGroups(newPoints, cache, newParams, 120, 120);
    expect(dirty).toEqual([]);
    expect(valid.map((g) => g.id)).toEqual([1]);
  });
});

describe("heal patch placement vs canvas geometry", () => {
  // Operational model of geometryCanvas's transform stack. The test composes
  // translate/rotate/scale matrices in ctx call order (documented canvas
  // semantics: transforms post-multiply, rotate(a,b,c,d) = (cos,sin,-sin,cos))
  // and maps old-canvas pixels to new-canvas pixels through M_new * M_old^-1.
  // The implementation under test uses closed-form per-corner maps instead,
  // so agreement rules out a systematic convention error (rotation sign,
  // center, zoom direction, swapped dims) that same-formula tests would miss.
  type Mat = [number, number, number, number, number, number];
  const mul = (m: Mat, n: Mat): Mat => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const translate = (tx: number, ty: number): Mat => [1, 0, 0, 1, tx, ty];
  const rotateDeg = (deg: number): Mat => {
    const t = (deg * Math.PI) / 180;
    return [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0];
  };
  const scale = (k: number): Mat => [k, 0, 0, k, 0, 0];
  const apply = (m: Mat, x: number, y: number): [number, number] => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const invert = (m: Mat): Mat => {
    const det = m[0] * m[3] - m[1] * m[2];
    const a = m[3] / det;
    const b = -m[1] / det;
    const c = -m[2] / det;
    const d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  };
  const zoomFor = (straighten: number, aspect: number): number =>
    1 + Math.abs(Math.sin((straighten * Math.PI) / 180)) * Math.max(aspect, 1 / aspect);

  interface Geo {
    w: number;
    h: number;
    rot: number;
    str: number;
  }

  // Content map old-canvas -> new-canvas for an Original-crop geometry
  // change (no flips: flips force a reheal, never a patch transform).
  function contentMap(oldGeo: Geo, newGeo: Geo, aspect: number): (px: number, py: number) => [number, number] {
    const mOld = mul(
      translate(oldGeo.w / 2, oldGeo.h / 2),
      mul(rotateDeg(oldGeo.rot + oldGeo.str), scale(zoomFor(oldGeo.str, aspect))),
    );
    const mNew = mul(
      translate(newGeo.w / 2, newGeo.h / 2),
      mul(rotateDeg(newGeo.rot + newGeo.str), scale(zoomFor(newGeo.str, aspect))),
    );
    const m = mul(mNew, invert(mOld));
    return (px, py) => apply(m, px, py);
  }

  function labeledPatch(x0: number, y0: number, w: number, h: number): CachedHealPatch {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      data[i * 4] = (i + 1) % 251;
      data[i * 4 + 1] = 10;
      data[i * 4 + 2] = 20;
      data[i * 4 + 3] = 255;
    }
    return { signature: "sig", x0, y0, width: w, height: h, data, resampleDeg: 0 };
  }

  it("moves every quarter-turn patch pixel where the canvas stack sends it", () => {
    // Lossless turns: each labeled pixel must land exactly on the
    // matrix-predicted new pixel, and the bbox must bound the mapped rect.
    const cases: { from: number; to: number; oldW: number; oldH: number; newW: number; newH: number }[] = [
      { from: 0, to: 90, oldW: 120, oldH: 80, newW: 80, newH: 120 },
      { from: 0, to: -90, oldW: 120, oldH: 80, newW: 80, newH: 120 },
      { from: 0, to: 180, oldW: 120, oldH: 80, newW: 120, newH: 80 },
      { from: 90, to: 180, oldW: 80, oldH: 120, newW: 120, newH: 80 },
      { from: -90, to: -180, oldW: 80, oldH: 120, newW: 120, newH: 80 },
    ];
    for (const { from, to, oldW, oldH, newW, newH } of cases) {
      const steps = clockwiseStepsForRotation(from, to)!;
      expect(steps).not.toBeNull();
      const patch = labeledPatch(7, 5, 9, 6);
      const turned = rotateHealPatch(patch, oldW, oldH, newW, newH, steps)!;
      expect(turned).not.toBeNull();
      const fwd = contentMap({ w: oldW, h: oldH, rot: from, str: 0 }, { w: newW, h: newH, rot: to, str: 0 }, 1.5);
      // Bbox bounds the mapped rect corners exactly (axis-aligned result).
      const corners: [number, number][] = [
        [patch.x0, patch.y0],
        [patch.x0 + patch.width, patch.y0],
        [patch.x0, patch.y0 + patch.height],
        [patch.x0 + patch.width, patch.y0 + patch.height],
      ];
      const mapped = corners.map(([x, y]) => fwd(x, y));
      const cornersX = mapped.map(([x]) => x as number);
      const cornersY = mapped.map(([, y]) => y as number);
      expect(Math.min(...cornersX)).toBeCloseTo(turned.x0, 9);
      expect(Math.min(...cornersY)).toBeCloseTo(turned.y0, 9);
      expect(Math.max(...cornersX)).toBeCloseTo(turned.x0 + turned.width, 9);
      expect(Math.max(...cornersY)).toBeCloseTo(turned.y0 + turned.height, 9);
      // Every pixel center lands on its labeled value.
      for (let y = 0; y < patch.height; y += 1) {
        for (let x = 0; x < patch.width; x += 1) {
          const [qx, qy] = fwd(patch.x0 + x + 0.5, patch.y0 + y + 0.5);
          const dx = Math.floor(qx) - turned.x0;
          const dy = Math.floor(qy) - turned.y0;
          const expected = patch.data[(y * patch.width + x) * 4];
          const actual = turned.data[(dy * turned.width + dx) * 4];
          expect(actual).toBe(expected);
        }
      }
    }
  });

  it("places straighten resamples where the canvas stack sends the rect", () => {
    // The resampled bbox must track the matrix-mapped quad's AABB within
    // rounding, on wide/square/tall canvases and both turn directions.
    const configs = [
      { w: 120, h: 80, aspect: 1.5, from: 0, to: 5 },
      { w: 120, h: 80, aspect: 1.5, from: 0, to: -8 },
      { w: 100, h: 100, aspect: 1, from: 0, to: 10 },
      { w: 80, h: 120, aspect: 2 / 3, from: -4, to: 6 },
      { w: 120, h: 80, aspect: 1.5, from: 5, to: -5 },
    ];
    for (const { w, h, aspect, from, to } of configs) {
      const patch = labeledPatch(45, 30, 20, 14);
      const out = resampleHealPatchForStraighten(patch, w, h, { fromStraighten: from, toStraighten: to, sourceAspect: aspect })!;
      expect(out).not.toBeNull();
      const fwd = contentMap({ w, h, rot: 0, str: from }, { w, h, rot: 0, str: to }, aspect);
      const corners: [number, number][] = [
        [patch.x0, patch.y0],
        [patch.x0 + patch.width, patch.y0],
        [patch.x0, patch.y0 + patch.height],
        [patch.x0 + patch.width, patch.y0 + patch.height],
      ];
      const mapped = corners.map(([x, y]) => fwd(x, y));
      const minX = Math.min(...mapped.map(([x]) => x as number));
      const maxX = Math.max(...mapped.map(([x]) => x as number));
      const minY = Math.min(...mapped.map(([, y]) => y as number));
      const maxY = Math.max(...mapped.map(([, y]) => y as number));
      expect(Math.abs(out.x0 - minX)).toBeLessThan(1.5);
      expect(Math.abs(out.y0 - minY)).toBeLessThan(1.5);
      expect(Math.abs(out.x0 + out.width - maxX)).toBeLessThan(1.5);
      expect(Math.abs(out.y0 + out.height - maxY)).toBeLessThan(1.5);
    }
  });

  it("keeps remapped stamps on the resampled valid region", () => {
    // Cross-check between the two straighten implementations: a stamp at the
    // patch center, remapped by retouch.ts, must land on the resampled
    // patch's valid pixels (measured from the alpha mask, falling back to
    // the bbox center while outputs are fully opaque).
    const stampAtCenter = (x0: number, y0: number, w: number, h: number, canvasW: number, canvasH: number): RetouchPoint =>
      repair((x0 + w / 2) / canvasW, (y0 + h / 2) / canvasH, 0.05, 1);
    for (const { w, h, aspect, from, to } of [
      { w: 120, h: 80, aspect: 1.5, from: 0, to: 5 },
      { w: 100, h: 100, aspect: 1, from: 0, to: -10 },
      { w: 80, h: 120, aspect: 2 / 3, from: 3, to: -7 },
    ]) {
      const patch = labeledPatch(45, 30, 20, 14);
      const out = resampleHealPatchForStraighten(patch, w, h, { fromStraighten: from, toStraighten: to, sourceAspect: aspect })!;
      expect(out).not.toBeNull();
      let ax = 0;
      let ay = 0;
      let an = 0;
      for (let y = 0; y < out.height; y += 1) {
        for (let x = 0; x < out.width; x += 1) {
          if ((out.data[(y * out.width + x) * 4 + 3] ?? 0) > 128) {
            ax += x;
            ay += y;
            an += 1;
          }
        }
      }
      const cx = an > 0 ? out.x0 + ax / an : out.x0 + out.width / 2;
      const cy = an > 0 ? out.y0 + ay / an : out.y0 + out.height / 2;
      const [moved] = remapRetouchesForStraighten(
        [stampAtCenter(patch.x0, patch.y0, patch.width, patch.height, w, h)],
        { fromStraighten: from, toStraighten: to, rotation: 0, cropRatio: null, sourceAspect: aspect },
      );
      expect(Math.hypot(moved!.x * w - cx, moved!.y * h - cy)).toBeLessThan(2);
    }
  });
});

describe("straighten resample validity mask", () => {
  function opaquePatch(x0: number, y0: number, w: number, h: number): CachedHealPatch {
    // Distinct interior vs rim so edge smear is observable in RGB.
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const rim = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const i = (y * w + x) * 4;
        data[i] = rim ? 200 : 50;
        data[i + 1] = rim ? 201 : 51;
        data[i + 2] = rim ? 202 : 52;
        data[i + 3] = 255;
      }
    }
    return { signature: "sig", x0, y0, width: w, height: h, data, resampleDeg: 0 };
  }

  it("marks AABB corners outside the rotated rect transparent instead of smearing", () => {
    const out = resampleHealPatchForStraighten(opaquePatch(40, 40, 20, 20), 100, 100, {
      fromStraighten: 0,
      toStraighten: 10,
      sourceAspect: 1,
    })!;
    expect(out).not.toBeNull();
    const alpha = (x: number, y: number): number => out.data[(y * out.width + x) * 4 + 3] ?? -1;
    // Tight-bbox corners sit outside the rotated quad: transparent, so the
    // paste leaves the clean base alone instead of stamping smeared edges.
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(out.width - 1, 0)).toBe(0);
    expect(alpha(0, out.height - 1)).toBe(0);
    expect(alpha(out.width - 1, out.height - 1)).toBe(0);
    // The healed interior stays fully opaque.
    expect(alpha(Math.floor(out.width / 2), Math.floor(out.height / 2))).toBe(255);
    // No all-transparent margin rows/cols: the bbox is tightened to the
    // valid region every step, so progressive drags cannot ratchet outward.
    for (const [edge, isRow] of [["top", true], ["bottom", true], ["left", false], ["right", false]] as const) {
      let seen = false;
      if (isRow) {
        const y = edge === "top" ? 0 : out.height - 1;
        for (let x = 0; x < out.width; x += 1) if (alpha(x, y) > 0) seen = true;
      } else {
        const x = edge === "left" ? 0 : out.width - 1;
        for (let y = 0; y < out.height; y += 1) if (alpha(x, y) > 0) seen = true;
      }
      expect(seen).toBe(true);
    }
  });

  it("reproduces the direct hop when resampled from a fixed anchor with the total delta", () => {
    // Anchor protocol for slider drags: the caller keeps the pre-drag patch
    // fixed and single-hops from it with the total angle each tick (never
    // chains tick-to-tick: integer bboxes forget sub-pixel growth every hop,
    // so a naive chain would freeze while the content turns). Every tick
    // must equal the direct resample to that angle, exactly.
    const anchor = opaquePatch(30, 35, 40, 30);
    let tick75: CachedHealPatch | null = null;
    let tick150: CachedHealPatch | null = null;
    for (let i = 1; i <= 150; i += 1) {
      const tick = resampleHealPatchForStraighten(anchor, 100, 100, {
        fromStraighten: 0,
        toStraighten: i * 0.1,
        sourceAspect: 1,
      })!;
      expect(tick).not.toBeNull();
      if (i === 75) tick75 = tick;
      if (i === 150) tick150 = tick;
    }
    const direct75 = resampleHealPatchForStraighten(anchor, 100, 100, { fromStraighten: 0, toStraighten: 75 * 0.1, sourceAspect: 1 })!;
    const direct150 = resampleHealPatchForStraighten(anchor, 100, 100, { fromStraighten: 0, toStraighten: 150 * 0.1, sourceAspect: 1 })!;
    for (const [tick, direct] of [[tick75, direct75], [tick150, direct150]] as const) {
      expect([tick!.x0, tick!.y0, tick!.width, tick!.height]).toEqual([direct.x0, direct.y0, direct.width, direct.height]);
      expect(tick!.data).toEqual(direct.data);
      expect(tick!.resampleDeg).toBe(direct.resampleDeg);
    }
    // The content zoom is visible mid-drag and grows monotonically: the
    // anchor protocol tracks the turn instead of quantizing to a standstill.
    expect(tick75!.width).toBeGreaterThan(anchor.width);
    expect(tick150!.width).toBeGreaterThanOrEqual(tick75!.width);
    expect(tick150!.height).toBeGreaterThanOrEqual(tick75!.height);
  });

  it("swings a clipped repair back intact on the reverse turn (no hard cut)", () => {
    // The edge-repair flow: a flush-edge patch swings partly off-canvas
    // (carried, never nulled), the paste clips to the visible part, and
    // the reverse hop restores the original region and content instead of
    // stamping a clipped patch back over the blemish with a hard edge.
    const start = opaquePatch(80, 40, 20, 20);
    const out = resampleHealPatchForStraighten(start, 100, 100, { fromStraighten: 0, toStraighten: 8, sourceAspect: 1 })!;
    expect(out).not.toBeNull();
    expect(out.x0 + out.width).toBeGreaterThan(100);
    const base: PixelImage = solidColor(100, 100, 1, 2, 3);
    const pasted = pasteHealPatches(base, [out]);
    // A visible interior pixel took healed content (opaque interior 50/51/52).
    const cx = Math.floor(out.x0 + out.width / 2);
    const cy = Math.floor(out.y0 + out.height / 2);
    expect(cx).toBeLessThan(100);
    const at = (pasted.data[(cy * 100 + cx) * 4] ?? -1);
    expect(at).toBe(50);
    // The reverse hop restores the original bbox (each hop quantizes ~1px
    // per edge, so two hops stay within 2) with identical flat content.
    const back = resampleHealPatchForStraighten(out, 100, 100, { fromStraighten: 8, toStraighten: 0, sourceAspect: 1 })!;
    expect(back).not.toBeNull();
    expect(Math.abs(back.x0 - start.x0)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.y0 - start.y0)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.width - start.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.height - start.height)).toBeLessThanOrEqual(2);
    const bcx = Math.floor(back.width / 2);
    const bcy = Math.floor(back.height / 2);
    expect(back.data[(bcy * back.width + bcx) * 4]).toBe(50);
    expect(back.data[(bcy * back.width + bcx) * 4 + 3]).toBe(255);
  });
});

describe("pasteHealPatches alpha", () => {
  it("skips transparent pixels and blends partial alpha over the base", () => {
    const base: PixelImage = solidColor(8, 8, 1, 2, 3);
    const data = new Uint8ClampedArray([
      200, 0, 0, 255, 99, 99, 99, 0,
      100, 100, 100, 128, 201, 0, 0, 255,
    ]);
    const out = pasteHealPatches(base, [
      { signature: "a", x0: 0, y0: 0, width: 2, height: 2, data, resampleDeg: 0 },
    ]);
    // Opaque pixels paste verbatim (patch (0,0) and (1,1) land on the
    // 8-wide base at flat indices 0 and 36).
    expect([out.data[0], out.data[1], out.data[2], out.data[3]]).toEqual([200, 0, 0, 255]);
    expect([out.data[36], out.data[37], out.data[38], out.data[39]]).toEqual([201, 0, 0, 255]);
    // Transparent pixels leave the clean base untouched.
    expect([out.data[4], out.data[5], out.data[6], out.data[7]]).toEqual([1, 2, 3, 255]);
    // Partial alpha blends source-over (128/255 ~= 0.5): patch (0,1) lands
    // at flat index 32.
    expect(out.data[32]).toBeGreaterThanOrEqual(48);
    expect(out.data[32]).toBeLessThanOrEqual(54);
    expect(out.data[35]).toBe(255);
    expect(base.data[4]).toBe(1);
  });
});
