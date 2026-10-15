// Server-side import-time cull assist: assess once per content hash, label
// once per photo, group over the whole album.
//
// Blur (classical Laplacian variance) and near-duplicates (DCT perceptual
// hash, ranked by a tiny logistic quality score) are computed here over the
// cached grid thumbs — the same pixel source as semantic search — and cached
// in the SQLite catalog (photo_cull, keyed by content hash). A file is never
// re-detected: fresh imports assess in a fire-and-forget background queue,
// and the album menu pass only assesses hashes it has never seen. Labels
// ride the shared photo_labels table with source "ml" (scoped writes, so
// semantic labels survive a cull pass and vice versa), and each photo is
// labeled at most once (photo_cull_labels marker) — so a hand-removed flag
// is never re-added, while a delete + reimport still gets its flags back
// from the cache without recomputing.
//
// No weights, no downloads, no offline mode: the whole pass is classical
// plus embedded coefficients, milliseconds per photo.

import {
  CULL_ASSIST_VERSION,
  CULL_LABEL_BLURRY,
  CULL_LABELS,
  assignCullLabels,
  assessPixels,
  groupNearDuplicates,
  pickGroupBest,
} from "@f8/core";
import type { PhotoLabel, PixelImage } from "@f8/core";
import type { RawDecodeDeps } from "./raw-decode.ts";
import { pixelsForPhoto, type EmbedContext } from "./semantic-search.ts";
import type { PhotoRow, Store, StoredCull } from "./store.ts";

export interface CullContext {
  dataDir: string;
  previewsDir: string;
  tmpDir: string;
  store: Store;
  thumbDeps?: RawDecodeDeps;
  /**
   * Pixel source override (tests inject synthetic pixels per photo so no
   * thumbs are needed); the default decodes the cached grid thumb, exactly
   * like semantic search.
   */
  pixelsFor?: (row: PhotoRow) => Promise<PixelImage | null>;
}

async function defaultPixelsFor(ctx: CullContext, row: PhotoRow): Promise<PixelImage | null> {
  const embedCtx: EmbedContext = {
    dataDir: ctx.dataDir,
    previewsDir: ctx.previewsDir,
    tmpDir: ctx.tmpDir,
    store: ctx.store,
    thumbDeps: ctx.thumbDeps,
  };
  return pixelsForPhoto(embedCtx, row);
}

/** A cached assessment that is still current (same algorithm version). */
function currentAssessment(store: Store, hash: string | null): StoredCull | undefined {
  if (!hash) return undefined;
  const stored = store.getCull(hash);
  return stored && stored.version === CULL_ASSIST_VERSION ? stored : undefined;
}

export interface CullBody {
  albumId: string;
}

export function validateCullBody(body: unknown): { ok: true; value: CullBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { albumId } = body as Record<string, unknown>;
  if (typeof albumId !== "string" || !albumId) return { ok: false, error: "Invalid album." };
  return { ok: true, value: { albumId } };
}

export type CullSkipReason = "not-assessable" | "assessed" | "no-pixels";

export interface CullOutcome {
  photoId: string;
  hash: string;
  blur: number;
  blurry: boolean;
  phash: string;
  aesthetic: number;
}

/**
 * Assess one photo's pixels and cache the metrics under its content hash.
 * Returns "assessed" without touching pixels when the cache already covers
 * the hash — the no-re-detect guarantee. Never assigns labels (labeling is
 * album-wide, from the cache).
 */
