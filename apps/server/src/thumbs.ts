import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";
import { extractEmbeddedJpeg, readOrientation, stripExifApp1 } from "@f8/core";
import type { RawDecodeDeps } from "./raw-decode.ts";

// Grid thumbnails live next to the full previews, content-addressed by the
// same hash: "<hash>-thumb2.jpg". RAW thumbs are the camera's embedded JPEG
// preview sliced straight out of the file (milliseconds, no decode),
// rotated upright when the capture orientation demands it; rendered
// originals are downscaled through the JPEG encoder toolchain. Generation
// is lazy — the first /thumb request builds and caches the file, so imports
// stay untouched and existing libraries backfill on demand.

export const THUMB_SUFFIX = "-thumb2.jpg";
// Pre-rotation counterpart, removed opportunistically once its replacement
// exists. Portrait shots cached a sideways landscape thumb under this name.
const LEGACY_THUMB_SUFFIX = "-thumb.jpg";
// Long edge of downscaled rendered thumbs: crisp on retina grid cells,
// tens of KB instead of the multi-megabyte original.
const THUMB_LONG_EDGE = 640;
const THUMB_JPEG_QUALITY = "82";
// RAW files beyond this are never buffered for the embedded-preview scan;
// their /thumb falls back to the full preview instead of risking the heap.
const MAX_EMBEDDED_SCAN_BYTES = 256 * 1024 * 1024;

