import { describe, expect, it, vi } from "vitest";
import type { PixelImage } from "./analyze.js";
import { solidColor } from "./fixtures.js";
import {
  bboxForMask,
  enforceHealCacheLimit,
  featheredBboxForGroup,
  geometryKeyForHealCache,
  geometryPrefixForKey,
  healSingleGroup,
  pasteHealPatches,
  partitionHealGroups,
  reusableOverlayForGroup,
  signatureForHealGroup,
  type CachedHealPatch,
  type HealCacheParams,
  type StoredHealPatch,
} from "./heal-cache.js";
import { groupRetouchStrokes } from "../retouch.js";
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

  it("reuses persisted overlays saved with the legacy method-scoped signature", async () => {
    // Persisted overlays carry a separate geometryKey field, so reuse matches
    // by points key and survives the migration; in-memory entries with a stale
    // format simply reheal once.
    const { reusableOverlayForGroup } = await import("./heal-cache.js");
    const { groupRetouchStrokes } = await import("../retouch.js");
    const points = [repair(0.2, 0.2, 0.1, 1)];
    const p = params();
    const group = groupRetouchStrokes(points).filter((g) => g.kind === "repair")[0]!;
    const legacySig = `id:1|m:ml-heal|q:balanced|s:0|f:2|g:${p.geometryKey}|p:${points.map(() => "0.200000,0.200000,0.100000,100.000000").join(";")}`;
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
