import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "@photomator/core";
import { loadConfig } from "./config.ts";
import { createTestContext, makeBmp, makeJpeg, makeJpegWithOrientation, makeTiffWithJpeg } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";
import { importFileAtPath, importUpload, scanPaths } from "./importer.ts";

describe("importFileAtPath", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.close();
  });

  it("references a file in place without copying or changing it", async () => {
    const bytes = makeBmp(11, 7);
    const file = path.join(ctx.dir, "still-life.bmp");
    await fs.writeFile(file, bytes);
    const config = { ...loadConfig({}), previewsDir: path.join(ctx.dir, "data", "previews") };

    const outcome = await importFileAtPath(ctx.store, config, file);

    expect(outcome.status).toBe("imported");
    expect(outcome.row.kind).toBe("file");
    expect(outcome.row.path).toBe(file);
    expect(outcome.row.filename).toBe("still-life.bmp");
    expect(outcome.row.title).toBe("still-life");
    expect(outcome.row.width).toBe(11);
    expect(outcome.row.height).toBe(7);
    expect(outcome.row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.row.album_id).toBe("imports");
    expect(outcome.row.location).toContain(path.basename(ctx.dir));
    expect(outcome.edit.edited).toBe(false);
    expect(outcome.edit.present).toEqual(DEFAULT_EDIT);
    expect(await fs.readFile(file)).toEqual(bytes);
  });

  it("reports the same file as a duplicate instead of a second record", async () => {
    const file = path.join(ctx.dir, "dupe.bmp");
    await fs.writeFile(file, makeBmp(5, 4));
    const config = { ...loadConfig({}), previewsDir: path.join(ctx.dir, "data", "previews") };

    const first = await importFileAtPath(ctx.store, config, file);
    const second = await importFileAtPath(ctx.store, config, file);

    expect(second.status).toBe("duplicate");
    expect(second.row.id).toBe(first.row.id);
    expect(ctx.store.listPhotos()).toHaveLength(1);
  });

  it("relinks a moved file by hash and keeps its edits", async () => {
    const from = path.join(ctx.dir, "before.bmp");
    await fs.writeFile(from, makeBmp(9, 6));
    const config = { ...loadConfig({}), previewsDir: path.join(ctx.dir, "data", "previews") };
    const first = await importFileAtPath(ctx.store, config, from);
    ctx.store.saveEdit(first.row.id, { ...DEFAULT_EDIT, exposure: 0.5 });

    const to = path.join(ctx.dir, "moved", "before.bmp");
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    const relinked = await importFileAtPath(ctx.store, config, to);

    expect(relinked.status).toBe("relinked");
    expect(relinked.row.id).toBe(first.row.id);
    expect(relinked.row.path).toBe(to);
    expect(relinked.edit.present.exposure).toBe(0.5);
    expect(relinked.edit.edited).toBe(true);
    expect(ctx.store.listPhotos()).toHaveLength(1);
  });

  it("records upright dimensions for EXIF-oriented photos", async () => {
    const file = path.join(ctx.dir, "portrait.jpg");
    await fs.writeFile(file, makeJpegWithOrientation(8, 6, 6));
    const config = { ...loadConfig({}), previewsDir: path.join(ctx.dir, "data", "previews") };

    const outcome = await importFileAtPath(ctx.store, config, file);

    expect(outcome.row.width).toBe(6);
    expect(outcome.row.height).toBe(8);
  });

  it("extracts a RAW preview and reads dimensions from it", async () => {
    const file = path.join(ctx.dir, "frame.CR2");
    await fs.writeFile(file, makeTiffWithJpeg(17, 12));
    const previewsDir = path.join(ctx.dir, "data", "previews");
    const config = { ...loadConfig({}), previewsDir };

    const outcome = await importFileAtPath(ctx.store, config, file);

    expect(outcome.status).toBe("imported");
    expect(outcome.row.raw).toBe(1);
    expect(outcome.row.width).toBe(17);
    expect(outcome.row.height).toBe(12);
    const preview = await fs.readFile(path.join(previewsDir, `${outcome.row.hash}.jpg`));
    expect(preview[0]).toBe(0xff);
    expect(preview[1]).toBe(0xd8);
  });

  it("rejects files it cannot decode or does not accept", async () => {
    const bad = path.join(ctx.dir, "bad.jpg");
    await fs.writeFile(bad, "not an image");
    const text = path.join(ctx.dir, "notes.txt");
    await fs.writeFile(text, "not an image");
    const config = { ...loadConfig({}), previewsDir: path.join(ctx.dir, "data", "previews") };

    await expect(importFileAtPath(ctx.store, config, bad)).rejects.toThrow("could not be decoded");
    await expect(importFileAtPath(ctx.store, config, text)).rejects.toThrow("Unsupported file type");
    await expect(importFileAtPath(ctx.store, config, path.join(ctx.dir, "gone.bmp"))).rejects.toThrow(
      "could not be found",
    );
    expect(ctx.store.listPhotos()).toHaveLength(0);
  });
});