export function thumbPathFor(previewsDir: string, hash: string): string {
  return path.join(previewsDir, `${hash}${THUMB_SUFFIX}`);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

async function findEncoder(deps: RawDecodeDeps): Promise<{ name: string; path: string } | null> {
  for (const name of ["magick", "convert", "sips"]) {
    const found = await deps.which(name);
    if (found) return { name, path: found };
  }
  return null;
}

// Pixel transforms that upright EXIF orientations 2-8, per encoder CLI.
// Verified against ImageMagick's own -auto-orient on tagged references:
// rotations are clockwise degrees, flips mirror before any rotation.
const MAGICK_ORIENT_ARGS: Record<number, string[]> = {
  2: ["-flop"],
  3: ["-rotate", "180"],
  4: ["-flip"],
  5: ["-transpose"],
  6: ["-rotate", "90"],
  7: ["-transverse"],
  8: ["-rotate", "270"],
};

const SIPS_ORIENT_ARGS: Record<number, string[]> = {
  2: ["-f", "horizontal"],
  3: ["-r", "180"],
  4: ["-f", "vertical"],
  5: ["-f", "horizontal", "-r", "90"],
  6: ["-r", "90"],
  7: ["-f", "horizontal", "-r", "270"],
  8: ["-r", "270"],
};

// Full CLI invocation rotating src into dest for one EXIF orientation.
// Orientation 1 (or anything outside 2-8) is the caller's no-op: null.
export function orientArgsFor(encoder: string, orientation: number, src: string, dest: string): string[] | null {
  const table = encoder === "sips" ? SIPS_ORIENT_ARGS : MAGICK_ORIENT_ARGS;
  const transform = table[orientation];
  if (!transform) return null;
  if (encoder === "sips") return ["-s", "format", "jpeg", ...transform, src, "--out", dest];
  return [src, ...transform, "-quality", THUMB_JPEG_QUALITY, dest];
}

function storedDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    const dims = imageSize(bytes);
    return { width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

export interface EnsureThumbOptions {
  absPath: string;
  raw: boolean;
  hash: string;
  previewsDir: string;
  tmpDir: string;
  deps: RawDecodeDeps;
}

// Rotate tag-free JPEG bytes upright through the encoder toolchain, writing
// the result to target. Null on any failure (no encoder, bad status,
// non-JPEG output): the caller serves the upright full preview instead.
async function rotateThumb(
  clean: Uint8Array,
  orientation: number,
  target: string,
  tmpDir: string,
  deps: RawDecodeDeps,
): Promise<string | null> {
  const encoder = await findEncoder(deps);
  if (!encoder) return null;
  await fs.mkdir(tmpDir, { recursive: true });
  const tag = randomUUID();
  const stagedIn = path.join(tmpDir, `thumb-orient-${tag}.jpg`);
  const stagedOut = path.join(tmpDir, `thumb-rotated-${tag}.jpg`);
  try {
    await fs.writeFile(stagedIn, clean);
    const args = orientArgsFor(encoder.name, orientation, stagedIn, stagedOut);
    if (!args) return null;
    const encoded = await deps.run(encoder.path, args);
    if (encoded.status !== 0) return null;
    const bytes = await fs.readFile(stagedOut).catch(() => null);
    if (!bytes || !isJpeg(bytes)) return null;
    await fs.writeFile(target, bytes);
    return target;
  } finally {
    await fs.unlink(stagedIn).catch(() => undefined);
    await fs.unlink(stagedOut).catch(() => undefined);
  }
}

// Return the cached thumbnail path, generating it on first use. Best-effort
// by design: any failure resolves to null and the caller serves the display
// bytes instead — a missing thumb must never 404 a grid that used to load.
export async function ensureThumb(options: EnsureThumbOptions): Promise<string | null> {
  const { absPath, raw, hash, previewsDir, tmpDir, deps } = options;
  try {
    const target = thumbPathFor(previewsDir, hash);
    if (await fs.stat(target).then(() => true).catch(() => false)) return target;
    await fs.mkdir(previewsDir, { recursive: true });
    if (raw) {
      const stat = await fs.stat(absPath).catch(() => null);
      if (!stat || !stat.isFile() || stat.size > MAX_EMBEDDED_SCAN_BYTES) return null;
      const bytes = new Uint8Array(await fs.readFile(absPath));
      const embedded = extractEmbeddedJpeg(bytes);
      if (!embedded || !isJpeg(embedded)) return null;
      // Portrait-class captures (orientations 5-8) store the embedded
      // preview sideways — Sony writes landscape pixels with no tag at all —
      // so the slice must be rotated before it can serve the grid. The
      // full-res preview beside it is already upright; when rotation is
      // impossible the null below falls back to those bytes instead of a
      // sideways thumb. Previews already stored upright (some cameras
      // pre-rotate) only lose a misleading tag, no pixels change.
      const orientation = await readOrientation(bytes);
      if (orientation >= 5) {
        const stored = storedDimensions(embedded);
        if (stored && stored.height > stored.width) {
          await fs.writeFile(target, stripExifApp1(embedded));
        } else if (stored) {
          const rotated = await rotateThumb(stripExifApp1(embedded), orientation, target, tmpDir, deps);
          if (!rotated) return null;
        } else {
          await fs.writeFile(target, embedded);
        }
      } else {
        await fs.writeFile(target, embedded);
      }
      // Sideways landscape thumbs cached before rotation existed are replaced
      // now; drop the stale file so it never serves again.
      await fs.unlink(path.join(previewsDir, `${hash}${LEGACY_THUMB_SUFFIX}`)).catch(() => undefined);
      return target;
    }
    const encoder = await findEncoder(deps);
    if (!encoder) return null;
    await fs.mkdir(tmpDir, { recursive: true });
    const staged = path.join(tmpDir, `thumb-${randomUUID()}.jpg`);
    try {
      const args = encoder.name === "sips"
        ? ["-s", "format", "jpeg", "-Z", String(THUMB_LONG_EDGE), absPath, "--out", staged]
        : [absPath, "-resize", `${THUMB_LONG_EDGE}x${THUMB_LONG_EDGE}>`, "-quality", THUMB_JPEG_QUALITY, staged];
      const encoded = await deps.run(encoder.path, args);
      if (encoded.status !== 0) return null;
      const bytes = await fs.readFile(staged).catch(() => null);
      if (!bytes || !isJpeg(bytes)) return null;
      await fs.writeFile(target, bytes);
      return target;
    } finally {
      await fs.unlink(staged).catch(() => undefined);
    }
  } catch {
    return null;
  }
}
