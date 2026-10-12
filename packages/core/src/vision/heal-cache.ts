// Incremental heal cache: per-stroke-group healed patches.
//
// Full-pass healing re-runs every area when any stroke changes. ML models are
// expensive (Moebius ~1.3GB, 19 diffusion steps), so the preview keeps one
// cached patch per repair stroke group and only heals groups with no saved
// work. A finished group is immutable: its pixels are reused verbatim until
// its stroke is deleted, regardless of the current method/quality/feather.
// Those settings apply only to groups being healed right now, so one photo
// can mix ML-healed and classically-healed areas. Classic heal shares the
// same per-group path; Telea / NS keep the single full-pass path.
//
// A patch is the final blended RGBA cropped to the feathered mask bbox of
// its group, composited over the clean (repair-free) base. Dirty groups
// always run against the clean base — never over other patches. Overlapping
// groups are healed independently and composited with the newest on top;
// saved work is never re-healed to match a joint run.

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

/**
 * Parameters for healing. Only geometryKey affects reuse: a saved group is
 * reused until its stroke is deleted or the photo geometry changes. Method,
 * quality, seamlessLight, and featherPx are provenance only — they describe
 * how a patch was built and are used for groups healing right now, never to
 * invalidate finished work.
 */
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
 * Find the stored overlay reusable for one group: same stroke points, same
 * photo + geometry edits (crop/rotate/flip/straighten), any canvas
 * resolution and any heal settings. Finished work is immutable: a settings
 * change never invalidates it. Returns null only when there is no overlay,
 * the geometry changed, or the stroke points changed (legacy signatures that
 * predate immutable reuse are matched by their trailing points key).
 */
