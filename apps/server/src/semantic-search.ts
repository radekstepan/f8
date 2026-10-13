// Server-side local semantic search / smart albums: embed → label → search.
//
// CLIP-image embeddings (ViT-B/32, 512-d) are computed here via
// onnxruntime-node, never in the browser, and stored in the SQLite catalog
// (photo_embeddings + photo_labels). A text query ("beach", "dog") maps onto
// the same space through precomputed concept vectors (core), so search ranks
// photos by cosine similarity with no cloud involved.
//
// Weights (quantized CLIP ViT-B/32 vision encoder, ~89MB) download once into
// the model dir on first warmup. Unlike the detect endpoints there is no
// classical fallback for labeling — a guessed label corrupts search, so the
// honest behavior is to skip: imports embed opportunistically (weights
// present or nothing happens, never a download), and the explicit label
// action reports needsDownload until the weights land. Search itself always
// serves: semantic ranking over stored embeddings when the query names
// vocabulary concepts, keyword matching over labels and metadata otherwise.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import jpeg from "jpeg-js";
import {
  SEMANTIC_SEARCH_DEFAULT_URL,
  SEMANTIC_SEARCH_DIM,
  SEMANTIC_SEARCH_FILE,
  SEMANTIC_SEARCH_FILE_SIZE,
  SEMANTIC_SEARCH_LICENSE,
  SEMANTIC_SEARCH_MAX_RESULTS,
  SEMANTIC_SEARCH_MODEL_ID,
  SEMANTIC_SEARCH_MODEL_VERSION,
  SEMANTIC_CONCEPT_VOCAB,
  assignSemanticLabels,
  conceptsOfQuery,
  packSemanticInput,
  parseSemanticOutput,
  queryEmbedding,
  rankSemanticPhotos,
  type PhotoLabel,
} from "@f8/core";
import type { PixelImage } from "@f8/core";
import { defaultToolDeps, type RawDecodeDeps } from "./raw-decode.ts";
import type { PhotoRow, Store } from "./store.ts";
import { ensureThumb } from "./thumbs.ts";

const require = createRequire(import.meta.url);

export const SEMANTIC_SEARCH_MODEL_DIR_SUFFIX = path.join("models", "semantic-search");
/** Minimum accepted weight file size (guards truncated downloads). */
const SEMANTIC_SEARCH_MIN_WEIGHT_BYTES = 80 * 1024 * 1024;
/** JPEG decode guard: thumbs are <=640px, far under this. */
const SEMANTIC_SEARCH_MAX_JPEG_MP = 64;

export interface SemanticCatalogStats {
  photos: number;
  embedded: number;
  mlLabeled: number;
}

export interface SemanticSearchHealth {
  ok: boolean;
  /** True once labeling serves (weights + session warm). Search always serves. */
  ready: boolean;
  serving: boolean;
  weightsReady: boolean;
  sessionsWarm: boolean;
  downloading: boolean;
  /** 0..1 across the pending weight file (1 when idle). */
  downloadPct: number;
  catalog: SemanticCatalogStats;
  model: { file: string; bytes: number; license: string; url: string };
  error: string | null;
}

export interface SemanticSearchBody {
  q: string;
  limit: number;
}

export interface SemanticLabelBody {
  albumId: string;
}

export type SemanticSearchMode = "semantic" | "keyword";

export interface SemanticSearchHit {
  photoId: string;
  score: number;
  labelMatch: boolean;
}

export interface SemanticSearchResult {
  mode: SemanticSearchMode;
  /** Vocabulary labels the query mapped onto (empty in keyword mode). */
  matched: string[];
  results: SemanticSearchHit[];
}

export function semanticSearchDir(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env["F8_SEMANTIC_SEARCH_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(dataDir, SEMANTIC_SEARCH_MODEL_DIR_SUFFIX);
}

function semanticSearchUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env["F8_SEMANTIC_SEARCH_URL"];
  if (override && override.trim()) return override.trim();
  return SEMANTIC_SEARCH_DEFAULT_URL;
}

export function semanticSearchOffline(): boolean {
  return process.env["F8_SEMANTIC_SEARCH_OFFLINE"] === "1";
}

function ortAvailable(): boolean {
  try {
    require.resolve("onnxruntime-node");
    return true;
  } catch {
    return false;
  }
}

