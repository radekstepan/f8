import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import {
  SEMANTIC_SEARCH_DIM,
  SEMANTIC_SEARCH_FILE,
  SEMANTIC_SEARCH_MODEL_ID,
  SEMANTIC_SEARCH_MODEL_VERSION,
  normalizeEmbedding,
  semanticConceptVector,
} from "@f8/core";
import type { LibraryPhoto, LibrarySnapshot } from "@f8/core";
import { openDatabase } from "./db.ts";
import { createTestContext, makeBmp, makeJpeg } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";
import {
  createSemanticQueue,
  embedPhoto,
  getSemanticSearchHealth,
  labelAlbum,
  SemanticWeightsMissingError,
  validateLabelBody,
  validateSearchBody,
  type EmbedContext,
} from "./semantic-search.ts";
import type { PhotoRow } from "./store.ts";

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function photoRow(overrides: Partial<PhotoRow> = {}): PhotoRow {
  const stamp = new Date().toISOString();
  return {
    id: randomUUID(),
    hash: randomUUID().replace(/-/g, ""),
    kind: "file",
    path: null,
    url: null,
    thumbnail_url: null,
    filename: "photo.jpg",
    title: "photo",
    width: 64,
    height: 48,
    camera: "",
    lens: "",
    iso: 0,
    aperture: "-",
    shutter: "-",
    focal_length: "-",
    date_taken: stamp,
    location: "",
    raw: 0,
    favorite: 0,
    rating: 0,
    album_id: "imports",
    photographer: null,
    file_size: 10,
    mtime: 0,
    created_at: stamp,
    updated_at: stamp,
    ...overrides,
  };
}

/** A real 8x6 JPEG thumb, so the embed pipeline decodes honest bytes. */
function thumbBytes(): Buffer {
  const data = Buffer.alloc(8 * 6 * 4, 128);
  return jpeg.encode({ width: 8, height: 6, data }, 80).data;
}

