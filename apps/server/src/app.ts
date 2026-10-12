import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Hono } from "hono";
import type { Context } from "hono";
import { DEFAULT_EDIT } from "@f8/core";
import type { EditState, LibraryPhoto } from "@f8/core";
import type { ServerConfig } from "./config.ts";
import { getHealProgress, getMlHealHealth, kickEngineReady, runRemoteHeal, validateRemoteBody } from "./ml-heal.ts";
import type { RemoteHealEngine } from "./ml-heal.ts";
import { getStraightenHealth, kickStraightenReady, runStraightenEstimate, validateStraightenBody } from "./straighten-ml.ts";
import {
  deleteHealOverlay,
  listHealOverlays,
  purgeHealOverlays,
  saveHealOverlay,
  validateOverlayBody,
} from "./heal-overlays.ts";
import { BrowseError, browse } from "./fs-browse.ts";
import { ImportError, importUpload, scanPaths } from "./importer.ts";
import type { ImportOutcome } from "./importer.ts";
import type { PhotoRow, Store, StoredEdit } from "./store.ts";
import type { DecodeRawFullRes, RawDecodeDeps } from "./raw-decode.ts";
import { defaultToolDeps } from "./raw-decode.ts";
import { ensureThumb, thumbPathFor } from "./thumbs.ts";

export interface AppContext {
  config: ServerConfig;
  store: Store;
  roots: string[];
  // Full-res RAW decode override; undefined means the LibRaw toolchain.
  // Tests inject a stub so route tests never depend on system binaries.
  decodeRaw?: DecodeRawFullRes;
  // Encoder toolchain for rendered-image thumbnails; same deal as decodeRaw.
  thumbDeps?: RawDecodeDeps;
}

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
};

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function mimeFor(absPath: string, table: Record<string, string>, fallback: string): string {
  return table[path.extname(absPath).toLowerCase()] ?? fallback;
}

function isMissing(row: PhotoRow): boolean {
  return row.kind === "file" && (!row.path || !existsSync(row.path));
}

function toApiPhoto(row: PhotoRow, edit: StoredEdit): LibraryPhoto {
  const file = row.kind === "file";
  const endpoint = `/api/photos/${row.id}/file`;
  return {
    id: row.id,
    name: row.filename,
    title: row.title,
    src: file ? endpoint : (row.url ?? ""),
    // Grids and the filmstrip read the small cached thumb (embedded RAW
    // preview or downscaled render); the editor keeps full-res src. The v=2
    // generation busts immutable browser caches of pre-rotation thumbs.
    thumbnail: file ? `/api/photos/${row.id}/thumb?v=2` : (row.thumbnail_url ?? row.url ?? ""),
    albumId: row.album_id,
    // Legacy rows stored auto-generated "Imported from ..." provenance here;
    // everything comes from this device, so only real locations are served.
    location: row.location.startsWith("Imported from") ? "" : row.location,
    date: row.date_taken,
    width: row.width,
    height: row.height,
    camera: row.camera,
    lens: row.lens,
    iso: row.iso,
    aperture: row.aperture,
    shutter: row.shutter,
    focalLength: row.focal_length,
    raw: row.raw === 1,
    favorite: row.favorite === 1,
    rating: row.rating,
    ...(row.photographer ? { photographer: row.photographer } : {}),
    missing: isMissing(row),
    edited: edit.edited,
    // A reset stamps updated_at too, so only edited photos carry a timestamp.
    editedAt: edit.edited ? edit.updatedAt : null,
    edit: edit.present,
    hash: row.hash,
    path: file ? row.path : null,
    importedAt: row.created_at,
  };
}

function withEdit(store: Store, row: PhotoRow): LibraryPhoto {
  return toApiPhoto(row, store.getEdit(row.id));
}

async function sendFile(
  c: Context,
  absPath: string,
  contentType: string,
  extra?: Record<string, string>,
): Promise<Response> {
  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat || !stat.isFile()) return c.json({ error: "File not found." }, 404);
  return c.body(Readable.toWeb(createReadStream(absPath)) as ReadableStream, 200, {
    "Content-Type": contentType,
    "Content-Length": String(stat.size),
    "Accept-Ranges": "bytes",
    ...extra,
  });
}