async function filePresent(filePath: string, minSize: number): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size >= minSize;
  } catch {
    return false;
  }
}

interface DownloadProgress {
  active: boolean;
  received: number;
  total: number;
}

const downloadProgress = new Map<string, DownloadProgress>();

function progressFor(dir: string): DownloadProgress {
  let progress = downloadProgress.get(dir);
  if (!progress) {
    progress = { active: false, received: 0, total: 0 };
    downloadProgress.set(dir, progress);
  }
  return progress;
}

interface NodeSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: number[] }>>;
  inputName: string;
  outputName: string;
}

const readyErrors = new Map<string, string>();
const readyJobs = new Map<string, Promise<void>>();
const nodeSessions = new Map<string, NodeSession>();

function weightsPath(dataDir: string): string {
  return path.join(semanticSearchDir(dataDir), SEMANTIC_SEARCH_FILE);
}

/**
 * Ensure the CLIP vision weights exist on disk, downloading once when missing.
 * Shared by the warmup path and the `yarn setup` prefetch (fetch-models.ts).
 */
export async function ensureSemanticSearchWeights(dataDir: string): Promise<string> {
  if (!ortAvailable()) throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  if (semanticSearchOffline()) throw new Error("Semantic-search provisioning is disabled (F8_SEMANTIC_SEARCH_OFFLINE=1).");
  const url = semanticSearchUrl();
  const dir = semanticSearchDir(dataDir);
  const dest = path.join(dir, SEMANTIC_SEARCH_FILE);
  if (await filePresent(dest, SEMANTIC_SEARCH_MIN_WEIGHT_BYTES)) return dest;
  const progress = progressFor(dir);
  progress.active = true;
  progress.received = 0;
  progress.total = SEMANTIC_SEARCH_FILE_SIZE;
  console.log(`[semantic-search] Downloading CLIP vision weights (~89MB) from ${url}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}.`);
    const tmp = `${dest}.part-${process.pid}`;
    const file = await fs.open(tmp, "w");
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await file.write(value);
          progress.received += value.length;
        }
      }
    } finally {
      await file.close();
    }
    const stat = await fs.stat(tmp).catch(() => null);
    if (!stat || stat.size < SEMANTIC_SEARCH_MIN_WEIGHT_BYTES) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error(`Model download incomplete (${stat?.size ?? 0} bytes).`);
    }
    await fs.rename(tmp, dest);
  } finally {
    progress.active = false;
  }
  console.log("[semantic-search] CLIP vision weights ready.");
  return dest;
}

