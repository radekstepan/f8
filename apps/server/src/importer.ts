import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { imageSizeFromFile } from "image-size/fromFile";
import {
  DEFAULT_EDIT,
  MAX_IMPORTS_PER_REQUEST,
  humanizeAlbumName,
  isImportableFilename,
  isRawFilename,
  readOrientation,
  readRawMetadata,
  resolveImportSelection,
} from "@f8/core";
import type { Album, ImportProgress } from "@f8/core";
import type { ServerConfig } from "./config.ts";
import { resolveWithinRoots } from "./fs-browse.ts";
import { RawDecodeError, decodeRawFullRes } from "./raw-decode.ts";
import type { DecodeRawFullRes } from "./raw-decode.ts";
import type { PhotoRow, Store, StoredEdit } from "./store.ts";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export type ImportStatus = "imported" | "relinked" | "duplicate";

export interface ImportOutcome {
  status: ImportStatus;
  row: PhotoRow;
  edit: StoredEdit;
}

export interface ScanReport {
  outcomes: ImportOutcome[];
  skipped: { path: string; reason: string }[];
  suppressedSidecars: number;
  truncated: boolean;
  /** Albums this scan created (empty when every target already existed). */
  albums: Album[];
}

const HEAD_SIZE = 1024 * 1024;
const FULL_META_BYTES = 32 * 1024 * 1024;
const MAX_SCAN_FILES = 2000;

async function hashFile(absPath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absPath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function readHead(absPath: string, fileSize: number): Promise<Buffer> {
  const length = Math.max(0, Math.min(HEAD_SIZE, fileSize));
  const handle = await fs.open(absPath, "r");
  try {
    const head = Buffer.alloc(length);
    await handle.read(head, 0, length, 0);
    return head;
  } finally {
    await handle.close();
  }
}

export interface ImportFileOptions {
  albumId?: string;
  location?: string;
  knownHash?: string;
  // Full-res RAW decode; defaults to the LibRaw toolchain. Tests inject a stub.
  decodeRaw?: DecodeRawFullRes;
}

// Import a file by reading it in place: the bytes are hashed for identity,
// described for display, and referenced by path. Nothing is copied. A known
// hash either relinks a moved file (same bytes, new path) or reports a
// duplicate, so edits always survive moves and reimports.
export async function importFileAtPath(
  store: Store,
  config: ServerConfig,
  absPath: string,
  opts: ImportFileOptions = {},
): Promise<ImportOutcome> {
  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat || !stat.isFile()) throw new ImportError("This file could not be found.");
  const filename = path.basename(absPath);
  if (!isImportableFilename(filename)) throw new ImportError("Unsupported file type.");
  const hash = opts.knownHash ?? (await hashFile(absPath));
  const existing = store.findByHash(hash);
  if (existing) {
    if (existing.kind === "file" && existing.path !== absPath) {
      store.updatePhotoLocation(existing.id, {
        path: absPath,
        fileSize: stat.size,
        mtime: Math.floor(stat.mtimeMs),
      });
      const row = store.getPhoto(existing.id);
      if (!row) throw new ImportError("This photo is already in the library.");
      return { status: "relinked", row, edit: store.getEdit(row.id) };
    }
    return { status: "duplicate", row: existing, edit: store.getEdit(existing.id) };
  }
  const raw = isRawFilename(filename);
  const head = await readHead(absPath, stat.size);
  const orientation = await readOrientation(head);
  let width = 0;
  let height = 0;
  if (raw) {
    // RAW or nothing: a failed decode is a per-file import failure, never
    // a silent low-res preview.
    const decode = opts.decodeRaw ?? ((file) => decodeRawFullRes(file, config.tmpDir));
    let fullRes;
    try {
      fullRes = await decode(absPath);
    } catch (error) {
      throw new ImportError(
        error instanceof RawDecodeError ? error.message : "This RAW file could not be decoded.",
      );
    }
    await fs.mkdir(config.previewsDir, { recursive: true });
    await fs.writeFile(path.join(config.previewsDir, `${hash}.jpg`), fullRes.bytes);
    // Decodes arrive upright with no orientation tag: store as-is.
    width = fullRes.width;
    height = fullRes.height;
  } else {
    try {
      const dims = await imageSizeFromFile(absPath);
      width = dims.width;
      height = dims.height;
    } catch {
      throw new ImportError("This file could not be decoded. Try JPEG, PNG, or WebP.");
    }
    // Recorded dimensions are upright (orientation 1), matching the browser
    // pipeline: EXIF-aware display must not rotate for EXIF again.
    if (orientation >= 5) {
      const swapped = width;
      width = height;
      height = swapped;
    }
  }
  const metaInput = stat.size <= FULL_META_BYTES ? new Uint8Array(await fs.readFile(absPath)) : head;
  const meta = await readRawMetadata(metaInput, raw ? "Imported RAW image" : "Imported image");
  const stamp = new Date().toISOString();
  const row: PhotoRow = {
    id: randomUUID(),
    hash,
    kind: "file",
    path: absPath,
    url: null,
    thumbnail_url: null,
    filename,
    title: filename.replace(/\.[^.]+$/, ""),
    width,
    height,
    camera: meta.camera,
    lens: meta.lens,
    iso: meta.iso,
    aperture: meta.aperture,
    shutter: meta.shutter,
    focal_length: meta.focalLength,
    date_taken: meta.date ?? new Date(stat.mtimeMs).toISOString(),
    location: opts.location ?? "",
    raw: raw ? 1 : 0,
    favorite: 0,
    rating: 0,
    album_id: opts.albumId ?? "imports",
    photographer: null,
    file_size: stat.size,
    mtime: Math.floor(stat.mtimeMs),
    created_at: stamp,
    updated_at: stamp,
  };
  store.insertPhoto(row);
  const edit = store.saveEdit(row.id, { ...DEFAULT_EDIT });
  return { status: "imported", row, edit };
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[\0-\x1f\x7f<>:"/\\|?*]/g, "_").trim();
  const trimmed = base.length > 180 ? base.slice(0, 180) : base;
  return trimmed.length ? trimmed : "imported-photo";
}

async function uniqueDestination(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext) || "imported-photo";
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = path.join(dir, attempt === 0 ? `${stem}${ext}` : `${stem}-${attempt + 1}${ext}`);
    const taken = await fs.stat(candidate).then(() => true).catch(() => false);
    if (!taken) return candidate;
  }
  return path.join(dir, `${stem}-${randomUUID().slice(0, 8)}${ext}`);
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    // The staging directory and the library can sit on different volumes.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
}