export async function assessPhoto(
  ctx: CullContext,
  photoId: string,
): Promise<{ ok: true; outcome: CullOutcome } | { ok: false; reason: CullSkipReason } | { ok: false; reason: "failed"; error: string }> {
  const row = ctx.store.getPhoto(photoId);
  if (!row || row.kind !== "file" || !row.path || !row.hash) return { ok: false, reason: "not-assessable" };
  if (currentAssessment(ctx.store, row.hash)) return { ok: false, reason: "assessed" };
  const pixels = await (ctx.pixelsFor ? ctx.pixelsFor(row) : defaultPixelsFor(ctx, row));
  if (!pixels) return { ok: false, reason: "no-pixels" };
  try {
    const assessment = assessPixels(pixels);
    ctx.store.saveCull(row.hash, { ...assessment, version: CULL_ASSIST_VERSION });
    return { ok: true, outcome: { photoId, hash: row.hash, ...assessment } };
  } catch (error) {
    return { ok: false, reason: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export interface CullGroup {
  /** Group best (spared the duplicate flag); may itself be flagged as blurry. */
  best: string;
  members: string[];
}

export interface CullAlbumReport {
  albumId: string;
  /** Photos whose metrics this run computed. */
  assessed: string[];
  /** Photos whose metrics the cache already covered (no recompute). */
  alreadyAssessed: string[];
  /** Photos this run cull-labeled (whether or not any flag fired). */
  labeled: string[];
  /** Photos already cull-labeled before this run (never relabeled). */
  alreadyLabeled: string[];
  /** Labeled blurry by this run. */
  blurry: string[];
  /** Near-duplicate groups across the album's assessed photos. */
  groups: CullGroup[];
  /** Attempted but skipped (not a file, no pixels). */
  skipped: { photoId: string; reason: string }[];
  /** Attempted but errored. */
  failed: { photoId: string; error: string }[];
}

/** Cached metrics for album photos, for album-wide label planning. */
function albumMetrics(store: Store, photoIds: string[]): { id: string; blur: number; phash: string; aesthetic: number }[] {
  const rows = new Map<string, PhotoRow>();
  for (const id of photoIds) {
    const row = store.getPhoto(id);
    if (row) rows.set(id, row);
  }
  const hashes = [...rows.values()].map((row) => row.hash).filter((hash): hash is string => Boolean(hash));
  const cached = store.listCull(hashes);
  const metrics: { id: string; blur: number; phash: string; aesthetic: number }[] = [];
  for (const [id, row] of rows) {
    const stored = row.hash ? cached.get(row.hash) : undefined;
    if (stored && stored.version === CULL_ASSIST_VERSION) {
      metrics.push({ id, blur: stored.blur, phash: stored.phash, aesthetic: stored.aesthetic });
    }
  }
  return metrics;
}

function reportGroups(
  metrics: { id: string; blur: number; phash: string; aesthetic: number }[],
): CullGroup[] {
  const byId = new Map(metrics.map((entry) => [entry.id, entry]));
  return groupNearDuplicates(metrics.map((entry) => ({ id: entry.id, phash: entry.phash }))).map((members) => ({
    best: pickGroupBest(
      members.map((id) => {
        const entry = byId.get(id);
        return { id, aesthetic: entry?.aesthetic ?? 0, blur: entry?.blur ?? 0 };
      }),
    ),
    members,
  }));
}

/**
 * Cull one album: assess every photo that lacks cached metrics (never
 * re-detecting), then assign cull flags to every photo that lacks them —
 * planned album-wide from the cache, written only for the newly labeled.
 */
export async function cullAlbum(ctx: CullContext, albumId: string): Promise<CullAlbumReport> {
  const album = ctx.store.getAlbum(albumId);
  if (!album) throw new RangeError("Album not found.");
  const inAlbum = ctx.store.listPhotos().filter((photo) => photo.album_id === albumId).map((photo) => photo.id);
  const marked = ctx.store.listCullLabeled(inAlbum);
  const report: CullAlbumReport = {
    albumId,
    assessed: [],
    alreadyAssessed: [],
    labeled: [],
    alreadyLabeled: [],
    blurry: [],
    groups: [],
    skipped: [],
    failed: [],
  };
  const fresh: string[] = [];
  for (const photoId of inAlbum) {
    if (marked.has(photoId)) {
      report.alreadyLabeled.push(photoId);
      continue;
    }
    const row = ctx.store.getPhoto(photoId);
    if (currentAssessment(ctx.store, row?.hash ?? null)) {
      // Cached metrics (e.g. a delete + reimport): labels from the cache,
      // pixels never re-read.
      report.alreadyAssessed.push(photoId);
      fresh.push(photoId);
      continue;
    }
    const result = await assessPhoto(ctx, photoId);
    if (result.ok) {
      report.assessed.push(photoId);
      fresh.push(photoId);
    } else if (result.reason === "assessed") {
      // Raced the import queue: metrics landed mid-pass, labels still due.
      report.alreadyAssessed.push(photoId);
      fresh.push(photoId);
    } else if (result.reason === "failed") {
      report.failed.push({ photoId, error: result.error });
    } else {
      report.skipped.push({ photoId, reason: result.reason });
    }
    // Hundreds of sequential assessments never starve the event loop.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const metrics = albumMetrics(ctx.store, inAlbum);
  report.groups = reportGroups(metrics);
  // Planned over the whole album (grouping sees previously labeled photos
  // too), written only for the newly labeled.
  const planned = assignCullLabels(metrics.map((entry) => ({
    id: entry.id,
    metrics: { blur: entry.blur, phash: entry.phash, aesthetic: entry.aesthetic },
  })));
  for (const photoId of fresh) {
    const labels = planned.get(photoId) ?? [];
    if (labels.length) {
      ctx.store.setMlLabels(photoId, labels, { only: [...CULL_LABELS] });
      if (labels.some((entry) => entry.label === CULL_LABEL_BLURRY)) report.blurry.push(photoId);
    }
    ctx.store.markCullLabeled(photoId);
    report.labeled.push(photoId);
  }
  return report;
}

export interface CullQueue {
  enqueue: (photoId: string) => void;
  depth: () => number;
  /** Resolve once the queue drains (a test seam; production never awaits it). */
  idle: () => Promise<void>;
}

/**
 * Import-time cull queue: fire-and-forget, sequential. Each fresh import
 * enqueues its photo id; the processor assesses the pixels (cached by hash,
 * so reimports are free) and assigns that photo's flags from the
 * album-so-far. Early in a bulk import the group context is partial, so
 * duplicate flags are best-effort until the album menu pass labels the
 * stragglers — blurry flags never depend on grouping. Every failure is
 * per-photo: the queue always moves on.
 */
export function createCullQueue(ctx: CullContext): CullQueue {
  const pending: string[] = [];
  const seen = new Set<string>();
  let running = false;
  let idleResolvers: (() => void)[] = [];

  const settle = (): void => {
    if (pending.length || running) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) resolve();
  };

  const process = async (photoId: string): Promise<void> => {
    const row = ctx.store.getPhoto(photoId);
    if (!row) return;
    if (ctx.store.isCullLabeled(photoId)) return;
    const result = await assessPhoto(ctx, photoId);
    if (!result.ok) return;
    const mates = ctx.store.listPhotos().filter((photo) => photo.album_id === row.album_id).map((photo) => photo.id);
    const metrics = albumMetrics(ctx.store, mates);
    const planned: Map<string, PhotoLabel[]> = assignCullLabels(metrics.map((entry) => ({
      id: entry.id,
      metrics: { blur: entry.blur, phash: entry.phash, aesthetic: entry.aesthetic },
    })));
    const labels = planned.get(photoId) ?? [];
    if (labels.length) ctx.store.setMlLabels(photoId, labels, { only: [...CULL_LABELS] });
    ctx.store.markCullLabeled(photoId);
  };

  const pump = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        for (;;) {
          const photoId = pending.shift();
          if (!photoId) break;
          seen.delete(photoId);
          try {
            await process(photoId);
          } catch (error) {
            console.warn(`[cull-assist] Background cull of ${photoId} failed:`, error instanceof Error ? error.message : error);
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      } finally {
        running = false;
        settle();
      }
    })();
  };

  return {
    enqueue: (photoId: string): void => {
      if (seen.has(photoId)) return;
      seen.add(photoId);
      pending.push(photoId);
      pump();
    },
    depth: (): number => pending.length,
    idle: (): Promise<void> => {
      if (!pending.length && !running) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleResolvers.push(resolve);
      });
    },
  };
}