/** Weights + session warm; rejects on download/session failure (routes answer 503). */
export async function ensureSemanticSearchReady(dataDir: string): Promise<void> {
  const dir = semanticSearchDir(dataDir);
  const pending = readyJobs.get(dir);
  if (pending) {
    await pending;
    return;
  }
  const job = (async (): Promise<void> => {
    const modelPath = await ensureSemanticSearchWeights(dataDir);
    await warmSession(modelPath);
    readyErrors.delete(dir);
  })();
  readyJobs.set(dir, job);
  try {
    await job;
  } catch (error) {
    readyErrors.set(dir, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    readyJobs.delete(dir);
  }
}

async function warmSession(modelPath: string): Promise<NodeSession> {
  const cached = nodeSessions.get(modelPath);
  if (cached) return cached;
  const mod = require("onnxruntime-node") as {
    InferenceSession: {
      create(
        p: string,
        o?: Record<string, unknown>,
      ): Promise<{
        run(f: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: number[] }>>;
        inputNames: string[];
        outputNames: string[];
      }>;
    };
  };
  const session = await mod.InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
  // First input/output by session order (verified: pixel_values,
  // image_embeds on the Xenova export) so URL overrides with renamed
  // tensors still serve; the 512-d parse rejects non-CLIP models per photo.
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error("Semantic model exposes no input/output.");
  const node: NodeSession = { run: (feeds) => session.run(feeds), inputName, outputName };
  nodeSessions.set(modelPath, node);
  return node;
}

/**
 * Session for already-downloaded weights; throws when the weights are
 * absent (callers skip or report needsDownload — this never downloads).
 */
export async function ensureSemanticSession(dataDir: string): Promise<NodeSession> {
  const dest = weightsPath(dataDir);
  if (!(await filePresent(dest, SEMANTIC_SEARCH_MIN_WEIGHT_BYTES))) {
    throw new Error("Semantic-search weights are not downloaded yet.");
  }
  if (!ortAvailable()) throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  return warmSession(dest);
}

export function kickSemanticSearchReady(dataDir: string): void {
  void ensureSemanticSearchReady(dataDir).catch((error: unknown) => {
    console.error("[semantic-search] Background readiness failed:", error instanceof Error ? error.message : error);
  });
}

export async function getSemanticSearchHealth(dataDir: string, stats?: SemanticCatalogStats): Promise<SemanticSearchHealth> {
  const dir = semanticSearchDir(dataDir);
  const dest = path.join(dir, SEMANTIC_SEARCH_FILE);
  const weightsReady = await filePresent(dest, SEMANTIC_SEARCH_MIN_WEIGHT_BYTES);
  const sessionsWarm = nodeSessions.has(dest);
  const progress = downloadProgress.get(dir);
  const downloading = progress?.active ?? false;
  const ready = weightsReady && sessionsWarm;
  return {
    ok: true,
    ready,
    serving: ready,
    weightsReady,
    sessionsWarm,
    downloading,
    downloadPct: downloading && progress && progress.total > 0 ? Math.min(1, progress.received / progress.total) : downloading ? 0 : 1,
    catalog: stats ?? { photos: 0, embedded: 0, mlLabeled: 0 },
    model: { file: SEMANTIC_SEARCH_FILE, bytes: SEMANTIC_SEARCH_FILE_SIZE, license: SEMANTIC_SEARCH_LICENSE, url: semanticSearchUrl() },
    error: readyErrors.get(dir) ?? null,
  };
}

export function validateSearchBody(body: unknown): { ok: true; value: SemanticSearchBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { q, limit } = body as Record<string, unknown>;
  if (typeof q !== "string" || !q.trim() || q.length > 120) return { ok: false, error: "Give a search query up to 120 characters." };
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 200)) {
    return { ok: false, error: "Invalid limit." };
  }
  return { ok: true, value: { q: q.trim(), limit: (limit as number | undefined) ?? SEMANTIC_SEARCH_MAX_RESULTS } };
}

export function validateLabelBody(body: unknown): { ok: true; value: SemanticLabelBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { albumId } = body as Record<string, unknown>;
  if (typeof albumId !== "string" || !albumId) return { ok: false, error: "Invalid album." };
  return { ok: true, value: { albumId } };
}

export function runSemanticSearch(store: Store, body: SemanticSearchBody): SemanticSearchResult {
  const concepts = conceptsOfQuery(body.q);
  if (concepts.length) {
    const query = queryEmbedding(concepts);
    const matched = new Set(concepts.map((hit) => hit.label));
    const embeddings = new Map(store.listEmbeddings().map((entry) => [entry.photoId, entry]));
    const photos = store.listPhotos();
    const labels = store.getLabelsBatch(photos.map((photo) => photo.id));
    const ranked = query
      ? rankSemanticPhotos(
        query,
        concepts,
        photos.map((photo) => {
          const stored = embeddings.get(photo.id);
          const current = stored && stored.model === SEMANTIC_SEARCH_MODEL_ID &&
              stored.version === SEMANTIC_SEARCH_MODEL_VERSION && stored.dim === SEMANTIC_SEARCH_DIM
            ? stored.embedding
            : null;
          return {
            id: photo.id,
            embedding: current,
            labels: (labels.get(photo.id) ?? []).map((entry) => entry.label),
          };
        }),
        body.limit,
      )
      : [];
    return { mode: "semantic", matched: [...matched], results: ranked };
  }
  // Open vocabulary: substring over labels + metadata, library order.
  const needle = body.q.toLowerCase();
  const photos = store.listPhotos();
  const labels = store.getLabelsBatch(photos.map((photo) => photo.id));
  const results: SemanticSearchHit[] = [];
  for (const photo of photos) {
    const haystack = `${(labels.get(photo.id) ?? []).map((entry) => entry.label).join(" ")} ${photo.filename} ${photo.title} ${photo.location} ${photo.camera}`.toLowerCase();
    if (haystack.includes(needle)) results.push({ photoId: photo.id, score: 1, labelMatch: false });
    if (results.length >= body.limit) break;
  }
  return { mode: "keyword", matched: [], results };
}