// Uploads arrive as bytes without a server path (browsers hide it), so they
// are stored under the library root in dated folders, then referenced like
// every other original. Known bytes dedupe before anything is written.
export async function importUpload(
  store: Store,
  config: ServerConfig,
  tmpPath: string,
  filename: string,
  opts: { albumId?: string; decodeRaw?: DecodeRawFullRes } = {},
): Promise<ImportOutcome> {
  const safe = sanitizeFilename(filename);
  if (!isImportableFilename(safe)) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw new ImportError("Choose a JPEG, PNG, WebP, RAW, or another supported image.");
  }
  const hash = await hashFile(tmpPath);
  const existing = store.findByHash(hash);
  if (existing) {
    await fs.unlink(tmpPath).catch(() => undefined);
    return { status: "duplicate", row: existing, edit: store.getEdit(existing.id) };
  }
  const now = new Date();
  const dir = path.join(config.libraryRoot, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
  await fs.mkdir(dir, { recursive: true });
  const dest = await uniqueDestination(dir, safe);
  await moveFile(tmpPath, dest);
  return importFileAtPath(store, config, dest, {
    albumId: opts.albumId,
    knownHash: hash,
    decodeRaw: opts.decodeRaw,
  });
}

interface ExpandedFile {
  file: string;
  /** Folder the file was reached through: the selected folder, or the parent dir of a loose file. */
  sourceDir: string;
}

async function collectImportable(dir: string, into: ExpandedFile[]): Promise<boolean> {
  const stack = [dir];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop() as string;
    const real = await fs.realpath(current).catch(() => null);
    if (!real || seen.has(real)) continue;
    seen.add(real);
    const dirents = await fs.readdir(current, { withFileTypes: true }).catch(() => null);
    if (!dirents) continue;
    for (const entry of dirents) {
      if (entry.name.startsWith(".")) continue;
      if (into.length >= MAX_SCAN_FILES) return true;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.isSymbolicLink()) stack.push(full);
      } else if (entry.isFile() && isImportableFilename(entry.name)) {
        into.push({ file: full, sourceDir: dir });
      }
    }
  }
  return false;
}

