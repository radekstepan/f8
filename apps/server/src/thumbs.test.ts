import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImportReport, LibraryPhoto } from "@f8/core";
import { createTestContext, makeBmp, makeJpeg, makeTiffWithJpeg } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";
import type { RawDecodeDeps } from "./raw-decode.ts";
import { ensureThumb, orientArgsFor, thumbPathFor } from "./thumbs.ts";

const noEncoder: RawDecodeDeps = {
  which: async () => null,
  run: async () => {
    throw new Error("must not spawn");
  },
};

function stubEncoder(jpeg = makeJpeg(9, 7)): {
  deps: RawDecodeDeps;
  calls: Array<{ cmd: string; args: string[] }>;
  inputs: Buffer[];
} {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const inputs: Buffer[] = [];
  return {
    calls,
    inputs,
    deps: {
      which: async (cmd) => (cmd === "magick" ? "/bin/magick" : null),
      run: async (cmd, args) => {
        calls.push({ cmd, args });
        inputs.push(await fs.readFile(args[0] as string));
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

  it("rotates sideways embedded previews of portrait-class RAW captures", async () => {
    const file = path.join(ctx.dir, "portrait.ARW");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12, { orientation: 8 }));
    const { deps, calls } = stubEncoder(makeJpeg(12, 17));
    const previewsDir = path.join(ctx.dir, "data", "previews");
    const tmpDir = path.join(ctx.dir, "data", "tmp");

    const thumb = await ensureThumb({ absPath: file, raw: true, hash: "rotated", previewsDir, tmpDir, deps });

    expect(thumb).toBe(thumbPathFor(previewsDir, "rotated"));
    expect(await fs.readFile(thumb as string)).toEqual(makeJpeg(12, 17));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("-rotate");
    expect(calls[0]?.args).toContain("270");
    expect(await fs.readdir(tmpDir).catch(() => [])).toEqual([]);
  });

  it("rotates through sips with clockwise degrees when ImageMagick is absent", async () => {
    const file = path.join(ctx.dir, "portrait.ARW");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12, { orientation: 6 }));
    const calls: string[][] = [];
    const deps: RawDecodeDeps = {
      which: async (cmd) => (cmd === "sips" ? "/usr/bin/sips" : null),
      run: async (_cmd, args) => {
        calls.push(args);
        await fs.writeFile(args[args.length - 1] as string, makeJpeg(12, 17));
        return { status: 0, stderr: "" };
      },
    };
    const previewsDir = path.join(ctx.dir, "data", "previews");

    const thumb = await ensureThumb({
      absPath: file, raw: true, hash: "sips-rot", previewsDir, tmpDir: path.join(ctx.dir, "data", "tmp"), deps,
    });

    expect(await fs.readFile(thumb as string)).toEqual(makeJpeg(12, 17));
    expect(calls[0]).toContain("-r");
    expect(calls[0]).toContain("90");
    expect(calls[0]).toContain("--out");
  });

  it("strips the embedded orientation tag before rotating, so viewers rotate once", async () => {
    const file = path.join(ctx.dir, "tagged.ARW");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12, { orientation: 8, embeddedOrientation: 8 }));
    const { deps, inputs } = stubEncoder(makeJpeg(12, 17));
    const previewsDir = path.join(ctx.dir, "data", "previews");

    const thumb = await ensureThumb({
      absPath: file, raw: true, hash: "tagged", previewsDir, tmpDir: path.join(ctx.dir, "data", "tmp"), deps,
    });

    expect(thumb).toBe(thumbPathFor(previewsDir, "tagged"));
    // The staged encoder input is the preview minus its APP1 Exif segment.
    expect(inputs[0]).toEqual(makeJpeg(17, 12));
    expect(await fs.readFile(thumb as string)).toEqual(makeJpeg(12, 17));
  });

  it("serves pre-rotated portrait previews without spawning", async () => {
    const file = path.join(ctx.dir, "upright.ARW");
    await fs.writeFile(file, makeTiffWithJpeg(12, 17, { orientation: 8, embeddedOrientation: 8 }));
    const previewsDir = path.join(ctx.dir, "data", "previews");

    const thumb = await ensureThumb({
      absPath: file, raw: true, hash: "upright", previewsDir, tmpDir: path.join(ctx.dir, "data", "tmp"), deps: noEncoder,
    });

    // Portrait pixels, misleading tag dropped, no encoder involved.
    expect(await fs.readFile(thumb as string)).toEqual(makeJpeg(12, 17));
  });

  it("falls back to the upright preview when rotation has no encoder", async () => {
    const file = path.join(ctx.dir, "portrait.ARW");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12, { orientation: 8 }));
    const previewsDir = path.join(ctx.dir, "data", "previews");

    const thumb = await ensureThumb({
      absPath: file, raw: true, hash: "noenc", previewsDir, tmpDir: path.join(ctx.dir, "data", "tmp"), deps: noEncoder,
    });

    // Null serves the upright full preview; a sideways thumb is never cached.
    expect(thumb).toBeNull();
    expect(await fs.readdir(previewsDir).catch(() => [])).toEqual([]);
  });

  it("returns null on rotation failure and leaves no thumb or temp files", async () => {
    const file = path.join(ctx.dir, "portrait.ARW");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12, { orientation: 8 }));
    const previewsDir = path.join(ctx.dir, "data", "previews");
    const tmpDir = path.join(ctx.dir, "data", "tmp");
    const deps: RawDecodeDeps = {
      which: async () => "/bin/magick",
      run: async () => ({ status: 1, stderr: "boom" }),
    };

    const thumb = await ensureThumb({ absPath: file, raw: true, hash: "rotfail", previewsDir, tmpDir, deps });

    expect(thumb).toBeNull();
    expect(await fs.readdir(previewsDir).catch(() => [])).toEqual([]);
    expect(await fs.readdir(tmpDir).catch(() => [])).toEqual([]);
  });

  it("removes the stale pre-rotation thumb once its replacement exists", async () => {
    const file = path.join(ctx.dir, "frame.CR2");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12));
    const previewsDir = path.join(ctx.dir, "data", "previews");
    await fs.mkdir(previewsDir, { recursive: true });
    await fs.writeFile(path.join(previewsDir, "legacy-thumb.jpg"), makeJpeg(17, 12));

    const thumb = await ensureThumb({
      absPath: file, raw: true, hash: "legacy", previewsDir, tmpDir: path.join(ctx.dir, "data", "tmp"), deps: noEncoder,
    });

    expect(thumb).toBe(thumbPathFor(previewsDir, "legacy"));
    expect(await fs.stat(path.join(previewsDir, "legacy-thumb.jpg")).then(() => true).catch(() => false)).toBe(false);
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

