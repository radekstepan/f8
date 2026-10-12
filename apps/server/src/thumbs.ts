import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { extractEmbeddedJpeg } from "@f8/core";
import type { RawDecodeDeps } from "./raw-decode.ts";

// Grid thumbnails live next to the full previews, content-addressed by the
// same hash: "<hash>-thumb.jpg". RAW thumbs are the camera's embedded JPEG
// preview sliced straight out of the file (milliseconds, no decode);
// rendered originals are downscaled through the JPEG encoder toolchain.
// Generation is lazy — the first /thumb request builds and caches the file,
// so imports stay untouched and existing libraries backfill on demand.

export const THUMB_SUFFIX = "-thumb.jpg";
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

export interface EnsureThumbOptions {
  absPath: string;
  raw: boolean;
  hash: string;
  previewsDir: string;
  tmpDir: string;
  deps: RawDecodeDeps;
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
      const embedded = extractEmbeddedJpeg(new Uint8Array(await fs.readFile(absPath)));
      if (!embedded || !isJpeg(embedded)) return null;
      await fs.writeFile(target, embedded);
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
