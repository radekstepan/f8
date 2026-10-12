import { randomUUID } from "node:crypto";
import { promises as fs, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { CULL_ASSIST_VERSION, CULL_LABELS, SEMANTIC_CONCEPT_VOCAB } from "@f8/core";
import type { PixelImage } from "@f8/core";
import { openDatabase } from "./db.ts";
import { createTestContext, makeBmp, makeJpeg } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";
import { assessPhoto, createCullQueue, cullAlbum, validateCullBody, type CullContext } from "./cull-assist.ts";
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

function testPixels(width: number, height: number, fill: (x: number, y: number) => number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Sharp textured pixels (high Laplacian, keeper-grade aesthetic). */
const sharpPixels = (): PixelImage =>
  testPixels(32, 32, (x, y) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? 0 : 255));

/** Flat pixels (zero Laplacian, blurry, low aesthetic). */
const softPixels = (): PixelImage => testPixels(32, 32, () => 128);

describe("cull assist", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.close();
  });

  const cullCtx = (pixelsFor?: CullContext["pixelsFor"]): CullContext => ({
    dataDir: path.join(ctx.dir, "data"),
    previewsDir: path.join(ctx.dir, "data", "previews"),
    tmpDir: path.join(ctx.dir, "data", "tmp"),
    store: ctx.store,
    thumbDeps: { which: async () => null, run: async () => ({ status: 1, stderr: "no encoder" }) },
    ...(pixelsFor ? { pixelsFor } : {}),
  });

  function filePhoto(pixelsById: Map<string, PixelImage>, overrides: Partial<PhotoRow> = {}): PhotoRow {
    const row = photoRow(overrides);
    const absPath = path.join(ctx.dir, `${row.id}.jpg`);
    writeFileSync(absPath, makeJpeg(64, 48));
    row.path = absPath;
    ctx.store.insertPhoto(row);
    pixelsById.set(row.id, (overrides.id ?? "").includes("soft") ? softPixels() : sharpPixels());
    return row;
  }

  /** File photo with a decodable cached thumb (bypasses the encoder toolchain). */
  async function filePhotoWithThumb(overrides: Partial<PhotoRow> = {}): Promise<PhotoRow> {
    const row = photoRow(overrides);
    const absPath = path.join(ctx.dir, `${row.id}.jpg`);
    await fs.writeFile(absPath, makeJpeg(64, 48));
    row.path = absPath;
    ctx.store.insertPhoto(row);
    await fs.mkdir(path.join(ctx.dir, "data", "previews"), { recursive: true });
    const data = Buffer.alloc(16 * 12 * 4);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        const value = (x + y) % 2 === 0 ? 0 : 255;
        const i = (y * 16 + x) * 4;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }
    }
    await fs.writeFile(
      path.join(ctx.dir, "data", "previews", `${row.hash}-thumb2.jpg`),
      jpeg.encode({ width: 16, height: 12, data }, 80).data,
    );
    return row;
  }

  it("migrates a v2 catalog to v3 without losing photos", async () => {
    const row = photoRow({ id: "keep-me" });
    ctx.store.insertPhoto(row);
    const dbPath = path.join(ctx.dir, "data", "f8.db");
    // Downgrade in place: drop the v3 tables, stamp version 2, reopen.
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    try {
      raw.exec("DROP TABLE photo_cull_labels; DROP TABLE photo_cull; UPDATE meta SET value = '2' WHERE key = 'schema_version';");
    } finally {
      raw.close();
    }
    const reopened = openDatabase(dbPath);
    try {
      const version = (reopened.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value;
      expect(version).toBe("3");
      const tables = (reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('photo_cull', 'photo_cull_labels')").all() as { name: string }[]).map((entry) => entry.name).sort();
      expect(tables).toEqual(["photo_cull", "photo_cull_labels"]);
      expect((reopened.prepare("SELECT id FROM photos WHERE id = 'keep-me'").get() as { id: string }).id).toBe("keep-me");
    } finally {
      reopened.close();
    }
  });

  it("round-trips cull assessments through the store", () => {
    expect(ctx.store.getCull("absent")).toBeUndefined();
    expect(ctx.store.countCull()).toBe(0);
    ctx.store.saveCull("hash-a", { blur: 512.5, blurry: false, phash: "0123456789abcdef", aesthetic: 0.9, version: CULL_ASSIST_VERSION });
    ctx.store.saveCull("hash-b", { blur: 3.25, blurry: true, phash: "ffffffffffffffff", aesthetic: 0.2, version: CULL_ASSIST_VERSION });
    expect(ctx.store.getCull("hash-a")).toMatchObject({ hash: "hash-a", blur: 512.5, blurry: false, aesthetic: 0.9 });
    expect(ctx.store.listCull(["hash-a", "hash-b", "absent"]).size).toBe(2);
    expect(ctx.store.countCull()).toBe(2);
    // Re-save overwrites idempotently.
    ctx.store.saveCull("hash-a", { blur: 1, blurry: true, phash: "0000000000000000", aesthetic: 0.1, version: CULL_ASSIST_VERSION });
    expect(ctx.store.getCull("hash-a")).toMatchObject({ blur: 1, blurry: true });
    expect(ctx.store.countCull()).toBe(2);
  });

  it("tracks cull-labeled photos", () => {
    for (const id of ["p1", "p2", "p3"]) ctx.store.insertPhoto(photoRow({ id }));
    expect(ctx.store.isCullLabeled("p1")).toBe(false);
    expect(ctx.store.listCullLabeled(["p1", "p2"])).toEqual(new Set());
    ctx.store.markCullLabeled("p1");
    ctx.store.markCullLabeled(["p2", "p3"]);
    ctx.store.markCullLabeled([]);
    expect(ctx.store.isCullLabeled("p1")).toBe(true);
    expect(ctx.store.listCullLabeled(["p1", "p2", "p3", "p4"])).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("scopes ML label writes per feature without touching user labels", () => {
    ctx.store.insertPhoto(photoRow({ id: "p1" }));
    ctx.store.setMlLabels("p1", [{ label: "beach", score: 0.9, source: "ml" }]);
    ctx.store.setMlLabels("p1", [{ label: "blurry", score: 0.8, source: "ml" }], { only: [...CULL_LABELS] });
    // The cull write kept the semantic label.
    expect(ctx.store.getLabels("p1").map((entry) => entry.label).sort()).toEqual(["beach", "blurry"]);
    // A semantic re-pass keeps the cull flag.
    ctx.store.setMlLabels("p1", [{ label: "mountain", score: 0.7, source: "ml" }], { only: SEMANTIC_CONCEPT_VOCAB });
    expect(ctx.store.getLabels("p1").map((entry) => entry.label).sort()).toEqual(["blurry", "mountain"]);
    // A hand-added flag wins over the ML twin.
    ctx.store.addUserLabel("p1", "blurry");
    ctx.store.setMlLabels("p1", [{ label: "blurry", score: 0.5, source: "ml" }], { only: [...CULL_LABELS] });
    expect(ctx.store.getLabels("p1").find((entry) => entry.label === "blurry")).toEqual({ label: "blurry", score: 1, source: "user" });
    // Unscoped writes still replace every ML label (the pre-cull contract).
    ctx.store.setMlLabels("p1", [{ label: "dog", score: 0.6, source: "ml" }]);
    expect(ctx.store.getLabels("p1").map((entry) => entry.label).sort()).toEqual(["blurry", "dog"]);
  });

  it("assesses pixels once per hash and never re-detects", async () => {
    const pixelsById = new Map<string, PixelImage>();
    const soft = filePhoto(pixelsById, { id: "soft-1", hash: "hash-soft-1" });
    let calls = 0;
    const pixelsFor = async (row: PhotoRow): Promise<PixelImage | null> => {
      calls++;
      return pixelsById.get(row.id) ?? null;
    };
    const first = await assessPhoto(cullCtx(pixelsFor), soft.id);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.outcome.blur).toBe(0);
      expect(first.outcome.blurry).toBe(true);
    }
    expect(calls).toBe(1);
    expect(ctx.store.getCull("hash-soft-1")?.blurry).toBe(true);
    // Second run short-circuits on the cache: pixels never re-read.
    const second = await assessPhoto(cullCtx(pixelsFor), soft.id);
    expect(second).toEqual({ ok: false, reason: "assessed" });
    expect(calls).toBe(1);
    // A stale algorithm version re-assesses instead of trusting the row.
    ctx.store.saveCull("hash-soft-1", { blur: 999, blurry: false, phash: "00", aesthetic: 1, version: "v0-ancient" });
    const third = await assessPhoto(cullCtx(pixelsFor), soft.id);
    expect(third.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("skips photos it cannot assess", async () => {
    const pixelsById = new Map<string, PixelImage>();
    const url = photoRow({ id: "url-1", kind: "url", hash: null, path: null, url: "https://example.com/u.jpg" });
    ctx.store.insertPhoto(url);
    expect(await assessPhoto(cullCtx(async () => sharpPixels()), url.id)).toEqual({ ok: false, reason: "not-assessable" });
    const thumbLess = filePhoto(pixelsById, { id: "thumb-less" });
    expect(await assessPhoto(cullCtx(async () => null), thumbLess.id)).toEqual({ ok: false, reason: "no-pixels" });
    // Skips cache nothing: a later pass retries honestly.
    expect(ctx.store.getCull(thumbLess.hash ?? "")).toBeUndefined();
    expect(ctx.store.isCullLabeled(thumbLess.id)).toBe(false);
  });

  it("assesses through real cached thumbs", async () => {
    const row = await filePhotoWithThumb({ id: "thumb-1" });
    const result = await assessPhoto(cullCtx(), row.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Checkerboard JPEG thumb: sharp with a well-formed hash.
      expect(result.outcome.blurry).toBe(false);
      expect(result.outcome.phash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("culls an album end to end: blur, duplicates, keepers", async () => {
    ctx.store.insertAlbum({ id: "a1", name: "Trip", cover: "", sort: 0 });
    const pixelsById = new Map<string, PixelImage>();
    // Identical sharp pixels: same hash, one near-duplicate group.
    filePhoto(pixelsById, { id: "dup-a", hash: "hash-dup-a", album_id: "a1" });
    filePhoto(pixelsById, { id: "dup-b", hash: "hash-dup-b", album_id: "a1" });
    filePhoto(pixelsById, { id: "soft-1", hash: "hash-soft-1", album_id: "a1" });
    let calls = 0;
    const pixelsFor = async (row: PhotoRow): Promise<PixelImage | null> => {
      calls++;
      return pixelsById.get(row.id) ?? null;
    };
    const report = await cullAlbum(cullCtx(pixelsFor), "a1");
    expect(report.albumId).toBe("a1");
    expect(report.assessed.sort()).toEqual(["dup-a", "dup-b", "soft-1"]);
    expect(report.alreadyAssessed).toEqual([]);
    expect(report.labeled.sort()).toEqual(["dup-a", "dup-b", "soft-1"]);
    expect(report.blurry).toEqual(["soft-1"]);
    // Identical metrics: the lowest id wins the group and keeps.
    expect(report.groups).toEqual([{ keeper: "dup-a", members: ["dup-a", "dup-b"] }]);
    expect(report.keepers).toEqual(["dup-a"]);
    expect(report.skipped).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(calls).toBe(3);
    expect(ctx.store.getLabels("dup-a")).toEqual([{ label: "keeper", score: expect.any(Number), source: "ml" }]);
    expect(ctx.store.getLabels("dup-b").map((entry) => entry.label)).toEqual(["duplicate"]);
    expect(ctx.store.getLabels("soft-1").map((entry) => entry.label)).toEqual(["blurry"]);

    // Re-run: nothing re-detected, nothing relabeled.
    const rerun = await cullAlbum(cullCtx(pixelsFor), "a1");
    expect(rerun.assessed).toEqual([]);
    expect(rerun.labeled).toEqual([]);
    expect(rerun.alreadyLabeled.sort()).toEqual(["dup-a", "dup-b", "soft-1"]);
    expect(calls).toBe(3);

    // A hand-removed flag stays removed: marked photos are never relabeled.
    expect(ctx.store.removeLabel("soft-1", "blurry")).toBe(true);
    const rerun2 = await cullAlbum(cullCtx(pixelsFor), "a1");
    expect(rerun2.alreadyLabeled).toContain("soft-1");
    expect(ctx.store.getLabels("soft-1")).toEqual([]);
    expect(calls).toBe(3);
  });

  it("labels a reimported file from the cache without recomputing", async () => {
    ctx.store.insertAlbum({ id: "a1", name: "Trip", cover: "", sort: 0 });
    const pixelsById = new Map<string, PixelImage>();
    filePhoto(pixelsById, { id: "soft-old", hash: "hash-reimport", album_id: "a1" });
    let calls = 0;
    const pixelsFor = async (row: PhotoRow): Promise<PixelImage | null> => {
      calls++;
      return pixelsById.get(row.id) ?? null;
    };
    await cullAlbum(cullCtx(pixelsFor), "a1");
    expect(calls).toBe(1);
    // Delete (cascades the photo's labels + marker) and reimport the same bytes.
    ctx.store.deletePhoto("soft-old");
    pixelsById.set("soft-new", softPixels());
    const stamp = new Date().toISOString();
    ctx.store.insertPhoto(photoRow({ id: "soft-new", hash: "hash-reimport", album_id: "a1", path: path.join(ctx.dir, "soft-new.jpg"), created_at: stamp, updated_at: stamp }));
    const report = await cullAlbum(cullCtx(pixelsFor), "a1");
    expect(report.assessed).toEqual([]);
    expect(report.alreadyAssessed).toEqual(["soft-new"]);
    expect(report.labeled).toEqual(["soft-new"]);
    expect(report.blurry).toEqual(["soft-new"]);
    expect(calls).toBe(1);
  });

  it("validates the cull body and rejects unknown albums", async () => {
    expect(validateCullBody({ albumId: "a1" })).toEqual({ ok: true, value: { albumId: "a1" } });
    for (const bad of [null, {}, { albumId: "" }, { albumId: 42 }, []]) {
      expect(validateCullBody(bad).ok).toBe(false);
    }
    await expect(cullAlbum(cullCtx(), "missing")).rejects.toThrow(RangeError);
  });

  it("culls over HTTP", async () => {
    ctx.store.insertAlbum({ id: "a1", name: "Trip", cover: "", sort: 0 });
    await filePhotoWithThumb({ id: "http-1", hash: "hash-http-1", album_id: "a1" });
    const response = await ctx.app.request("/api/cull-assist/cull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId: "a1" }),
    });
    expect(response.status).toBe(200);
    const report = await json<{ assessed: string[]; labeled: string[]; keepers: string[] }>(response);
    expect(report.assessed).toEqual(["http-1"]);
    expect(report.labeled).toEqual(["http-1"]);
    expect(report.keepers).toEqual(["http-1"]);
    const bad = await ctx.app.request("/api/cull-assist/cull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId: "" }),
    });
    expect(bad.status).toBe(400);
    const missing = await ctx.app.request("/api/cull-assist/cull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId: "nope" }),
    });
    expect(missing.status).toBe(404);
  });

  it("queues fresh imports for culling but not duplicates", async () => {
    const seen: string[] = [];
    const spy = createTestContext({ cullEnqueue: (photoId: string) => void seen.push(photoId) });
    try {
      const bytes = makeBmp(11, 7);
      const headers = { "Content-Type": "application/octet-stream", "X-Filename": "drop.bmp" };
      const first = await json<{ photo: { id: string }; deduplicated: boolean }>(
        await spy.app.request("/api/imports/upload", { method: "POST", headers, body: bytes }),
      );
      expect(first.deduplicated).toBe(false);
      expect(seen).toEqual([first.photo.id]);
      const second = await json<{ photo: { id: string }; deduplicated: boolean }>(
        await spy.app.request("/api/imports/upload", { method: "POST", headers, body: bytes }),
      );
      expect(second.deduplicated).toBe(true);
      expect(seen).toHaveLength(1);
    } finally {
      spy.close();
    }
  });

  it("drains the import queue in the background", async () => {
    ctx.store.insertAlbum({ id: "a1", name: "Trip", cover: "", sort: 0 });
    const pixelsById = new Map<string, PixelImage>();
    filePhoto(pixelsById, { id: "q-soft", hash: "hash-q-soft", album_id: "a1" });
    const queue = createCullQueue(cullCtx(async (row) => pixelsById.get(row.id) ?? null));
    // Unknown ids drain silently; the photo gets assessed + labeled + marked.
    queue.enqueue("ghost");
    queue.enqueue("q-soft");
    queue.enqueue("q-soft");
    await queue.idle();
    expect(ctx.store.getCull("hash-q-soft")?.blurry).toBe(true);
    expect(ctx.store.getLabels("q-soft").map((entry) => entry.label)).toEqual(["blurry"]);
    expect(ctx.store.isCullLabeled("q-soft")).toBe(true);
    expect(queue.depth()).toBe(0);
    await queue.idle();
  });
});