describe("orientArgsFor", () => {
  const cases: Array<[number, string[], string[]]> = [
    [2, ["-flop"], ["-f", "horizontal"]],
    [3, ["-rotate", "180"], ["-r", "180"]],
    [4, ["-flip"], ["-f", "vertical"]],
    [5, ["-transpose"], ["-f", "horizontal", "-r", "90"]],
    [6, ["-rotate", "90"], ["-r", "90"]],
    [7, ["-transverse"], ["-f", "horizontal", "-r", "270"]],
    [8, ["-rotate", "270"], ["-r", "270"]],
  ];
  it.each(cases)("maps EXIF orientation %i for both encoder CLIs", (orientation, magick, sips) => {
    expect(orientArgsFor("magick", orientation, "in.jpg", "out.jpg")).toEqual(
      ["in.jpg", ...magick, "-quality", "82", "out.jpg"],
    );
    expect(orientArgsFor("convert", orientation, "in.jpg", "out.jpg")).toEqual(
      ["in.jpg", ...magick, "-quality", "82", "out.jpg"],
    );
    expect(orientArgsFor("sips", orientation, "in.jpg", "out.jpg")).toEqual(
      ["-s", "format", "jpeg", ...sips, "in.jpg", "--out", "out.jpg"],
    );
  });

  it("returns null when no rotation is needed", () => {
    expect(orientArgsFor("magick", 1, "in.jpg", "out.jpg")).toBeNull();
    expect(orientArgsFor("sips", 1, "in.jpg", "out.jpg")).toBeNull();
    expect(orientArgsFor("magick", 0, "in.jpg", "out.jpg")).toBeNull();
    expect(orientArgsFor("magick", 9, "in.jpg", "out.jpg")).toBeNull();
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
    expect(photo.thumbnail).toBe(`/api/photos/${photo.id}/thumb?v=2`);
    expect(photo.src).toBe(`/api/photos/${photo.id}/file`);

    const thumb = await ctx.app.request(`/api/photos/${photo.id}/thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("Content-Type")).toBe("image/jpeg");
    expect(thumb.headers.get("Cache-Control")).toContain("immutable");
    // The 17x12 embedded preview, not the 61x41 full-res stub decode.
    expect(Buffer.from(await thumb.arrayBuffer())).toEqual(makeJpeg(17, 12));

    const cached = thumbPathFor(path.join(ctx.dir, "data", "previews"), photo.hash as string);
    expect(await fs.stat(cached).then(() => true)).toBe(true);
  });

  it("serves the rotated thumb for portrait RAW captures under the versioned URL", async () => {
    const file = path.join(ctx.dir, "portrait.ARW");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12, { orientation: 8 }));
    const report = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [file] }),
      }),
    );
    const photo = report.imported[0] as LibraryPhoto;

    const thumb = await ctx.app.request(`/api/photos/${photo.id}/thumb?v=2`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("Content-Type")).toBe("image/jpeg");
    expect(thumb.headers.get("ETag")).toBe(`"${photo.hash}-thumb2"`);
    // The encoder's rotated bytes, not the sideways embedded slice.
    expect(Buffer.from(await thumb.arrayBuffer())).toEqual(makeJpeg(9, 7));
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
    const thumb = thumbPathFor(path.join(ctx.dir, "data", "previews"), photo.hash as string);
    expect(await fs.stat(thumb).then(() => true)).toBe(true);

    expect((await ctx.app.request(`/api/photos/${photo.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await fs.stat(thumb).then(() => true).catch(() => false)).toBe(false);
    expect(await fs.stat(file).then(() => true)).toBe(true);
  });
});