// Import explicit files and folders. Folders are scanned recursively;
// RAW+JPEG sidecar pairs collapse across the whole batch; every file imports
// sequentially so one bad file (or one huge RAW) cannot break the batch. The
// loop yields between files so hundreds of sequential imports never starve
// the event loop, and reports per-file progress for status UIs.
//
// Album filing: an explicitly chosen album wins for the whole batch.
// Otherwise each source folder files into its own human-named album
// ("2026-europe-trip" becomes "2026 Europe Trip"), matched
// case-insensitively against existing albums so reimports never spawn
// lookalikes. Albums materialize lazily on the first fresh import, so a
// scan that only finds duplicates leaves no empty album behind — and
// duplicates/relinks always keep their existing rows, so each file stays
// unique across the whole library no matter how often it is reimported.
export async function scanPaths(
  store: Store,
  config: ServerConfig,
  roots: string[],
  paths: string[],
  opts: { albumId?: string; decodeRaw?: DecodeRawFullRes; onProgress?: (progress: ImportProgress) => void } = {},
): Promise<ScanReport> {
  const expanded: ExpandedFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let truncated = false;
  for (const input of paths) {
    let confined: string;
    try {
      confined = await resolveWithinRoots(input, roots);
    } catch (error) {
      skipped.push({ path: input, reason: error instanceof Error ? error.message : "Unreadable location." });
      continue;
    }
    const stat = await fs.stat(confined).catch(() => null);
    if (!stat) {
      skipped.push({ path: input, reason: "This location could not be found." });
      continue;
    }
    if (!stat.isDirectory()) {
      if (!isImportableFilename(path.basename(confined))) {
        skipped.push({ path: input, reason: "Unsupported file type." });
        continue;
      }
      expanded.push({ file: confined, sourceDir: path.dirname(confined) });
      continue;
    }
    truncated = (await collectImportable(confined, expanded)) || truncated;
  }
  const seenFiles = new Map<string, string>();
  for (const entry of expanded) {
    if (!seenFiles.has(entry.file)) seenFiles.set(entry.file, entry.sourceDir);
  }
  const shims = [...seenFiles.entries()].map(([file, sourceDir]) => ({
    file,
    name: path.basename(file),
    type: isRawFilename(file) ? "" : "image/x",
    sourceDir,
  }));
  const { files: selected, suppressedSidecars } = resolveImportSelection(shims);
  const outcomes: ImportOutcome[] = [];
  const createdAlbums: Album[] = [];
  const batch = selected.slice(0, MAX_IMPORTS_PER_REQUEST);
  truncated = truncated || selected.length > MAX_IMPORTS_PER_REQUEST;
  const explicitAlbum = opts.albumId ? store.getAlbum(opts.albumId) : undefined;
  const targets = new Map<string, { id: string; name: string; created: boolean }>();
  const existingAlbums = explicitAlbum ? [] : store.listAlbums();
  for (const album of existingAlbums) {
    const key = album.name.toLowerCase();
    if (!targets.has(key)) targets.set(key, { id: album.id, name: album.name, created: true });
  }
  let sort = existingAlbums.length;
  const targetFor = (sourceDir: string): { id: string; name: string; created: boolean } => {
    // The explicit choice is pre-created, so the lazy-creation branch below
    // stands down for it naturally.
    if (explicitAlbum) return { id: explicitAlbum.id, name: explicitAlbum.name, created: true };
    const name = humanizeAlbumName(path.basename(sourceDir));
    const key = name.toLowerCase();
    let target = targets.get(key);
    if (!target) {
      target = { id: randomUUID(), name, created: false };
      targets.set(key, target);
    }
    return target;
  };
  opts.onProgress?.({ done: 0, total: batch.length });
  for (const [index, shim] of batch.entries()) {
    const target = targetFor(shim.sourceDir);
    try {
      const outcome = await importFileAtPath(store, config, shim.file, {
        albumId: target.id,
        decodeRaw: opts.decodeRaw,
      });
      if (outcome.status === "imported" && !target.created) {
        store.insertAlbum({ id: target.id, name: target.name, cover: "", sort: sort++ });
        target.created = true;
        createdAlbums.push({ id: target.id, name: target.name, cover: "" });
      }
      outcomes.push(outcome);
    } catch (error) {
      skipped.push({
        path: shim.file,
        reason: error instanceof ImportError ? error.message : "This file could not be imported.",
      });
    }
    opts.onProgress?.({ done: index + 1, total: batch.length });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { outcomes, skipped, suppressedSidecars, truncated, albums: createdAlbums };
}