export interface EmbedContext {
  dataDir: string;
  previewsDir: string;
  tmpDir: string;
  store: Store;
  thumbDeps?: RawDecodeDeps;
  /**
   * Vision inference override (tests inject a stub so no weights are
   * needed); the default runs the warmed ONNX session. Input is packed
   * float32 NCHW at the CLIP grid; output is the raw pooled vector.
   */
  runVision?: (input: Float32Array) => Promise<ArrayLike<number>>;
}

function decodeThumbPixels(jpegBytes: Uint8Array): PixelImage | null {
  try {
    const decoded = jpeg.decode(jpegBytes, {
      useTArray: true,
      maxResolutionInMP: SEMANTIC_SEARCH_MAX_JPEG_MP,
      maxMemoryUsageInMB: 512,
    });
    if (!decoded || decoded.width <= 0 || decoded.height <= 0) return null;
    const data = decoded.data as Uint8Array | Uint8ClampedArray;
    if (data.length !== decoded.width * decoded.height * 4) return null;
    const clamped = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
    return { width: decoded.width, height: decoded.height, data: clamped };
  } catch {
    return null;
  }
}

/** Pixels for one photo: the cached grid thumb (always a small JPEG). */
export async function pixelsForPhoto(ctx: EmbedContext, row: PhotoRow): Promise<PixelImage | null> {
  if (row.kind !== "file" || !row.path || !row.hash) return null;
  const thumb = await ensureThumb({
    absPath: row.path,
    raw: row.raw === 1,
    hash: row.hash,
    previewsDir: ctx.previewsDir,
    tmpDir: ctx.tmpDir,
    deps: ctx.thumbDeps ?? defaultToolDeps,
  });
  if (!thumb) return null;
  const bytes = await fs.readFile(thumb).catch(() => null);
  if (!bytes) return null;
  return decodeThumbPixels(bytes);
}

async function defaultRunVision(dataDir: string, input: Float32Array): Promise<ArrayLike<number>> {
  const session = await ensureSemanticSession(dataDir);
  const mod = require("onnxruntime-node") as {
    Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
  };
  const results = await session.run({
    [session.inputName]: new mod.Tensor("float32", input, [1, 3, 224, 224]),
  });
  const first = results[session.outputName]?.data as ArrayLike<number> | undefined;
  if (!first) throw new Error("Semantic model returned no output.");
  return first;
}

export type EmbedSkipReason = "not-embeddable" | "embedded" | "no-thumbnail" | "no-pixels" | "no-weights";

export interface EmbedOutcome {
  photoId: string;
  /** Stored ML labels (empty only when the zero-shot came back flat). */
  labels: PhotoLabel[];
}

export async function embedPhoto(
  ctx: EmbedContext,
  photoId: string,
): Promise<{ ok: true; outcome: EmbedOutcome } | { ok: false; reason: EmbedSkipReason } | { ok: false; reason: "failed"; error: string }> {
  const row = ctx.store.getPhoto(photoId);
  if (!row || row.kind !== "file" || !row.path) return { ok: false, reason: "not-embeddable" };
  const existing = ctx.store.getEmbedding(photoId);
  if (
    existing && existing.model === SEMANTIC_SEARCH_MODEL_ID &&
    existing.version === SEMANTIC_SEARCH_MODEL_VERSION && existing.dim === SEMANTIC_SEARCH_DIM
  ) {
    return { ok: false, reason: "embedded" };
  }
  const pixels = await pixelsForPhoto(ctx, row);
  if (!pixels) {
    // Distinguish "no thumb at all" (encoder missing) from "thumb exists
    // but undecodable" for honest per-photo reporting.
    const thumbExists = await fs.stat(path.join(ctx.previewsDir, `${row.hash}-thumb2.jpg`)).then(() => true).catch(() => false);
    return { ok: false, reason: thumbExists ? "no-pixels" : "no-thumbnail" };
  }
  let embedding: Float32Array;
  try {
    const packed = packSemanticInput(pixels);
    const raw = ctx.runVision
      ? await ctx.runVision(packed.data)
      : await defaultRunVision(ctx.dataDir, packed.data);
    embedding = parseSemanticOutput(raw);
  } catch (error) {
    if (!ctx.runVision && error instanceof Error && error.message === "Semantic-search weights are not downloaded yet.") {
      return { ok: false, reason: "no-weights" };
    }
    return { ok: false, reason: "failed", error: error instanceof Error ? error.message : String(error) };
  }
  ctx.store.saveEmbedding(photoId, SEMANTIC_SEARCH_MODEL_ID, SEMANTIC_SEARCH_MODEL_VERSION, embedding);
  const labels = assignSemanticLabels(embedding);
  // Scoped to the concept vocabulary: cull-assist flags share the ML label
  // table and must survive a semantic pass (and vice versa).
  ctx.store.setMlLabels(photoId, labels, { only: SEMANTIC_CONCEPT_VOCAB });
  return { ok: true, outcome: { photoId, labels } };
}

