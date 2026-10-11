// Incremental ml-heal cache: per-stroke-group healed patches.
//
// Full-pass healing re-runs every area when any stroke changes. ML models are
// expensive (Moebius ~1.3GB, 19 diffusion steps), so the preview keeps one
// cached patch per repair stroke group and only (re)heals new, changed, or
// overlapping groups. Classic heal / Telea / NS keep the single full-pass
// path: exemplar fill is cheap and already splits into components internally.
//
// A patch is the final blended RGBA cropped to the feathered mask bbox of
// its group, composited over the clean (repair-free) base. Dirty groups must
// always run against the clean base — never over other patches — so
// non-overlapping results match a joint run. Groups whose feathered bboxes
// intersect a dirty group's bbox are re-healed together (union).

import type { RetouchPoint } from "../types.js";
import { groupRetouchStrokes, type RetouchStrokeGroup } from "../retouch.js";
import type { PixelImage } from "./analyze.js";
import type { HealQuality } from "./heal.js";
import {
  blendInpainted,
  featherRepairMask,
  inpaintRadiusForStrokes,
  rasterizeRepairMask,
  resolveFeatherPx,
  type InpaintMethod,
  type RepairMask,
} from "./inpaint.js";
import type { RunInpaint, RunInpaintOptions } from "../image.js";

/** Upper bound for cached areas; oldest entries are evicted first. */
export const HEAL_CACHE_MAX_AREAS = 20;

/** Parameters that change the healed pixels and bust per-group signatures. */
export interface HealCacheParams {
  method: InpaintMethod;
  quality?: HealQuality;
  seamlessLight?: boolean;
  featherPx?: number;
  /** geometryKeyForHealCache output for this photo + canvas size. */
  geometryKey: string;
}

