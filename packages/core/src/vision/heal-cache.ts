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
import type { HealOverlayBody, HealOverlayRecord, LibraryClient } from "../library.js";import {
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

/**
 * A patch persisted on the photo server (or passed to export): the cached
 * pixels plus the canvas they were built at. Canvas dims travel along so a
 * different-resolution consumer (export) can rescale instead of rehealing.
 */
export interface StoredHealPatch extends CachedHealPatch {
  groupId: number;
  geometryKey: string;
  canvasWidth: number;
  canvasHeight: number;
}

/** Resolution-independent prefix of a geometry key (photo + geometry edits). */
export function geometryPrefixForKey(key: string): string {
  const cut = key.lastIndexOf("|");
  return cut < 0 ? key : key.slice(0, cut);
}

/**
 * Recompute a group's signature as if it lived on another canvas: same
 * points/params, only the geometry key swapped. Used to test whether a
 * stored overlay matches the current strokes regardless of resolution.
 */
export function signatureForHealGroupOnCanvas(
  group: RetouchStrokeGroup,
  params: HealCacheParams,
  geometryKey: string,
): string {
  return signatureForHealGroup(group, { ...params, geometryKey });
}

/**
 * Find the stored overlay reusable for one group: same stroke points and
 * heal params, same photo + geometry edits (crop/rotate/flip/straighten),
 * any canvas resolution. Returns null when the group must reheal.
 */
export function reusableOverlayForGroup(
  overlays: readonly StoredHealPatch[],
  group: RetouchStrokeGroup,
  params: HealCacheParams,
): StoredHealPatch | null {
  const overlay = overlays.find((entry) => entry.groupId === group.id);
  if (!overlay) return null;
  if (geometryPrefixForKey(overlay.geometryKey) !== geometryPrefixForKey(params.geometryKey)) return null;
  if (overlay.signature !== signatureForHealGroupOnCanvas(group, params, overlay.geometryKey)) return null;
  return overlay;
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

// --- Persisted overlays --------------------------------------------------
//
// The preview cache is in-memory only, so every revisit re-ran inference.
// Each finished group is PUT to the photo server right after it heals;
// reopening seeds the cache from these records and only heals groups whose
// strokes or params changed. Corrupt records are skipped, never fatal.

function b64ToData(b64: string): Uint8ClampedArray | null {
  try {
    const binary = atob(b64);
    const out = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function dataToB64(data: Uint8ClampedArray): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Convert one server record to binary form; null when corrupt. */
export function storedPatchFromRecord(record: HealOverlayRecord): StoredHealPatch | null {
  if (
    !Number.isInteger(record.groupId) ||
    typeof record.signature !== "string" ||
    !record.signature ||
    !Number.isInteger(record.x0) ||
    !Number.isInteger(record.y0) ||
    !Number.isInteger(record.width) ||
    !Number.isInteger(record.height) ||
    !Number.isInteger(record.canvasWidth) ||
    !Number.isInteger(record.canvasHeight) ||
    typeof record.geometryKey !== "string" ||
    !record.geometryKey
  ) {
    return null;
  }
  const data = b64ToData(record.dataB64);
  if (!data || data.length !== record.width * record.height * 4) return null;
  return {
    groupId: record.groupId,
    signature: record.signature,
    x0: record.x0,
    y0: record.y0,
    width: record.width,
    height: record.height,
    geometryKey: record.geometryKey,
    canvasWidth: record.canvasWidth,
    canvasHeight: record.canvasHeight,
    data,
  };
}

export interface HealOverlayMeta {
  geometryKey: string;
  canvasWidth: number;
  canvasHeight: number;
  method: string;
  quality?: string;
  featherPx?: number;
}

/** Encode one healed patch for PUT (base64 raw RGBA). */
export function overlayBodyFromPatch(patch: CachedHealPatch, meta: HealOverlayMeta): HealOverlayBody {
  return {
    signature: patch.signature,
    x0: patch.x0,
    y0: patch.y0,
    width: patch.width,
    height: patch.height,
    canvasWidth: meta.canvasWidth,
    canvasHeight: meta.canvasHeight,
    method: meta.method,
    ...(meta.quality === undefined ? {} : { quality: meta.quality }),
    ...(meta.featherPx === undefined ? {} : { featherPx: meta.featherPx }),
    geometryKey: meta.geometryKey,
    dataB64: dataToB64(patch.data),
  };
}

/**
 * Load persisted overlays for a photo as binary patches. Never throws:
 * missing photos, offline servers, and corrupt records all yield [].
 */
export async function loadStoredHealOverlays(
  client: Pick<LibraryClient, "listHealOverlays">,
  photoId: string,
): Promise<StoredHealPatch[]> {
  try {
    const { patches } = await client.listHealOverlays(photoId);
    return patches.flatMap((record) => {
      const patch = storedPatchFromRecord(record);
      return patch ? [patch] : [];
    });
  } catch {
    return [];
  }
}