describe("semantic search", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.close();
  });

  const embedCtx = (runVision?: EmbedContext["runVision"]): EmbedContext => ({
    dataDir: path.join(ctx.dir, "data"),
    previewsDir: path.join(ctx.dir, "data", "previews"),
    tmpDir: path.join(ctx.dir, "data", "tmp"),
    store: ctx.store,
    thumbDeps: { which: async () => null, run: async () => ({ status: 1, stderr: "no encoder" }) },
    ...(runVision ? { runVision } : {}),
  });

  /** File photo with a decodable cached thumb (bypasses the encoder toolchain). */
  async function filePhotoWithThumb(overrides: Partial<PhotoRow> = {}): Promise<PhotoRow> {
    const row = photoRow(overrides);
    const absPath = path.join(ctx.dir, `${row.id}.jpg`);
    await fs.writeFile(absPath, makeJpeg(64, 48));
    row.path = absPath;
    ctx.store.insertPhoto(row);
    await fs.mkdir(path.join(ctx.dir, "data", "previews"), { recursive: true });
    await fs.writeFile(path.join(ctx.dir, "data", "previews", `${row.hash}-thumb2.jpg`), thumbBytes());
    return row;
  }

  it("migrates a v1 catalog to latest without losing photos", async () => {
    const row = photoRow({ id: "keep-me" });
    ctx.store.insertPhoto(row);
    const dbPath = path.join(ctx.dir, "data", "f8.db");
    // Downgrade in place: drop the v2 tables, stamp version 1, reopen. The
    // reopen runs every later migration (v2 semantic tables, v3 cull
    // tables, v4 keeper-flag cleanup), so the version and table asserts
    // track the latest schema.
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    try {
      raw.exec("DROP TABLE photo_labels; DROP TABLE photo_embeddings; UPDATE meta SET value = '1' WHERE key = 'schema_version';");
    } finally {
      raw.close();
    }
    const reopened = openDatabase(dbPath);
    try {
      const version = (reopened.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value;
      expect(version).toBe("4");
      const tables = (reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('photo_embeddings', 'photo_labels', 'photo_cull', 'photo_cull_labels')").all() as { name: string }[]).map((entry) => entry.name).sort();
      expect(tables).toEqual(["photo_cull", "photo_cull_labels", "photo_embeddings", "photo_labels"]);
      expect((reopened.prepare("SELECT id FROM photos WHERE id = 'keep-me'").get() as { id: string }).id).toBe("keep-me");
    } finally {
      reopened.close();
    }
  });

  it("round-trips embeddings through the store", () => {
    ctx.store.insertPhoto(photoRow({ id: "p1", hash: "hash-p1" }));
    const vector = semanticConceptVector(3);
    ctx.store.saveEmbedding("p1", SEMANTIC_SEARCH_MODEL_ID, SEMANTIC_SEARCH_MODEL_VERSION, vector);
    const stored = ctx.store.getEmbedding("p1");
    expect(stored?.model).toBe(SEMANTIC_SEARCH_MODEL_ID);
    expect(stored?.dim).toBe(SEMANTIC_SEARCH_DIM);
    expect(stored?.embedding.length).toBe(SEMANTIC_SEARCH_DIM);
    for (let i = 0; i < SEMANTIC_SEARCH_DIM; i += 61) {
      expect(stored?.embedding[i]).toBeCloseTo(vector[i] ?? 0, 6);
    }
    // Re-save overwrites; misses read back undefined.
    const other = semanticConceptVector(9);
    ctx.store.saveEmbedding("p1", SEMANTIC_SEARCH_MODEL_ID, SEMANTIC_SEARCH_MODEL_VERSION, other);
    expect(ctx.store.getEmbedding("p1")?.embedding[0]).toBeCloseTo(other[0] ?? 0, 6);
    expect(ctx.store.getEmbedding("absent")).toBeUndefined();
    expect(ctx.store.listEmbeddings()).toHaveLength(1);
    expect(ctx.store.countEmbeddings()).toBe(1);
  });

  it("manages labels with ML/user precedence", () => {
    ctx.store.insertPhoto(photoRow({ id: "p1", hash: "hash-p1" }));
    ctx.store.setMlLabels("p1", [
      { label: "beach", score: 0.8, source: "ml" },
      { label: "ocean", score: 0.3, source: "ml" },
    ]);
    expect(ctx.store.getLabels("p1").map((entry) => entry.label)).toEqual(["beach", "ocean"]);
    // Re-labeling replaces ML rows wholesale...
    ctx.store.setMlLabels("p1", [{ label: "mountain", score: 0.9, source: "ml" }]);
    expect(ctx.store.getLabels("p1").map((entry) => entry.label)).toEqual(["mountain"]);
    // ...but never touches user rows, even on text collision.
    ctx.store.addUserLabel("p1", "beach");
    ctx.store.setMlLabels("p1", [{ label: "beach", score: 0.7, source: "ml" }]);
    expect(ctx.store.getLabels("p1")).toEqual([{ label: "beach", score: 1, source: "user" }]);
    // Re-adding an ML label converts it to the user's.
    ctx.store.addUserLabel("p1", "mountain");
    expect(ctx.store.getLabels("p1")).toContainEqual({ label: "mountain", score: 1, source: "user" });
    expect(ctx.store.removeLabel("p1", "beach")).toBe(true);
    expect(ctx.store.removeLabel("p1", "beach")).toBe(false);
    expect(ctx.store.getLabels("absent")).toEqual([]);
  });

  it("finds unlabeled photos and batches labels", () => {
    const ids = Array.from({ length: 505 }, (_, i) => `photo-${i}`);
    for (const id of ids) ctx.store.insertPhoto(photoRow({ id, hash: `hash-${id}` }));
    ctx.store.setMlLabels("photo-0", [{ label: "beach", score: 0.9, source: "ml" }]);
    ctx.store.addUserLabel("photo-1", "mine");
    // User-only labels do not count as labeled (crosses the 500 IN-chunk).
    expect(ctx.store.listUnlabeledMl(ids)).toHaveLength(504);
    expect(ctx.store.listUnlabeledMl(ids)).not.toContain("photo-0");
    expect(ctx.store.listUnlabeledMl([])).toEqual([]);
    expect(ctx.store.countMlLabeled()).toBe(1);
    const batch = ctx.store.getLabelsBatch(ids);
    expect(batch.size).toBe(505);
    expect(batch.get("photo-0")).toEqual([{ label: "beach", score: 0.9, source: "ml" }]);
    expect(batch.get("photo-2")).toEqual([]);
    expect(ctx.store.getLabelsBatch([]).size).toBe(0);
  });

  it("deletes embeddings and labels with the photo", () => {
    const row = photoRow({ id: "doomed" });
    ctx.store.insertPhoto(row);
    ctx.store.saveEmbedding("doomed", SEMANTIC_SEARCH_MODEL_ID, SEMANTIC_SEARCH_MODEL_VERSION, semanticConceptVector(1));
    ctx.store.setMlLabels("doomed", [{ label: "dog", score: 0.9, source: "ml" }]);
    ctx.store.deletePhoto("doomed");
    expect(ctx.store.getEmbedding("doomed")).toBeUndefined();
    expect(ctx.store.getLabels("doomed")).toEqual([]);
  });

  it("validates search and label bodies", () => {
    expect(validateSearchBody({ q: "beach" })).toEqual({ ok: true, value: { q: "beach", limit: 50 } });
    expect(validateSearchBody({ q: "  dog  ", limit: 5 })).toEqual({ ok: true, value: { q: "dog", limit: 5 } });
    expect(validateSearchBody({ q: "" }).ok).toBe(false);
    expect(validateSearchBody({ q: "x".repeat(121) }).ok).toBe(false);
    expect(validateSearchBody({ q: "beach", limit: 0 }).ok).toBe(false);
    expect(validateSearchBody(null).ok).toBe(false);
    expect(validateLabelBody({ albumId: "a1" }).ok).toBe(true);
    expect(validateLabelBody({}).ok).toBe(false);
    expect(validateLabelBody(null).ok).toBe(false);
  });

  it("searches semantically over mocked embeddings and by keyword", async () => {
    const clockIdx = (await import("@f8/core")).SEMANTIC_CONCEPT_LABELS.indexOf("clock");
    const clockVector = normalizeEmbedding(semanticConceptVector(clockIdx));
    // Far from every concept: the hit floors keep it out of the results.
    const far = normalizeEmbedding(Float32Array.from({ length: SEMANTIC_SEARCH_DIM }, (_, i) => (i % 2 === 0 ? 1 : -1)));
    const a = photoRow({ id: "clock-photo", filename: "IMG_1.jpg", title: "one" });
    const b = photoRow({ id: "other-photo", filename: "beach-day.jpg", title: "two" });
    ctx.store.insertPhoto(a);
    ctx.store.insertPhoto(b);
    ctx.store.saveEmbedding("clock-photo", SEMANTIC_SEARCH_MODEL_ID, SEMANTIC_SEARCH_MODEL_VERSION, clockVector);
    ctx.store.saveEmbedding("other-photo", SEMANTIC_SEARCH_MODEL_ID, SEMANTIC_SEARCH_MODEL_VERSION, far);
    ctx.store.setMlLabels("clock-photo", [{ label: "clock", score: 0.9, source: "ml" }]);

    const semantic = await json<{ mode: string; matched: string[]; results: { photoId: string; score: number }[] }>(
      await ctx.app.request("/api/semantic-search/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "clock" }),
      }),
    );
    expect(semantic.mode).toBe("semantic");
    expect(semantic.matched).toEqual(["clock"]);
    expect(semantic.results.map((entry) => entry.photoId)).toEqual(["clock-photo"]);
    expect(semantic.results[0]?.score).toBeGreaterThan(0.24);

    // No vocabulary hit ("day" names no concept): substring over labels +
    // metadata, library order.
    const keyword = await json<{ mode: string; results: { photoId: string }[] }>(
      await ctx.app.request("/api/semantic-search/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "day" }),
      }),
    );
    expect(keyword.mode).toBe("keyword");
    expect(keyword.results.map((entry) => entry.photoId)).toEqual(["other-photo"]);

    const bad = await ctx.app.request("/api/semantic-search/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "" }),
    });
    expect(bad.status).toBe(400);
  });

  it("labels only the unlabeled photos in an album", async () => {
    ctx.store.insertAlbum({ id: "a1", name: "Trip", cover: "", sort: 0 });
    const labeled = await filePhotoWithThumb({ album_id: "a1" });
    const fresh = await filePhotoWithThumb({ album_id: "a1" });
    const elsewhere = await filePhotoWithThumb({ album_id: "imports" });
    const urlRow = photoRow({ id: "url-photo", kind: "url", path: null, url: "https://example.com/x.jpg", album_id: "a1" });
    ctx.store.insertPhoto(urlRow);
    ctx.store.setMlLabels(labeled.id, [{ label: "beach", score: 0.9, source: "ml" }]);
    let calls = 0;
    const runVision = async (): Promise<ArrayLike<number>> => {
      calls += 1;
      return semanticConceptVector(0);
    };
    const report = await labelAlbum(embedCtx(runVision), "a1");
    expect(report.labeled).toEqual([fresh.id]);
    expect(report.alreadyLabeled).toEqual([labeled.id]);
    expect(report.skipped).toEqual([{ photoId: urlRow.id, reason: "not-embeddable" }]);
    expect(report.failed).toEqual([]);
    expect(calls).toBe(1);
    expect(ctx.store.getEmbedding(fresh.id)?.dim).toBe(SEMANTIC_SEARCH_DIM);
    expect(ctx.store.getLabels(fresh.id).length).toBeGreaterThan(0);
    // The other album is untouched, and a re-run labels nothing new.
    expect(ctx.store.getEmbedding(elsewhere.id)).toBeUndefined();
    const rerun = await labelAlbum(embedCtx(runVision), "a1");
    expect(rerun.labeled).toEqual([]);
    expect(rerun.alreadyLabeled.sort()).toEqual([fresh.id, labeled.id].sort());
    expect(calls).toBe(1);
    await expect(labelAlbum(embedCtx(runVision), "missing")).rejects.toThrow(RangeError);
  });

  it("skips embedding when already embedded without relabeling twice", async () => {
    const row = await filePhotoWithThumb();
    ctx.store.saveEmbedding(row.id, SEMANTIC_SEARCH_MODEL_ID, SEMANTIC_SEARCH_MODEL_VERSION, semanticConceptVector(2));
    let calls = 0;
    const result = await embedPhoto(embedCtx(async () => {
      calls += 1;
      return semanticConceptVector(2);
    }), row.id);
    expect(result).toEqual({ ok: false, reason: "embedded" });
    expect(calls).toBe(0);
  });

  it("reports needsDownload honestly when weights are absent", async () => {
    ctx.store.insertAlbum({ id: "a1", name: "Trip", cover: "", sort: 0 });
    await expect(labelAlbum(embedCtx(), "a1")).rejects.toBeInstanceOf(SemanticWeightsMissingError);
    const response = await ctx.app.request("/api/semantic-search/label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId: "a1" }),
    });
    expect(response.status).toBe(503);
    const body = await json<{ needsDownload: boolean; weightsReady: boolean }>(response);
    expect(body.needsDownload).toBe(true);
    expect(body.weightsReady).toBe(false);
    const missing = await ctx.app.request("/api/semantic-search/label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId: "nope" }),
    });
    expect(missing.status).toBe(404);
  });

  it("drains the import queue silently with no weights (offline skip)", async () => {
    const row = await filePhotoWithThumb();
    const queue = createSemanticQueue(embedCtx());
    queue.enqueue(row.id);
    queue.enqueue(row.id);
    expect(queue.depth()).toBeLessThanOrEqual(1);
    await queue.idle();
    // Nothing downloaded, nothing stored, nothing thrown.
    expect(ctx.store.getEmbedding(row.id)).toBeUndefined();
    expect(ctx.store.getLabels(row.id)).toEqual([]);
    expect(queue.depth()).toBe(0);
  });

  it("embeds through the import queue when vision serves", async () => {
    const row = await filePhotoWithThumb();
    const queue = createSemanticQueue(embedCtx(async () => semanticConceptVector(4)));
    queue.enqueue(row.id);
    await queue.idle();
    expect(ctx.store.getEmbedding(row.id)?.dim).toBe(SEMANTIC_SEARCH_DIM);
    expect(ctx.store.getLabels(row.id).length).toBeGreaterThan(0);
  });

  it("enqueues fresh imports but not duplicates", async () => {
    const seen: string[] = [];
    const spy = createTestContext({ semanticEnqueue: (photoId: string) => void seen.push(photoId) });
    try {
      const bytes = makeBmp(11, 7);
      const first = await json<{ photo: LibraryPhoto; deduplicated: boolean }>(
        await spy.app.request("/api/imports/upload", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "X-Filename": "drop.bmp" },
          body: bytes,
        }),
      );
      expect(first.deduplicated).toBe(false);
      expect(seen).toEqual([first.photo.id]);
      await spy.app.request("/api/imports/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": "renamed.bmp" },
        body: bytes,
      });
      expect(seen).toHaveLength(1);
    } finally {
      spy.close();
    }
  });

  it("reports health with catalog counts and the model identity", async () => {
    const row = photoRow({ id: "h1" });
    ctx.store.insertPhoto(row);
    ctx.store.saveEmbedding("h1", SEMANTIC_SEARCH_MODEL_ID, SEMANTIC_SEARCH_MODEL_VERSION, semanticConceptVector(5));
    ctx.store.setMlLabels("h1", [{ label: "dog", score: 0.9, source: "ml" }]);
    const health = await json<{
      ok: boolean; ready: boolean; weightsReady: boolean; sessionsWarm: boolean;
      catalog: { photos: number; embedded: number; mlLabeled: number };
      model: { file: string; bytes: number; license: string; url: string };
    }>(await ctx.app.request("/api/semantic-search/health"));
    expect(health.ok).toBe(true);
    expect(health.weightsReady).toBe(false);
    expect(health.sessionsWarm).toBe(false);
    expect(health.ready).toBe(false);
    expect(health.catalog).toEqual({ photos: 1, embedded: 1, mlLabeled: 1 });
    expect(health.model.file).toBe(SEMANTIC_SEARCH_FILE);
    expect(health.model.bytes).toBeGreaterThan(80_000_000);
    expect(health.model.license).toContain("CLIP");
    expect(health.model.url).toContain("clip-vit-base-patch32");
    const direct = await getSemanticSearchHealth(path.join(ctx.dir, "data"));
    expect(direct.catalog).toEqual({ photos: 0, embedded: 0, mlLabeled: 0 });
  });

  it("adds and removes labels over HTTP", async () => {
    const row = photoRow({ id: "lp1" });
    ctx.store.insertPhoto(row);
    ctx.store.setMlLabels("lp1", [{ label: "beach", score: 0.8, source: "ml" }]);
    const added = await json<{ photo: LibraryPhoto }>(
      await ctx.app.request("/api/photos/lp1/labels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: ["  Golden Gate "] }),
      }),
    );
    expect(added.photo.labels).toContainEqual({ label: "golden gate", score: 1, source: "user" });
    expect(added.photo.labels).toContainEqual({ label: "beach", score: 0.8, source: "ml" });
    const removed = await json<{ photo: LibraryPhoto }>(
      await ctx.app.request("/api/photos/lp1/labels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remove: ["beach"] }),
      }),
    );
    expect(removed.photo.labels.map((entry) => entry.label)).toEqual(["golden gate"]);
    const bad = await ctx.app.request("/api/photos/lp1/labels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ add: ["nope!"] }),
    });
    expect(bad.status).toBe(400);
    const empty = await ctx.app.request("/api/photos/lp1/labels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
    const missing = await ctx.app.request("/api/photos/none/labels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ add: ["x"] }),
    });
    expect(missing.status).toBe(404);
  });

  it("serves labels with the library", async () => {
    const row = photoRow({ id: "lib1" });
    ctx.store.insertPhoto(row);
    ctx.store.setMlLabels("lib1", [{ label: "dog", score: 0.7, source: "ml" }]);
    const library = await json<LibrarySnapshot>(await ctx.app.request("/api/library"));
    expect(library.photos.find((photo) => photo.id === "lib1")?.labels).toEqual([
      { label: "dog", score: 0.7, source: "ml" },
    ]);
  });
});
