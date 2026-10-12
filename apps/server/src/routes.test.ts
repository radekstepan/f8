import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "@photomator/core";
import type { ImportReport, LibraryPhoto, LibrarySnapshot } from "@photomator/core";
import { createTestContext, makeBmp, makeJpeg, makeTiffWithJpeg } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("routes", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.close();
  });

  it("reports health and an empty library before the first import", async () => {
    expect(await json(await ctx.app.request("/api/health"))).toEqual({ ok: true });
    const library = await json<LibrarySnapshot>(await ctx.app.request("/api/library"));
    expect(library).toEqual({ photos: [], albums: [], presets: [] });
  });

  it("imports an upload, then dedupes the same bytes", async () => {
    const bytes = makeBmp(11, 7);
    const first = await json<{ photo: LibraryPhoto; deduplicated: boolean }>(
      await ctx.app.request("/api/imports/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": "drop.bmp" },
        body: bytes,
      }),
    );
    expect(first.deduplicated).toBe(false);
    expect(first.photo.width).toBe(11);
    expect(first.photo.height).toBe(7);
    expect(first.photo.src).toBe(`/api/photos/${first.photo.id}/file`);
    expect(first.photo.missing).toBe(false);

    const second = await json<{ photo: LibraryPhoto; deduplicated: boolean }>(
      await ctx.app.request("/api/imports/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": "renamed.bmp" },
        body: bytes,
      }),
    );
    expect(second.deduplicated).toBe(true);
    expect(second.photo.id).toBe(first.photo.id);
    expect((await json<LibrarySnapshot>(await ctx.app.request("/api/library"))).photos).toHaveLength(1);
  });

  it("serves no import provenance as the photo location", async () => {
    const uploaded = await json<{ photo: LibraryPhoto; deduplicated: boolean }>(
      await ctx.app.request("/api/imports/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": "drop.bmp" },
        body: makeBmp(11, 7),
      }),
    );
    expect(uploaded.photo.location).toBe("");

    // Legacy rows stored auto-generated "Imported from ..." provenance; the
    // API hides it while genuine locations still pass through.
    const stamp = new Date().toISOString();
    const legacy = {
      hash: null, kind: "url", path: null, url: "https://example.com/legacy.jpg", thumbnail_url: null,
      filename: "legacy.jpg", title: "legacy", width: 8, height: 6,
      camera: "Camera", lens: "Lens", iso: 100, aperture: "f/2",
      shutter: "1/60", focal_length: "35mm", date_taken: stamp,
      raw: 0, favorite: 0, rating: 0, album_id: "all", photographer: null,
      file_size: 0, mtime: 0, created_at: stamp, updated_at: stamp,
    } as const;
    ctx.store.insertPhoto({ ...legacy, id: "legacy-provenance", location: "Imported from this device" });
    ctx.store.insertPhoto({ ...legacy, id: "genuine-place", location: "Sardinia" });
    const library = await json<LibrarySnapshot>(await ctx.app.request("/api/library"));
    expect(library.photos.find((photo) => photo.id === "legacy-provenance")?.location).toBe("");
    expect(library.photos.find((photo) => photo.id === "genuine-place")?.location).toBe("Sardinia");
  });

  it("rejects empty and undecodable uploads", async () => {
    const empty = await ctx.app.request("/api/imports/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Filename": "empty.bmp" },
      body: new Uint8Array(),
    });
    expect(empty.status).toBe(400);

    const corrupt = await ctx.app.request("/api/imports/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Filename": "bad.jpg" },
      body: Buffer.from("not an image"),
    });
    expect(corrupt.status).toBe(422);
    expect(((await json<{ error: string }>(corrupt)).error)).toContain("could not be decoded");
  });

  it("imports by path, then relinks after a move with edits intact", async () => {
    const from = path.join(ctx.dir, "before.bmp");
    await fs.writeFile(from, makeBmp(9, 6));
    const imported = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [from] }),
      }),
    );
    expect(imported.imported).toHaveLength(1);
    const id = imported.imported[0]?.id as string;

    await ctx.app.request(`/api/photos/${id}/edit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ present: { ...DEFAULT_EDIT, exposure: 0.5 } }),
    });

    const to = path.join(ctx.dir, "after.bmp");
    await fs.rename(from, to);
    const missing = await json<LibrarySnapshot>(await ctx.app.request("/api/library"));
    expect(missing.photos[0]?.missing).toBe(true);

    const relinked = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [to] }),
      }),
    );
    expect(relinked.relinked).toHaveLength(1);
    expect(relinked.relinked[0]?.id).toBe(id);
    expect(relinked.relinked[0]?.missing).toBe(false);
    expect(relinked.relinked[0]?.edit.exposure).toBe(0.5);
    expect(relinked.relinked[0]?.edited).toBe(true);
  });

  it("serves display bytes, distinguishes previews, and 404s the missing", async () => {
    const bmp = path.join(ctx.dir, "pixels.bmp");
    const raw = path.join(ctx.dir, "frame.CR2");
    await fs.writeFile(bmp, makeBmp(5, 4));
    await fs.writeFile(raw, makeTiffWithJpeg(17, 12));
    const report = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [bmp, raw] }),
      }),
    );
    const rendered = report.imported.find((photo) => photo.name === "pixels.bmp") as LibraryPhoto;
    const rawPhoto = report.imported.find((photo) => photo.name === "frame.CR2") as LibraryPhoto;

    const file = await ctx.app.request(`/api/photos/${rendered.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("image/bmp");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(makeBmp(5, 4));

    const preview = await ctx.app.request(`/api/photos/${rawPhoto.id}/file`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/jpeg");

    const original = await ctx.app.request(`/api/photos/${rawPhoto.id}/original`);
    expect(original.status).toBe(200);
    expect(original.headers.get("Content-Disposition")).toContain("attachment");

    await fs.unlink(bmp);
    const gone = await ctx.app.request(`/api/photos/${rendered.id}/file`);
    expect(gone.status).toBe(404);
    expect((await json<{ missing: boolean }>(gone)).missing).toBe(true);

    expect((await ctx.app.request("/api/photos/does-not-exist/file")).status).toBe(404);
  });

  it("updates photo metadata and validates input", async () => {
    await fs.writeFile(path.join(ctx.dir, "meta.bmp"), makeBmp(3, 3));
    const report = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [path.join(ctx.dir, "meta.bmp")] }),
      }),
    );
    const id = report.imported[0]?.id as string;

    const updated = await json<{ photo: LibraryPhoto }>(
      await ctx.app.request(`/api/photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: true, rating: 5, title: "  New Title  " }),
      }),
    );
    expect(updated.photo.favorite).toBe(true);
    expect(updated.photo.rating).toBe(5);
    expect(updated.photo.title).toBe("New Title");

    const bad = await ctx.app.request(`/api/photos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 9 }),
    });
    expect(bad.status).toBe(400);
  });

  it("stores edit recipes and derives the edited flag", async () => {
    const bytes = makeJpeg(13, 9);
    const upload = await json<{ photo: LibraryPhoto }>(
      await ctx.app.request("/api/imports/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": "edit.jpg" },
        body: bytes,
      }),
    );
    const id = upload.photo.id;

    const changed = await json<{ photo: LibraryPhoto }>(
      await ctx.app.request(`/api/photos/${id}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ present: { ...DEFAULT_EDIT, exposure: 0.5 } }),
      }),
    );
    expect(changed.photo.edited).toBe(true);
    expect(changed.photo.edit.exposure).toBe(0.5);
    expect(typeof changed.photo.editedAt).toBe("string");

    const reset = await json<{ photo: LibraryPhoto }>(
      await ctx.app.request(`/api/photos/${id}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ present: { ...DEFAULT_EDIT } }),
      }),
    );
    expect(reset.photo.edited).toBe(false);
    expect(reset.photo.editedAt).toBeNull();

    const bad = await ctx.app.request(`/api/photos/${id}/edit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ present: [1, 2] }),
    });
    expect(bad.status).toBe(400);
  });

  it("deletes the record and preview but never the original", async () => {
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
    const preview = path.join(ctx.dir, "data", "previews", `${photo.hash}.jpg`);
    expect(await fs.stat(preview).then(() => true)).toBe(true);

    const deleted = await ctx.app.request(`/api/photos/${photo.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await fs.stat(preview).then(() => true).catch(() => false)).toBe(false);
    expect(await fs.stat(file).then(() => true)).toBe(true);
    expect((await json<LibrarySnapshot>(await ctx.app.request("/api/library"))).photos).toHaveLength(0);
  });

  it("manages albums without orphaning their photos", async () => {
    const created = await json<{ album: { id: string; name: string } }>(
      await ctx.app.request("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Road Trip" }),
      }),
    );
    expect(created.album.name).toBe("Road Trip");

    const dupe = await ctx.app.request("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "road trip" }),
    });
    expect(dupe.status).toBe(409);

    await fs.writeFile(path.join(ctx.dir, "trip.bmp"), makeBmp(3, 3));
    const report = await json<ImportReport>(
      await ctx.app.request("/api/imports/by-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [path.join(ctx.dir, "trip.bmp")], albumId: created.album.id }),
      }),
    );
    expect(report.imported[0]?.albumId).toBe(created.album.id);

    const removed = await ctx.app.request(`/api/albums/${created.album.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const library = await json<LibrarySnapshot>(await ctx.app.request("/api/library"));
    expect(library.albums).toHaveLength(0);
    expect(library.photos).toHaveLength(1);
  });

  it("manages custom presets", async () => {
    const created = await ctx.app.request("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Moody", values: { exposure: -0.2 } }),
    });
    expect(created.status).toBe(201);

    const dupe = await ctx.app.request("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "moody", values: {} }),
    });
    expect(dupe.status).toBe(409);
    expect((await json<LibrarySnapshot>(await ctx.app.request("/api/library"))).presets).toHaveLength(1);
  });

  it("browses folders within the roots and refuses escapes", async () => {
    await fs.mkdir(path.join(ctx.dir, "shots"), { recursive: true });
    await fs.writeFile(path.join(ctx.dir, "shots", "a.bmp"), makeBmp(2, 2));
    await fs.writeFile(path.join(ctx.dir, "shots", ".hidden.bmp"), makeBmp(2, 2));
    await fs.writeFile(path.join(ctx.dir, "shots", "notes.txt"), "nope");

    const listing = await json<{ path: string; parent: string | null; entries: { name: string; importable: boolean }[] }>(
      await ctx.app.request(`/api/fs/browse?path=${encodeURIComponent(path.join(ctx.dir, "shots"))}`),
    );
    expect(listing.entries.map((entry) => entry.name).sort()).toEqual(["a.bmp", "notes.txt"]);
    expect(listing.entries.find((entry) => entry.name === "a.bmp")?.importable).toBe(true);
    expect(listing.entries.find((entry) => entry.name === "notes.txt")?.importable).toBe(false);

    const escape = await ctx.app.request("/api/fs/browse?path=%2Fetc");
    expect(escape.status).toBe(400);
  });
});
