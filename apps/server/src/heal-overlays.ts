// Server-side heal overlays: one persisted patch per repair stroke group.
//
// The preview keeps healed pixels in an in-memory Map that dies on photo
// change/reload, so every revisit re-ran inference. Each finished group is
// now PUT here right after it heals; reopening seeds the cache from these
// files and only heals groups with no saved overlay. Heal settings never
// invalidate saved work: the signature covers stroke identity, geometry, and
// points only. One JSON file per group
// (metadata + base64 raw RGBA of the cropped patch) under
// <dataDir>/heal-overlays/<photoId>/ — no extra deps, no DB bloat.

import { promises as fs } from "node:fs";
import path from "node:path";

/** Upper bound for persisted areas per photo (mirrors HEAL_CACHE_MAX_AREAS). */
export const HEAL_OVERLAY_MAX_AREAS = 20;
/** Raw RGBA byte cap per patch (4096x4096 worst case is far above reality). */
export const HEAL_OVERLAY_MAX_RAW_BYTES = 32 * 1024 * 1024;

export interface SavedHealOverlay {
  groupId: number;
  signature: string;
  x0: number;
  y0: number;
  width: number;
  height: number;
  /** Working canvas dims the patch was built at (for export rescaling). */
  canvasWidth: number;
  canvasHeight: number;
  method: string;
  quality?: string;
  featherPx?: number;
  geometryKey: string;
  /** Base64 of raw RGBA bytes (width*height*4). */
  dataB64: string;
  /** Cumulative straighten-resample degrees; absent on pre-budget records (= 0). */
  resampleDeg?: number;
  updatedAt: string;
}

function assertPhotoId(photoId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(photoId)) throw new RangeError("Invalid photo id.");
}

function assertGroupId(groupId: unknown): asserts groupId is number {
  if (!Number.isInteger(groupId) || Math.abs(groupId as number) > 2 ** 31) {
    throw new RangeError("Invalid group id.");
  }
}

export function healOverlaysDir(dataDir: string): string {
  return path.join(dataDir, "heal-overlays");
}

function photoDir(dataDir: string, photoId: string): string {
  assertPhotoId(photoId);
  return path.join(healOverlaysDir(dataDir), photoId);
}

function patchFile(dataDir: string, photoId: string, groupId: number): string {
  assertGroupId(groupId);
  return path.join(photoDir(dataDir, photoId), `g${groupId}.json`);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/**
 * Validate a PUT body. Returns the overlay record (with updatedAt stamped)
 * or throws RangeError on malformed input (routes answer 400).
 */
export function validateOverlayBody(
  photoId: string,
  groupId: number,
  body: unknown,
): SavedHealOverlay {
  assertPhotoId(photoId);
  assertGroupId(groupId);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RangeError("Invalid overlay.");
  }
  const v = body as Record<string, unknown>;
  const { signature, x0, y0, width, height, canvasWidth, canvasHeight, method, quality, featherPx, geometryKey, dataB64, resampleDeg } = v;
  if (typeof signature !== "string" || !signature || signature.length > 4096) throw new RangeError("Invalid signature.");
  if (!isInt(x0, 0, 8192) || !isInt(y0, 0, 8192)) throw new RangeError("Invalid patch origin.");
  if (!isInt(width, 1, 4096) || !isInt(height, 1, 4096)) throw new RangeError("Invalid patch size.");
  if (!isInt(canvasWidth, 1, 8192) || !isInt(canvasHeight, 1, 8192)) throw new RangeError("Invalid canvas size.");
  if ((x0 as number) + (width as number) > (canvasWidth as number)) throw new RangeError("Patch exceeds canvas width.");
  if ((y0 as number) + (height as number) > (canvasHeight as number)) throw new RangeError("Patch exceeds canvas height.");
  if (typeof method !== "string" || !method || method.length > 32) throw new RangeError("Invalid method.");
  if (quality !== undefined && (typeof quality !== "string" || quality.length > 32)) throw new RangeError("Invalid quality.");
  if (featherPx !== undefined && !isInt(featherPx, 0, 64)) throw new RangeError("Invalid feather.");
  if (typeof geometryKey !== "string" || !geometryKey || geometryKey.length > 2048) throw new RangeError("Invalid geometry key.");
  if (resampleDeg !== undefined && (typeof resampleDeg !== "number" || !Number.isFinite(resampleDeg) || resampleDeg < 0 || resampleDeg > 100000)) throw new RangeError("Invalid resample budget.");
  if (typeof dataB64 !== "string" || !dataB64) throw new RangeError("Missing patch data.");
  let rawLength = -1;
  try {
    rawLength = Buffer.from(dataB64, "base64").length;
  } catch {
    throw new RangeError("Invalid patch data.");
  }
  const expected = (width as number) * (height as number) * 4;
  if (rawLength !== expected) throw new RangeError(`Patch data mismatch (got ${rawLength}, expected ${expected}).`);
  if (rawLength > HEAL_OVERLAY_MAX_RAW_BYTES) throw new RangeError("Patch data too large.");
  return {
    groupId,
    signature,
    x0: x0 as number,
    y0: y0 as number,
    width: width as number,
    height: height as number,
    canvasWidth: canvasWidth as number,
    canvasHeight: canvasHeight as number,
    method,
    ...(quality === undefined ? {} : { quality: quality as string }),
    ...(featherPx === undefined ? {} : { featherPx: featherPx as number }),
    geometryKey,
    dataB64,
    ...(resampleDeg === undefined ? {} : { resampleDeg: resampleDeg as number }),
    updatedAt: new Date().toISOString(),
  };
}