export class SemanticWeightsMissingError extends Error {
  constructor() {
    super("The ML model (~89MB) is not downloaded yet. Download it once to label photos.");
    this.name = "SemanticWeightsMissingError";
  }
}

export interface LabelAlbumReport {
  albumId: string;
  /** Photos embedded + labeled by this run. */
  labeled: string[];
  /** Photos that already carried ML labels (never re-embedded). */
  alreadyLabeled: string[];
  /** Attempted but skipped (no thumbnail, undecodable, not a file). */
  skipped: { photoId: string; reason: string }[];
  /** Attempted but errored (inference/parse failure). */
  failed: { photoId: string; error: string }[];
}

/**
 * Embed + label every photo in one album that lacks ML labels. Throws
 * SemanticWeightsMissingError when the weights are absent (the route answers
 * 503 with needsDownload) — labeling never guesses without the model.
 */
export async function labelAlbum(ctx: EmbedContext, albumId: string): Promise<LabelAlbumReport> {
  const album = ctx.store.getAlbum(albumId);
  if (!album) throw new RangeError("Album not found.");
  if (!ctx.runVision) {
    const dest = weightsPath(ctx.dataDir);
    if (!(await filePresent(dest, SEMANTIC_SEARCH_MIN_WEIGHT_BYTES))) throw new SemanticWeightsMissingError();
    await ensureSemanticSession(ctx.dataDir);
  }
  const inAlbum = ctx.store.listPhotos().filter((photo) => photo.album_id === albumId).map((photo) => photo.id);
  const targets = new Set(ctx.store.listUnlabeledMl(inAlbum));
  const report: LabelAlbumReport = { albumId, labeled: [], alreadyLabeled: [], skipped: [], failed: [] };
  for (const photoId of inAlbum) {
    if (!targets.has(photoId)) {
      report.alreadyLabeled.push(photoId);
      continue;
    }
    const result = await embedPhoto(ctx, photoId);
    if (result.ok) {
      report.labeled.push(photoId);
    } else if (result.reason === "embedded") {
      // Raced the background queue (or a re-run): embedding landed without
      // labels, so make sure the labels land too before counting it done.
      const stored = ctx.store.getEmbedding(photoId);
      if (stored) ctx.store.setMlLabels(photoId, assignSemanticLabels(stored.embedding), { only: SEMANTIC_CONCEPT_VOCAB });
      report.labeled.push(photoId);
    } else if (result.reason === "failed") {
      report.failed.push({ photoId, error: result.error });
    } else {
      report.skipped.push({ photoId, reason: result.reason });
    }
    // Hundreds of sequential embeds never starve the event loop.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return report;
}

export interface SemanticQueue {
  enqueue: (photoId: string) => void;
  depth: () => number;
  /** Resolve once the queue drains (a test seam; production never awaits it). */
  idle: () => Promise<void>;
}

/**
 * Import-time embedding queue: fire-and-forget, sequential, amortized. Each
 * import enqueues its photo id; the processor embeds one photo at a time in
 * the background. Weights absent (or downloads disabled) drains silently —
 * imports never wait on, download, or fail for ML. Every failure is
 * per-photo: the queue always moves on.
 */
export function createSemanticQueue(ctx: EmbedContext): SemanticQueue {
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
            const result = await embedPhoto(ctx, photoId);
            if (!result.ok && result.reason === "no-weights") {
              // Weights cannot appear mid-drain (only warmup downloads),
              // so drop the backlog instead of failing it one by one.
              pending.length = 0;
              seen.clear();
              break;
            }
          } catch (error) {
            console.warn(`[semantic-search] Background embed of ${photoId} failed:`, error instanceof Error ? error.message : error);
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