export function reusableOverlayForGroup(
  overlays: readonly StoredHealPatch[],
  group: RetouchStrokeGroup,
  params: HealCacheParams,
): StoredHealPatch | null {
  const overlay = overlays.find((entry) => entry.groupId === group.id);
  if (!overlay) return null;
  if (geometryPrefixForKey(overlay.geometryKey) !== geometryPrefixForKey(params.geometryKey)) return null;
  if (signaturePointsHash(overlay.signature) !== pointsHashForGroup(group)) return null;
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

/** Stable points key for one group (resolution- and settings-independent). */
export function pointsKeyForGroup(group: RetouchStrokeGroup): string {
  return group.points
    .map(
      (p) =>
        `${round6(p.x)},${round6(p.y)},${round6(p.size)},${round6(p.strength)}`,
    )
    .join(";");
}

/**
 * Extract the trailing points key from a signature. Legacy signatures
 * (`id|m|q|s|f|g|p`) and verbose signatures (`id|g|p`) both end with
 * `|p:<points>`, so old overlays saved before hashed reuse still match.
 */
export function pointsKeyFromSignature(signature: string): string {
  const marker = "|p:";
  const cut = signature.lastIndexOf(marker);
  return cut < 0 ? signature : signature.slice(cut + marker.length);
}

/**
 * Short stable hash (cyrb53, hex) of a group's points. Stamps are verbose
 * (~40 chars each at 6 decimals) and a normal interpolated drag is hundreds
 * of stamps — embedding them verbatim blew the server's 4KB signature cap
 * and every PUT failed, so signatures carry only the hash.
 */
export function pointsHashForGroup(group: RetouchStrokeGroup): string {
  return pointsHashForKey(pointsKeyForGroup(group));
}

/** Hash a raw points key (also used to match legacy verbose signatures). */
export function pointsHashForKey(pointsKey: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < pointsKey.length; i += 1) {
    const ch = pointsKey.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0"));
}

/**
 * Points identity of a stored signature, normalized to a hash. Hashed
 * signatures (`id|g|h`) compare directly; legacy verbose ones (`|p:<points>`)
 * are hashed on the fly so old overlays keep matching.
 */
export function signaturePointsHash(signature: string): string {
  const marker = "|h:";
  const cut = signature.lastIndexOf(marker);
  if (cut >= 0) {
    const tail = signature.slice(cut + marker.length);
    const end = tail.indexOf("|");
    return end < 0 ? tail : tail.slice(0, end);
  }
  return pointsHashForKey(pointsKeyFromSignature(signature));
}

/**
 * Stable signature for one group's healed output. Deliberately excludes
 * method/quality/seamlessLight/featherPx: those describe how a patch was
 * built, never whether it is reusable. Only the stroke identity, the canvas
 * geometry, and the points bust the cache. Points travel as a hash so long
 * strokes stay far under the server's signature cap.
 */
export function signatureForHealGroup(
  group: RetouchStrokeGroup,
  params: HealCacheParams,
): string {
  return [
    `id:${group.id}`,
    `g:${params.geometryKey}`,
    `h:${pointsHashForGroup(group)}`,
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

/**
 * Split repair groups into cache-valid vs dirty. Stale ids (deleted strokes)
 * are evicted. A group is valid when its cached signature matches the
 * current strokes and geometry — heal settings never bust it, and overlap
 * with a dirty group never dirties it. The map is mutated (eviction +
 * recency refresh) and also returned for convenience.
 */
export function partitionHealGroups(
  repairs: readonly RetouchPoint[],
  cache: Map<number, CachedHealPatch>,
  params: HealCacheParams,
  _width: number,
  _height: number,
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
    // The signature covers stroke identity, geometry, and points only, so a
    // settings change never busts it. Entries are created fresh each session
    // with this format; a stale format mismatches once and reheals once.
    const matches =
      entry && entry.signature === signatureForHealGroup(group, params);
    if (matches) {
      valid.push(group);
      // Refresh LRU recency on hit.
      cache.delete(group.id);
      cache.set(group.id, entry);
    } else {
      dirty.push(group);
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
 * Clockwise quarter-turns from one rotation to another (0-3), or null when
 * the delta is not a quarter turn. Mirrors rotateRetouches step math.
 */
export function clockwiseStepsForRotation(fromRotation: number, toRotation: number): number | null {
  const delta = toRotation - fromRotation;
  const steps = Math.round(delta / 90);
  if (!Number.isFinite(steps) || Math.abs(delta - steps * 90) > 1e-6) return null;
  return ((steps % 4) + 4) % 4;
}

/**
 * Rotate a cached heal patch with the image across a quarter-turn rotation
 * change, so heal-then-rotate reuses pixels instead of re-running inference.
 * Both the cropped pixel block and its bbox turn together; 90-degree turns
 * require swapped canvas dims, 180 requires identical dims. Anything else
 * (crop-window changes, out-of-bounds patches, corrupt data) returns null
 * and the caller reheals that group. The signature is preserved verbatim —
 * the caller must restamp it for the rotated strokes and new geometry key.
 * Inputs are never mutated.
 */
export function rotateHealPatch(
  patch: CachedHealPatch,
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
  clockwiseSteps: number,
): CachedHealPatch | null {
  if (!Number.isInteger(clockwiseSteps)) return null;
  const steps = ((clockwiseSteps % 4) + 4) % 4;
  if (
    !Number.isInteger(oldWidth) || !Number.isInteger(oldHeight) ||
    !Number.isInteger(newWidth) || !Number.isInteger(newHeight) ||
    oldWidth <= 0 || oldHeight <= 0 || newWidth <= 0 || newHeight <= 0
  ) {
    return null;
  }
  if (
    !Number.isInteger(patch.x0) || !Number.isInteger(patch.y0) ||
    !Number.isInteger(patch.width) || !Number.isInteger(patch.height) ||
    patch.width <= 0 || patch.height <= 0
  ) {
    return null;
  }
  if (
    patch.x0 < 0 || patch.y0 < 0 ||
    patch.x0 + patch.width > oldWidth ||
    patch.y0 + patch.height > oldHeight
  ) {
    return null;
  }
  if (patch.data.length !== patch.width * patch.height * 4) return null;
  if (steps === 0) {
    if (oldWidth !== newWidth || oldHeight !== newHeight) return null;
    return { ...patch, data: patch.data.slice() };
  }
  const w = patch.width;
  const h = patch.height;
  if (steps === 2) {
    if (oldWidth !== newWidth || oldHeight !== newHeight) return null;
    const out = new Uint8ClampedArray(patch.data.length);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const src = (y * w + x) * 4;
        const dst = ((h - 1 - y) * w + (w - 1 - x)) * 4;
        out[dst] = patch.data[src] ?? 0;
        out[dst + 1] = patch.data[src + 1] ?? 0;
        out[dst + 2] = patch.data[src + 2] ?? 0;
        out[dst + 3] = patch.data[src + 3] ?? 0;
      }
    }
    return {
      ...patch,
      x0: oldWidth - patch.x0 - patch.width,
      y0: oldHeight - patch.y0 - patch.height,
      data: out,
    };
  }
  // 90-degree turns swap canvas dims; anything else is a crop-window change
  // that needs a reheal.
  if (newWidth !== oldHeight || newHeight !== oldWidth) return null;
  const nw = h;
  const nh = w;
  const out = new Uint8ClampedArray(patch.data.length);
  if (steps === 1) {
    // CW: old (x,y) -> new (h-1-y, x).
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const src = (y * w + x) * 4;
        const dst = (x * nw + (h - 1 - y)) * 4;
        out[dst] = patch.data[src] ?? 0;
        out[dst + 1] = patch.data[src + 1] ?? 0;
        out[dst + 2] = patch.data[src + 2] ?? 0;
        out[dst + 3] = patch.data[src + 3] ?? 0;
      }
    }
    return {
      ...patch,
      x0: oldHeight - patch.y0 - patch.height,
      y0: patch.x0,
      width: nw,
      height: nh,
      data: out,
    };
  }
  // CCW: old (x,y) -> new (y, w-1-x).
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = (y * w + x) * 4;
      const dst = ((w - 1 - x) * nw + y) * 4;
      out[dst] = patch.data[src] ?? 0;
      out[dst + 1] = patch.data[src + 1] ?? 0;
      out[dst + 2] = patch.data[src + 2] ?? 0;
      out[dst + 3] = patch.data[src + 3] ?? 0;
    }
  }
  return {
    ...patch,
    x0: patch.y0,
    y0: oldWidth - patch.x0 - patch.width,
    width: nw,
    height: nh,
    data: out,
  };
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
// reopening seeds the cache from these records and only heals groups with
// no saved overlay. Heal settings never invalidate saved work. Corrupt
// records are skipped, never fatal.

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
