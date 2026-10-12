import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImportReport, LibraryPhoto } from "@photomator/core";
import { createTestContext, makeBmp, makeJpeg, makeTiffWithJpeg } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";
import type { RawDecodeDeps } from "./raw-decode.ts";
import { ensureThumb, thumbPathFor } from "./thumbs.ts";

const noEncoder: RawDecodeDeps = {
  which: async () => null,
  run: async () => {
    throw new Error("must not spawn");
  },
};

function stubEncoder(jpeg = makeJpeg(9, 7)): { deps: RawDecodeDeps; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  return {
    calls,
    deps: {
      which: async (cmd) => (cmd === "magick" ? "/bin/magick" : null),
      run: async (cmd, args) => {
        calls.push({ cmd, args });
        await fs.writeFile(args[args.length - 1] as string, jpeg);
        return { status: 0, stderr: "" };
      },
    },
  };
}

describe("ensureThumb", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.close();
  });

  it("slices the embedded JPEG out of a RAW file and caches it by hash", async () => {
    const file = path.join(ctx.dir, "frame.CR2");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12));
    const previewsDir = path.join(ctx.dir, "data", "previews");
    const tmpDir = path.join(ctx.dir, "data", "tmp");

    const thumb = await ensureThumb({ absPath: file, raw: true, hash: "abc123", previewsDir, tmpDir, deps: noEncoder });

    expect(thumb).toBe(thumbPathFor(previewsDir, "abc123"));
    expect(await fs.readFile(thumb as string)).toEqual(makeJpeg(17, 12));
    // Cached: the second call resolves without touching the toolchain or the file.
    const again = await ensureThumb({
      absPath: path.join(ctx.dir, "gone.CR2"),
      raw: true,
      hash: "abc123",
      previewsDir,
      tmpDir,
      deps: noEncoder,
    });
    expect(again).toBe(thumb);
  });

  it("returns null for RAW files with no embedded preview", async () => {
    const file = path.join(ctx.dir, "flat.CR2");
    await fs.writeFile(file, makeBmp(5, 4));
    const previewsDir = path.join(ctx.dir, "data", "previews");

    const thumb = await ensureThumb({
      absPath: file, raw: true, hash: "nope", previewsDir, tmpDir: path.join(ctx.dir, "data", "tmp"), deps: noEncoder,
    });

    expect(thumb).toBeNull();
    expect(await fs.readdir(previewsDir).catch(() => [])).toEqual([]);
  });

  it("downscales rendered originals through the encoder and cleans up", async () => {
    const file = path.join(ctx.dir, "photo.bmp");
    await fs.writeFile(file, makeBmp(40, 30));
    const { deps, calls } = stubEncoder();
    const previewsDir = path.join(ctx.dir, "data", "previews");
    const tmpDir = path.join(ctx.dir, "data", "tmp");

    const thumb = await ensureThumb({ absPath: file, raw: false, hash: "rendered", previewsDir, tmpDir, deps });

    expect(thumb).toBe(thumbPathFor(previewsDir, "rendered"));
    expect(await fs.readFile(thumb as string)).toEqual(makeJpeg(9, 7));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe("/bin/magick");
    expect(calls[0]?.args).toContain("640x640>");
    expect(await fs.readdir(tmpDir).catch(() => [])).toEqual([]);
  });

  it("returns null without spawning when no encoder is available", async () => {
    const file = path.join(ctx.dir, "photo.bmp");
    await fs.writeFile(file, makeBmp(8, 6));

    const thumb = await ensureThumb({
      absPath: file, raw: false, hash: "plain", previewsDir: path.join(ctx.dir, "data", "previews"),
      tmpDir: path.join(ctx.dir, "data", "tmp"), deps: noEncoder,
    });

    expect(thumb).toBeNull();
  });

  it("returns null on encoder failure and leaves no thumb or temp files", async () => {
    const file = path.join(ctx.dir, "photo.bmp");
    await fs.writeFile(file, makeBmp(8, 6));
    const previewsDir = path.join(ctx.dir, "data", "previews");
    const tmpDir = path.join(ctx.dir, "data", "tmp");
    const deps: RawDecodeDeps = {
      which: async () => "/bin/magick",
      run: async () => ({ status: 1, stderr: "boom" }),
    };

    const thumb = await ensureThumb({ absPath: file, raw: false, hash: "failed", previewsDir, tmpDir, deps });

    expect(thumb).toBeNull();
    expect(await fs.readdir(previewsDir).catch(() => [])).toEqual([]);
    expect(await fs.readdir(tmpDir).catch(() => [])).toEqual([]);
  });
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("thumb routes", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext({ thumbDeps: stubEncoder().deps });
  });

  afterEach(() => {
    ctx.close();
  });

  it("points thumbnails at /thumb and serves the embedded RAW preview", async () => {
    const file = path.join(ctx.dir, "frame.CR2");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12));
    const report = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [file] }),
      }),
    );
    const photo = report.imported[0] as LibraryPhoto;
    expect(photo.thumbnail).toBe(`/api/photos/${photo.id}/thumb`);
    expect(photo.src).toBe(`/api/photos/${photo.id}/file`);

    const thumb = await ctx.app.request(`/api/photos/${photo.id}/thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("Content-Type")).toBe("image/jpeg");
    expect(thumb.headers.get("Cache-Control")).toContain("immutable");
    // The 17x12 embedded preview, not the 61x41 full-res stub decode.
    expect(Buffer.from(await thumb.arrayBuffer())).toEqual(makeJpeg(17, 12));

    const cached = path.join(ctx.dir, "data", "previews", `${photo.hash}-thumb.jpg`);
    expect(await fs.stat(cached).then(() => true)).toBe(true);
  });

  it("serves downscaled thumbs for rendered photos and falls back without an encoder", async () => {
    const file = path.join(ctx.dir, "pixels.bmp");
    await fs.writeFile(file, makeBmp(40, 30));
    const report = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [file] }),
      }),
    );
    const id = report.imported[0]?.id as string;
    const thumb = await ctx.app.request(`/api/photos/${id}/thumb`);
    expect(thumb.status).toBe(200);
    expect(Buffer.from(await thumb.arrayBuffer())).toEqual(makeJpeg(9, 7));

    const plain = createTestContext();
    try {
      const other = path.join(plain.dir, "other.bmp");
      await fs.writeFile(other, makeBmp(5, 4));
      const fallback = await json<ImportReport>(
        await plain.app.request("/api/imports/by-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: [other] }),
        }),
      );
      const fallbackId = fallback.imported[0]?.id as string;
      const response = await plain.app.request(`/api/photos/${fallbackId}/thumb`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/bmp");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(makeBmp(5, 4));
    } finally {
      plain.close();
    }
  });

  it("404s unknown and missing photos like /file does", async () => {
    expect((await ctx.app.request("/api/photos/does-not-exist/thumb")).status).toBe(404);

    const file = path.join(ctx.dir, "here-today.bmp");
    await fs.writeFile(file, makeBmp(4, 4));
    const report = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [file] }),
      }),
    );
    const id = report.imported[0]?.id as string;
    await fs.unlink(file);
    const gone = await ctx.app.request(`/api/photos/${id}/thumb`);
    expect(gone.status).toBe(404);
    expect((await json<{ missing: boolean }>(gone)).missing).toBe(true);
  });

  it("deletes the cached thumb with the photo but never the original", async () => {
    const file = path.join(ctx.dir, "doomed.CR2");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12));
    const report = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [file] }),
      }),
    );
    const photo = report.imported[0] as LibraryPhoto;
    expect((await ctx.app.request(`/api/photos/${photo.id}/thumb`)).status).toBe(200);
    const thumb = path.join(ctx.dir, "data", "previews", `${photo.hash}-thumb.jpg`);
    expect(await fs.stat(thumb).then(() => true)).toBe(true);

    expect((await ctx.app.request(`/api/photos/${photo.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await fs.stat(thumb).then(() => true).catch(() => false)).toBe(false);
    expect(await fs.stat(file).then(() => true)).toBe(true);
  });
});
