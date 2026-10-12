// Persisted last-rendered preview cache: the fully composited canvas.
//
// Reopening a photo otherwise replays the whole pipeline (image decode +
// overlay fetch + geometry + composite) before healed pixels appear — a
// visible clean-then-healed pop-in. Instead, every confirmed final composite
// (all groups healed, nothing pending) is stashed as a JPEG blob keyed by a
// version of everything affecting pixels. On open the cached bitmap shows
// instantly and pixel-identically; the live canvas swaps in silently behind
// it. A key mismatch (any edit since) means the entry is never shown.
//
// Storage is IndexedDB (survives UI reloads, async, never blocks paint).
// Every function is total: missing IndexedDB, offline, quota, and corrupt
// entries all degrade to a no-op/null, never a throw.

import type { EditState } from "../types.js";

const DB_NAME = "f8-preview-cache";
const STORE_NAME = "previews";
/** Upper bound for cached renders; oldest entries are evicted first. */
export const PREVIEW_RENDER_CACHE_MAX_ENTRIES = 20;
/** JPEG quality for cached renders (final display pixels, ≤1800px). */
export const PREVIEW_RENDER_JPEG_QUALITY = 0.85;

interface PreviewRenderEntry {
  photoId: string;
  key: string;
  blob: Blob;
  updatedAt: number;
}

/** Canonical JSON: object keys sorted recursively, so field construction order can never diverge a key. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Version key for a photo's final pixels: photo identity plus the full edit
 * recipe (adjustments, geometry, retouches). Any pixel-affecting change
 * yields a different key, so a stale bitmap can never pass as current. The
 * recipe is canonically serialized: React-state field order and server
 * round-trips hash identically.
 */
export function previewRenderKey(photoId: string, photoSrc: string, edit: EditState): string {
  const raw = `${photoId}\n${photoSrc}\n${stableStringify(edit)}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "photoId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = run(store);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Load the cached render blob when its version key still matches. */
export async function loadPreviewRender(photoId: string, key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    try {
      const entry = await tx<PreviewRenderEntry>(db, "readonly", (store) => store.get(photoId));
      if (!entry || entry.key !== key || !(entry.blob instanceof Blob) || entry.blob.size === 0) return null;
      return entry.blob;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Persist one final render; evicts oldest past the cap. Fire-and-forget. */
export async function savePreviewRender(photoId: string, key: string, blob: Blob): Promise<void> {
  try {
    if (!(blob instanceof Blob) || blob.size === 0) return;
    const db = await openDb();
    if (!db) return;
    try {
      const entry: PreviewRenderEntry = { photoId, key, blob, updatedAt: Date.now() };
      await tx(db, "readwrite", (store) => store.put(entry));
      const all = await tx<PreviewRenderEntry[]>(db, "readonly", (store) => store.getAll());
      if (all && all.length > PREVIEW_RENDER_CACHE_MAX_ENTRIES) {
        const evict = all
          .sort((a, b) => a.updatedAt - b.updatedAt)
          .slice(0, all.length - PREVIEW_RENDER_CACHE_MAX_ENTRIES);
        for (const stale of evict) {
          await tx(db, "readwrite", (store) => store.delete(stale.photoId));
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // Cache is never load-bearing.
  }
}

/** Encode a canvas as a JPEG blob for the preview cache; null when unavailable. */
export function previewBlobFromCanvas(canvas: HTMLCanvasElement, quality = PREVIEW_RENDER_JPEG_QUALITY): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
}