describe("importUpload", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.close();
  });

  it("stores upload bytes in a dated library folder, then references them", async () => {
    const tmp = path.join(ctx.dir, "data", "tmp", "staged");
    await fs.mkdir(path.dirname(tmp), { recursive: true });
    await fs.writeFile(tmp, makeJpeg(13, 9));
    const config = {
      ...loadConfig({}),
      previewsDir: path.join(ctx.dir, "data", "previews"),
      libraryRoot: path.join(ctx.dir, "library"),
    };

    const outcome = await importUpload(ctx.store, config, tmp, "drop.jpg");

    expect(outcome.status).toBe("imported");
    expect(outcome.row.path ?? "").toContain(path.join("library"));
    expect(outcome.row.location).toBe("Imported from this device");
    expect(await fs.stat(outcome.row.path as string)).toBeTruthy();
  });

  it("dedupes uploads by content and leaves no staged bytes behind", async () => {
    const config = {
      ...loadConfig({}),
      previewsDir: path.join(ctx.dir, "data", "previews"),
      libraryRoot: path.join(ctx.dir, "library"),
    };
    const bytes = makeBmp(4, 4);
    const first = path.join(ctx.dir, "data", "tmp", "one");
    await fs.mkdir(path.dirname(first), { recursive: true });
    await fs.writeFile(first, bytes);
    await importUpload(ctx.store, config, first, "one.bmp");

    const second = path.join(ctx.dir, "data", "tmp", "two");
    await fs.writeFile(second, bytes);
    const outcome = await importUpload(ctx.store, config, second, "renamed.bmp");

    expect(outcome.status).toBe("duplicate");
    expect(ctx.store.listPhotos()).toHaveLength(1);
    expect(await fs.stat(second).then(() => true).catch(() => false)).toBe(false);
  });
});

describe("scanPaths", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.close();
  });

  it("imports folders recursively and suppresses RAW+JPEG sidecars", async () => {
    const inbox = path.join(ctx.dir, "inbox");
    await fs.mkdir(path.join(inbox, "nested"), { recursive: true });
    await fs.writeFile(path.join(inbox, "shot.CR2"), makeTiffWithJpeg(17, 12));
    await fs.writeFile(path.join(inbox, "shot.JPG"), makeJpeg(17, 12));
    await fs.writeFile(path.join(inbox, "nested", "deep.bmp"), makeBmp(6, 5));
    await fs.writeFile(path.join(inbox, ".hidden.bmp"), makeBmp(2, 2));
    const config = { ...loadConfig({}), previewsDir: path.join(ctx.dir, "data", "previews") };

    const report = await scanPaths(ctx.store, config, [ctx.dir], [inbox]);

    expect(report.outcomes.map((outcome) => outcome.row.filename).sort()).toEqual(["deep.bmp", "shot.CR2"]);
    expect(report.suppressedSidecars).toBe(1);
    expect(report.skipped).toEqual([]);
    expect(report.truncated).toBe(false);
  });

  it("collects per-file failures without breaking the batch", async () => {
    const inbox = path.join(ctx.dir, "mixed");
    await fs.mkdir(inbox, { recursive: true });
    await fs.writeFile(path.join(inbox, "good.bmp"), makeBmp(3, 3));
    await fs.writeFile(path.join(inbox, "bad.jpg"), "not an image");
    const config = { ...loadConfig({}), previewsDir: path.join(ctx.dir, "data", "previews") };

    const report = await scanPaths(ctx.store, config, [ctx.dir], [inbox, path.join(ctx.dir, "missing-dir")]);

    expect(report.outcomes).toHaveLength(1);
    expect(report.skipped.map((entry) => entry.path).sort()).toEqual(
      [path.join(inbox, "bad.jpg"), path.join(ctx.dir, "missing-dir")].sort(),
    );
  });

  it("refuses paths outside the allowed roots", async () => {
    const config = { ...loadConfig({}), previewsDir: path.join(ctx.dir, "data", "previews") };
    const report = await scanPaths(ctx.store, config, [ctx.dir], ["/etc/hosts"]);
    expect(report.outcomes).toHaveLength(0);
    expect(report.skipped[0]?.reason).toContain("outside the allowed folders");
  });
});