/** List all saved overlays for a photo (empty when none). */
export async function listHealOverlays(dataDir: string, photoId: string): Promise<SavedHealOverlay[]> {
  assertPhotoId(photoId);
  const dir = photoDir(dataDir, photoId);
  const entries = await fs.readdir(dir).catch(() => null);
  if (!entries) return [];
  const out: SavedHealOverlay[] = [];
  for (const entry of entries) {
    if (!/^g-?\d+\.json$/.test(entry)) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry), "utf8");
      const parsed = JSON.parse(raw) as SavedHealOverlay;
      if (typeof parsed.groupId !== "number" || typeof parsed.dataB64 !== "string") continue;
      out.push(parsed);
    } catch {
      // Corrupt entry: skip, never fail the whole listing.
    }
  }
  return out.sort((a, b) => a.groupId - b.groupId);
}

/** Persist one group's overlay, evicting oldest past the cap. */
export async function saveHealOverlay(dataDir: string, photoId: string, overlay: SavedHealOverlay): Promise<void> {
  const dir = photoDir(dataDir, photoId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(patchFile(dataDir, photoId, overlay.groupId), JSON.stringify(overlay));
  const listed = await listHealOverlays(dataDir, photoId);
  if (listed.length > HEAL_OVERLAY_MAX_AREAS) {
    const evict = listed
      .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0))
      .slice(0, listed.length - HEAL_OVERLAY_MAX_AREAS);
    await Promise.all(evict.map((entry) => fs.unlink(patchFile(dataDir, photoId, entry.groupId)).catch(() => undefined)));
  }
}

/** Delete one group's overlay (stroke deleted); missing is a no-op. */
export async function deleteHealOverlay(dataDir: string, photoId: string, groupId: number): Promise<boolean> {
  try {
    await fs.unlink(patchFile(dataDir, photoId, groupId));
    return true;
  } catch {
    return false;
  }
}

/** Drop every overlay for a photo (photo deleted). Best-effort, never throws. */
export async function purgeHealOverlays(dataDir: string, photoId: string): Promise<void> {
  try {
    await fs.rm(photoDir(dataDir, photoId), { recursive: true, force: true });
  } catch {
    // Ignore: overlays are a cache, never load-bearing.
  }
}