/** One healed stroke group: blended RGBA cropped to its feathered bbox. */
export interface CachedHealPatch {
  signature: string;
  x0: number;
  y0: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface HealCachePartition {
  valid: RetouchStrokeGroup[];
  dirty: RetouchStrokeGroup[];
}

/**
 * Version key for the clean base a patch was built on: photo identity,
 * geometry edits, and working resolution. Any change means every signature
 * mismatches and the group re-heals (safe over-invalidation).
 */
export function geometryKeyForHealCache(
  photoSrc: string,
  edit: {
    cropRatio: string;
    rotation: number;
    straighten: number;
    flipH: boolean;
    flipV: boolean;
  },
  width: number,
  height: number,
): string {
  return [
    photoSrc,
    edit.cropRatio,
    String(edit.rotation),
    String(edit.straighten),
    edit.flipH ? "1" : "0",
    edit.flipV ? "1" : "0",
    `${width}x${height}`,
  ].join("|");
}

function round6(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "nan";
}

/** Stable signature for one group's healed output under the given params. */
export function signatureForHealGroup(
  group: RetouchStrokeGroup,
  params: HealCacheParams,
): string {
  const points = group.points
    .map(
      (p) =>
        `${round6(p.x)},${round6(p.y)},${round6(p.size)},${round6(p.strength)}`,
    )
    .join(";");
  return [
    `id:${group.id}`,
    `m:${params.method}`,
    `q:${params.quality ?? ""}`,
    `s:${params.seamlessLight ? "1" : "0"}`,
    `f:${params.featherPx ?? ""}`,
    `g:${params.geometryKey}`,
    `p:${points}`,
  ].join("|");
}

/** Tight bbox of nonzero mask pixels, or null when the mask is empty. */
export function bboxForMask(mask: RepairMask): {
  x0: number;
  y0: number;
  width: number;
  height: number;
} | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if ((mask.data[y * mask.width + x] ?? 0) === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x0: minX, y0: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Feathered bbox covering a group's influence region on a WxH canvas. */
export function featheredBboxForGroup(
  group: RetouchStrokeGroup,
  width: number,
  height: number,
  featherPx?: number,
): { x0: number; y0: number; width: number; height: number } | null {
  const mask = rasterizeRepairMask(group.points, width, height);
  const feathered = featherRepairMask(mask, resolveFeatherPx(featherPx));
  return bboxForMask(feathered);
}

function rectsIntersect(
  a: { x0: number; y0: number; width: number; height: number },
  b: { x0: number; y0: number; width: number; height: number },
): boolean {
  return (
    a.x0 < b.x0 + b.width &&
    b.x0 < a.x0 + a.width &&
    a.y0 < b.y0 + b.height &&
    b.y0 < a.y0 + a.height
  );
}

/**
 * Split repair groups into cache-valid vs dirty. Stale ids (deleted strokes)
 * are evicted. Valid groups whose feathered bbox intersects a dirty group's
 * bbox are moved to dirty (re-heal union), transitively. The map is mutated
 * (eviction + recency refresh) and also returned for convenience.
 */
export function partitionHealGroups(
  repairs: readonly RetouchPoint[],
  cache: Map<number, CachedHealPatch>,
  params: HealCacheParams,
  width: number,
  height: number,
): HealCachePartition {
  const groups = groupRetouchStrokes(repairs).filter(
    (group) => group.kind === "repair",
  );
  const live = new Set(groups.map((group) => group.id));
  for (const id of [...cache.keys()]) {
    if (!live.has(id)) cache.delete(id);
  }
  const valid: RetouchStrokeGroup[] = [];
  const dirty: RetouchStrokeGroup[] = [];
  for (const group of groups) {
    const entry = cache.get(group.id);
    if (entry && entry.signature === signatureForHealGroup(group, params)) {
      valid.push(group);
      // Refresh LRU recency on hit.
      cache.delete(group.id);
      cache.set(group.id, entry);
    } else {
      dirty.push(group);
    }
  }
  // Overlap union: a dirty group's influence region invalidates any valid
  // group it touches. Bboxes already include the feather ramp, so rect
  // intersection is the (conservative) overlap test. Fixpoint: newly
  // dirtied groups can cascade to further valid groups.
  const dirtyRects: { x0: number; y0: number; width: number; height: number }[] =
    [];
  for (const group of dirty) {
    const bbox = featheredBboxForGroup(
      group,
      width,
      height,
      params.featherPx,
    );
    if (bbox) dirtyRects.push(bbox);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = valid.length - 1; i >= 0; i -= 1) {
      const group = valid[i];
      if (!group) continue;
      const entry = cache.get(group.id);
      if (!entry) {
        valid.splice(i, 1);
        dirty.push(group);
        changed = true;
        continue;
      }
      const rect = { x0: entry.x0, y0: entry.y0, width: entry.width, height: entry.height };
      if (dirtyRects.some((dirtyRect) => rectsIntersect(rect, dirtyRect))) {
        valid.splice(i, 1);
        dirty.push(group);
        dirtyRects.push(rect);
        changed = true;
      }
    }
  }
  return { valid, dirty };
}

/** Drop oldest entries past the cap (Map preserves insertion order). */
export function enforceHealCacheLimit(
  cache: Map<number, CachedHealPatch>,
  limit: number = HEAL_CACHE_MAX_AREAS,
): void {
  while (cache.size > limit) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

/**
 * Heal one stroke group against the clean base and return its cropped patch.
 * Returns null when the group rasterizes empty. Transport errors propagate
 * so the caller can keep the blur fallback for this group and continue.
 */
export async function healSingleGroup(
  source: PixelImage,
  group: RetouchStrokeGroup,
  method: InpaintMethod,
  runInpaint: RunInpaint,
  options?: RunInpaintOptions,
): Promise<CachedHealPatch | null> {
  const mask = rasterizeRepairMask(group.points, source.width, source.height);
  if (!mask.data.some((value) => value > 0)) return null;
  const filled = await runInpaint(
    source,
    mask,
    inpaintRadiusForStrokes(group.points, source.width),
    method,
    options,
  );
  const featherPx = resolveFeatherPx(options?.featherPx);
  const blendMask = featherRepairMask(mask, featherPx);
  const blended = blendInpainted(source, filled, blendMask);
  const bbox = bboxForMask(blendMask);
  if (!bbox) return null;
  const data = new Uint8ClampedArray(bbox.width * bbox.height * 4);
  for (let y = 0; y < bbox.height; y += 1) {
    const srcRow = ((bbox.y0 + y) * blended.width + bbox.x0) * 4;
    data.set(
      blended.data.subarray(srcRow, srcRow + bbox.width * 4),
      y * bbox.width * 4,
    );
  }
  return {
    signature: "",
    x0: bbox.x0,
    y0: bbox.y0,
    width: bbox.width,
    height: bbox.height,
    data,
  };
}

/**
 * Paste cropped patches over a base image. Patches must come from the same
 * geometry key (same dimensions); mismatched patches are skipped. Returns a
 * fresh image; inputs are never mutated.
 */
export function pasteHealPatches(
  base: PixelImage,
  patches: readonly CachedHealPatch[],
): PixelImage {
  const out = new Uint8ClampedArray(base.data);
  for (const patch of patches) {
    if (
      patch.width <= 0 ||
      patch.height <= 0 ||
      patch.x0 < 0 ||
      patch.y0 < 0 ||
      patch.x0 + patch.width > base.width ||
      patch.y0 + patch.height > base.height ||
      patch.data.length !== patch.width * patch.height * 4
    ) {
      continue;
    }
    for (let y = 0; y < patch.height; y += 1) {
      const dstRow = ((patch.y0 + y) * base.width + patch.x0) * 4;
      out.set(
        patch.data.subarray(y * patch.width * 4, (y + 1) * patch.width * 4),
        dstRow,
      );
    }
  }
  return { width: base.width, height: base.height, data: out };
}