async function readJson(c: Context): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  try {
    const value = (await c.req.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

export function createApp(ctx: AppContext): Hono {
  const { config, store, roots } = ctx;
  const app = new Hono();

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "Something went wrong." }, 500);
  });

  const photoOr404 = (c: Context, id: string): PhotoRow | Response => {
    const row = store.getPhoto(id);
    return row ?? c.json({ error: "Photo not found." }, 404);
  };

  // One line per API call so the terminal shows what the server is doing
  // (long ML heals stay visible instead of looking hung). Skips the hot
  // progress poll to keep the log readable.
  app.use("/api/*", async (c, next) => {
    const startedAt = Date.now();
    await next();
    if (c.req.path === "/api/ml-heal/progress") return;
    console.log(`${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - startedAt}ms)`);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/ml-heal/health", async (c) => c.json(await getMlHealHealth(config.dataDir)));

  // Live inference progress for the current heal job (the client polls this
  // while the inpaint POST is in flight; single-user local server, one job).
  app.get("/api/ml-heal/progress", (c) => c.json(getHealProgress()));

  app.post("/api/ml-heal/warmup", async (c) => {
    // Kick provisioning into the background and return immediately: the
    // client polls health for download/session progress. First Best use
    // downloads ~1.3GB once; later warmups resolve instantly.
    let engine: RemoteHealEngine = "moebius";
    try {
      const body = (await c.req.json()) as { engine?: unknown };
      if (body.engine !== undefined) {
        if (body.engine !== "lama" && body.engine !== "moebius") {
          return c.json({ error: 'Invalid engine (expected "lama" or "moebius").' }, 400);
        }
        engine = body.engine;
      }
    } catch {
      // Empty/unreadable body → default engine.
    }
    kickEngineReady(config.dataDir, engine);
    return c.json(await getMlHealHealth(config.dataDir));
  });

  app.post("/api/ml-heal/inpaint", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request." }, 400);
    }
    const parsed = validateRemoteBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const result = await runRemoteHeal(config.dataDir, parsed.value);
      const rgb = Buffer.from(
        Uint8Array.from(result.output, (value) => Math.round(Math.max(0, Math.min(255, value)))),
      ).toString("base64");
      return c.json({ engine: result.engine, width: result.width, height: result.height, outputB64: rgb });
    } catch (error) {
      if (error instanceof RangeError) return c.json({ error: error.message }, 400);
      console.error(error);
      return c.json({ error: "Remote repair failed." }, 503);
    }
  });

  app.get("/api/straighten/health", async (c) => c.json(await getStraightenHealth(config.dataDir)));

  app.post("/api/straighten/warmup", async (c) => {
    // Kick provisioning into the background and return immediately: the
    // client polls health for download/session progress, like ml-heal.
    kickStraightenReady(config.dataDir);
    return c.json(await getStraightenHealth(config.dataDir));
  });

  app.post("/api/straighten/estimate", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request." }, 400);
    }
    const parsed = validateStraightenBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const result = await runStraightenEstimate(config.dataDir, parsed.value);
      return c.json(result);
    } catch (error) {
      if (error instanceof RangeError) return c.json({ error: error.message }, 400);
      console.error(error);
      return c.json({ error: "Straighten estimate failed." }, 503);
    }
  });

  app.get("/api/library", (c) => {
    const photos = store.listPhotos().map((row) => withEdit(store, row));
    return c.json({ photos, albums: store.listAlbums(), presets: store.listPresets() });
  });

  app.post("/api/imports/upload", async (c) => {
    const rawFilename = c.req.header("x-filename");
    if (!rawFilename) return c.json({ error: "Missing file name." }, 400);
    let filename: string;
    try {
      filename = decodeURIComponent(rawFilename);
    } catch {
      return c.json({ error: "Invalid file name." }, 400);
    }
    const albumId = c.req.header("x-album-id") || undefined;
    const body = c.req.raw.body;
    if (!body) return c.json({ error: "Empty upload." }, 400);
    await fs.mkdir(config.tmpDir, { recursive: true });
    const tmpPath = path.join(config.tmpDir, `upload-${randomUUID()}`);
    try {
      await pipeline(Readable.fromWeb(body), createWriteStream(tmpPath));
      const stat = await fs.stat(tmpPath).catch(() => null);
      if (!stat || stat.size === 0) {
        await fs.unlink(tmpPath).catch(() => undefined);
        return c.json({ error: "Empty upload." }, 400);
      }
      const outcome = await importUpload(store, config, tmpPath, filename, { albumId, decodeRaw: ctx.decodeRaw });
      return c.json({
        photo: toApiPhoto(outcome.row, outcome.edit),
        deduplicated: outcome.status !== "imported",
      });
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      if (error instanceof ImportError) return c.json({ error: error.message }, 422);
      throw error;
    }
  });

  app.post("/api/imports/by-path", async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "Invalid request." }, 400);
    const { paths, albumId } = parsed.value;
    if (
      !Array.isArray(paths) || !paths.length || paths.length > 100 ||
      !paths.every((entry): entry is string => typeof entry === "string" && entry.length > 0)
    ) {
      return c.json({ error: "Provide up to 100 file or folder paths." }, 400);
    }
    if (albumId !== undefined && typeof albumId !== "string") {
      return c.json({ error: "Invalid album." }, 400);
    }
    const report = await scanPaths(store, config, roots, paths, { albumId, decodeRaw: ctx.decodeRaw });
    const photos = (outcomes: ImportOutcome[]): LibraryPhoto[] =>
      outcomes.map((outcome) => toApiPhoto(outcome.row, outcome.edit));
    return c.json({
      imported: photos(report.outcomes.filter((outcome) => outcome.status === "imported")),
      relinked: photos(report.outcomes.filter((outcome) => outcome.status === "relinked")),
      duplicates: photos(report.outcomes.filter((outcome) => outcome.status === "duplicate")),
      skipped: report.skipped,
      suppressedSidecars: report.suppressedSidecars,
      truncated: report.truncated,
    });
  });

  const displayPath = (row: PhotoRow): string | null => {
    if (row.kind !== "file" || !row.path) return null;
    if (row.raw === 1) {
      if (!row.hash) return null;
      const preview = path.join(config.previewsDir, `${row.hash}.jpg`);
      return existsSync(preview) ? preview : null;
    }
    return existsSync(row.path) ? row.path : null;
  };

  // Full display bytes for a file row: the decoded preview for RAW, the
  // referenced original otherwise. Shared by /file and the /thumb fallback.
  const serveDisplayBytes = async (c: Context, found: PhotoRow): Promise<Response> => {
    const file = displayPath(found);
    if (!file) return c.json({ error: "The preview is missing." }, 404);
    // Previews are content-addressed and immutable; referenced originals can
    // change under us, so they always revalidate.
    if (found.raw === 1 && found.hash) {
      return sendFile(c, file, "image/jpeg", {
        ETag: `"${found.hash}"`,
        "Cache-Control": "private, max-age=31536000, immutable",
      });
    }
    return sendFile(c, file, mimeFor(found.path ?? "", IMAGE_MIME, "application/octet-stream"), {
      ETag: `"${found.mtime}-${found.file_size}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    });
  };

  app.get("/api/photos/:id/file", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    if (found.kind === "url") {
      if (!found.url) return c.json({ error: "Photo not found." }, 404);
      return c.redirect(found.url, 302);
    }
    if (isMissing(found)) {
      return c.json({ error: "The original file is missing. Reimport it to relink.", missing: true }, 404);
    }
    return serveDisplayBytes(c, found);
  });

  // Small grid/filmstrip bytes: the embedded RAW preview or a downscaled
  // render, generated lazily and cached by hash. Anything the thumbnailer
  // cannot handle (missing encoder, CR3, corrupt file) falls back to the
  // display bytes, so /thumb never 404s a photo /file would serve.
  app.get("/api/photos/:id/thumb", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    if (found.kind === "url") {
      if (!found.thumbnail_url && !found.url) return c.json({ error: "Photo not found." }, 404);
      return c.redirect((found.thumbnail_url ?? found.url) as string, 302);
    }
    if (isMissing(found) || !found.path) {
      return c.json({ error: "The original file is missing. Reimport it to relink.", missing: true }, 404);
    }
    if (found.hash) {
      const thumb = await ensureThumb({
        absPath: found.path,
        raw: found.raw === 1,
        hash: found.hash,
        previewsDir: config.previewsDir,
        tmpDir: config.tmpDir,
        deps: ctx.thumbDeps ?? defaultToolDeps,
      });
      if (thumb) {
        return sendFile(c, thumb, "image/jpeg", {
          ETag: `"${found.hash}-thumb2"`,
          "Cache-Control": "private, max-age=31536000, immutable",
        });
      }
    }
    return serveDisplayBytes(c, found);
  });

  app.get("/api/photos/:id/original", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    if (found.kind === "url") {
      if (!found.url) return c.json({ error: "Photo not found." }, 404);
      return c.redirect(found.url, 302);
    }
    if (isMissing(found) || !found.path) {
      return c.json({ error: "The original file is missing.", missing: true }, 404);
    }
    return sendFile(c, found.path, mimeFor(found.path, IMAGE_MIME, "application/octet-stream"), {
      "Content-Disposition": `attachment; filename="${encodeURIComponent(found.filename)}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    });
  });

  app.patch("/api/photos/:id", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "Invalid request." }, 400);
    const { favorite, rating, title, albumId } = parsed.value;
    if (favorite !== undefined && typeof favorite !== "boolean") {
      return c.json({ error: "Invalid favorite." }, 400);
    }
    if (rating !== undefined && (!Number.isInteger(rating) || (rating as number) < 0 || (rating as number) > 5)) {
      return c.json({ error: "Invalid rating." }, 400);
    }
    if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 120)) {
      return c.json({ error: "Invalid title." }, 400);
    }
    if (albumId !== undefined && typeof albumId !== "string") {
      return c.json({ error: "Invalid album." }, 400);
    }
    const updated = store.updatePhotoMeta(found.id, {
      favorite: favorite as boolean | undefined,
      rating: rating as number | undefined,
      title: typeof title === "string" ? title.trim() : undefined,
      albumId: albumId as string | undefined,
    });
    if (!updated) return c.json({ error: "Photo not found." }, 404);
    return c.json({ photo: withEdit(store, updated) });
  });

  app.put("/api/photos/:id/edit", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "Invalid request." }, 400);
    const { present } = parsed.value;
    if (!present || typeof present !== "object" || Array.isArray(present)) {
      return c.json({ error: "Invalid edit." }, 400);
    }
    const edit = store.saveEdit(found.id, { ...DEFAULT_EDIT, ...(present as Partial<EditState>) });
    const row = store.getPhoto(found.id);
    if (!row) return c.json({ error: "Photo not found." }, 404);
    return c.json({ photo: toApiPhoto(row, edit) });
  });

  app.get("/api/photos/:id/heal-overlays", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    return c.json({ patches: await listHealOverlays(config.dataDir, found.id) });
  });

  app.put("/api/photos/:id/heal-overlays/:groupId", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    const groupId = Number.parseInt(c.req.param("groupId"), 10);
    if (!Number.isInteger(groupId)) return c.json({ error: "Invalid group." }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request." }, 400);
    }
    try {
      const overlay = validateOverlayBody(found.id, groupId, body);
      await saveHealOverlay(config.dataDir, found.id, overlay);
      return c.json({ patch: overlay });
    } catch (error) {
      if (error instanceof RangeError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  app.delete("/api/photos/:id/heal-overlays/:groupId", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    const groupId = Number.parseInt(c.req.param("groupId"), 10);
    if (!Number.isInteger(groupId)) return c.json({ error: "Invalid group." }, 400);
    return c.json({ deleted: await deleteHealOverlay(config.dataDir, found.id, groupId) });
  });

  app.delete("/api/photos/:id", async (c) => {
    const found = photoOr404(c, c.req.param("id"));
    if (found instanceof Response) return found;
    // The library never deletes originals: only the record and its derived
    // preview go away, even for files the server placed in the library.
    if (found.hash) {
      await fs.unlink(path.join(config.previewsDir, `${found.hash}.jpg`)).catch(() => undefined);
      await fs.unlink(thumbPathFor(config.previewsDir, found.hash)).catch(() => undefined);
    }
    // Heal overlays are a cache of inference output: drop them with the photo.
    await purgeHealOverlays(config.dataDir, found.id);
    store.deletePhoto(found.id);
    return c.json({ deleted: true });
  });

  app.get("/api/albums", (c) => c.json({ albums: store.listAlbums() }));

  app.post("/api/albums", async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "Invalid request." }, 400);
    const { name, cover } = parsed.value;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
      return c.json({ error: "Give the album a name up to 60 characters." }, 400);
    }
    if (cover !== undefined && (typeof cover !== "string" || cover.length > 2048)) {
      return c.json({ error: "Invalid cover." }, 400);
    }
    if (store.listAlbums().some((album) => album.name.toLowerCase() === name.trim().toLowerCase())) {
      return c.json({ error: "An album with that name already exists." }, 409);
    }
    const album = { id: randomUUID(), name: name.trim(), cover: typeof cover === "string" ? cover : "" };
    store.insertAlbum({ ...album, sort: store.listAlbums().length });
    return c.json({ album }, 201);
  });

  app.patch("/api/albums/:id", async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "Invalid request." }, 400);
    const { name, cover } = parsed.value;
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 60)) {
      return c.json({ error: "Invalid name." }, 400);
    }
    if (cover !== undefined && (typeof cover !== "string" || cover.length > 2048)) {
      return c.json({ error: "Invalid cover." }, 400);
    }
    const existing = store.getAlbum(c.req.param("id"));
    if (!existing) return c.json({ error: "Album not found." }, 404);
    if (
      typeof name === "string" &&
      store.listAlbums().some((album) => album.id !== existing.id && album.name.toLowerCase() === name.trim().toLowerCase())
    ) {
      return c.json({ error: "An album with that name already exists." }, 409);
    }
    const updated = store.updateAlbum(existing.id, {
      name: typeof name === "string" ? name.trim() : undefined,
      cover: cover as string | undefined,
    });
    return c.json({ album: updated });
  });

  app.delete("/api/albums/:id", (c) => {
    const existing = store.getAlbum(c.req.param("id"));
    if (!existing) return c.json({ error: "Album not found." }, 404);
    // Photos keep their album id and stay visible in All Photos.
    store.deleteAlbum(existing.id);
    return c.json({ deleted: true });
  });

  app.post("/api/presets", async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "Invalid request." }, 400);
    const { name, values } = parsed.value;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
      return c.json({ error: "Give the preset a name up to 60 characters." }, 400);
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      return c.json({ error: "Invalid preset values." }, 400);
    }
    const trimmed = name.trim();
    if (store.listPresets().some((preset) => preset.name.toLowerCase() === trimmed.toLowerCase())) {
      return c.json({ error: "A preset with that name already exists." }, 409);
    }
    const preset = { id: randomUUID(), name: trimmed, values: values as Record<string, never> };
    store.insertPreset({ id: preset.id, name: preset.name, values: preset.values });
    return c.json({ preset: { ...preset, category: "My Presets" } }, 201);
  });

  app.delete("/api/presets/:id", (c) => {
    store.deletePreset(c.req.param("id"));
    return c.json({ deleted: true });
  });

  app.get("/api/fs/browse", async (c) => {
    try {
      return c.json(await browse(c.req.query("path") || undefined, roots));
    } catch (error) {
      if (error instanceof BrowseError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  // Serve the production web build when it exists (API routes registered
  // above take precedence; anything else falls back to index.html).
  const indexHtml = path.join(config.webDistDir, "index.html");
  if (existsSync(indexHtml)) {
    app.use(async (c, next) => {
      if (c.req.method !== "GET" || c.req.path.startsWith("/api/")) return next();
      const target = path.normalize(path.join(config.webDistDir, c.req.path));
      if (!target.startsWith(config.webDistDir + path.sep) && target !== config.webDistDir) return next();
      const file = target === config.webDistDir ? indexHtml : target;
      if (existsSync(file)) {
        const stat = await fs.stat(file).catch(() => null);
        if (stat?.isFile()) return sendFile(c, file, mimeFor(file, STATIC_MIME, "application/octet-stream"));
      }
      return next();
    });
    app.notFound((c) => {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found." }, 404);
      return sendFile(c, indexHtml, "text/html; charset=utf-8");
    });
  } else {
    app.notFound((c) => c.json({ error: "Not found." }, 404));
  }

  return app;
}
