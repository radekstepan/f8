import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import type { DecodeRawFullRes, RawDecodeDeps } from "./raw-decode.ts";
import { createStore } from "./store.ts";
import type { Store } from "./store.ts";

// Minimal valid 24-bit BMP: header math only, pixels all black.
export function makeBmp(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + rowSize * height);
  buf.write("BM", 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  return buf;
}

function u16(value: number): [number, number] {
  return [(value >> 8) & 0xff, value & 0xff];
}

// Minimal JPEG carrying real dimensions: SOI + APP0 + SOF0 + EOI. The APP0
// matters: header parsers walk segment by segment and real files never put
// SOF0 first, so a bare SOI+SOF0 would exercise nothing realistic.
export function makeJpeg(width: number, height: number): Buffer {
  const [hh, hl] = u16(height);
  const [wh, wl] = u16(width);
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    hh, hl, wh, wl, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

// Minimal JPEG with an EXIF orientation tag, for the upright-dimensions rule.
export function makeJpegWithOrientation(width: number, height: number, orientation: number): Buffer {
  const exif = Buffer.from([
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const jpeg = makeJpeg(width, height);
  return Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
}

export interface TiffPreviewOptions {
  /** EXIF orientation tag on the TIFF itself (the capture orientation). */
  orientation?: number;
  /** EXIF orientation tag inside the embedded JPEG (cameras that tag the preview too). */
  embeddedOrientation?: number;
}

// Minimal little-endian TIFF whose single JPEG-compressed strip is the whole
// embedded preview. Enough structure for the TIFF scan, exifr, and image-size.
export function makeTiffWithJpeg(width: number, height: number, opts: TiffPreviewOptions = {}): Buffer {
  const jpeg = opts.embeddedOrientation === undefined
    ? makeJpeg(width, height)
    : makeJpegWithOrientation(width, height, opts.embeddedOrientation);
  const entries = opts.orientation === undefined ? 5 : 6;
  const jpegOffset = 8 + 2 + entries * 12 + 4;
  const buf = Buffer.alloc(jpegOffset + jpeg.length);
  buf.writeUInt16LE(0x4949, 0);
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(entries, 8);
  const entry = (index: number, tag: number, type: number, count: number, value: number): void => {
    const at = 8 + 2 + index * 12;
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(count, at + 4);
    buf.writeUInt32LE(value, at + 8);
  };
  entry(0, 256, 3, 1, width);
  entry(1, 257, 3, 1, height);
  entry(2, 259, 3, 1, 7);
  entry(3, 273, 4, 1, jpegOffset);
  entry(4, 279, 4, 1, jpeg.length);
  if (opts.orientation !== undefined) entry(5, 274, 3, 1, opts.orientation);
  buf.writeUInt32LE(0, 8 + 2 + entries * 12);
  jpeg.copy(buf, jpegOffset);
  return buf;
}

export interface TestContext {
  dir: string;
  store: Store;
  app: ReturnType<typeof createApp>;
  close: () => void;
}

// Route tests never touch the real LibRaw toolchain: RAW imports decode to
// a fixed full-res stub unless the test overrides it (e.g. with a failure).
export function stubRawDecode(width = 61, height = 41): DecodeRawFullRes {
  return async () => {
    const bytes = makeJpeg(width, height);
    return { bytes, width, height };
  };
}

export function createTestContext(overrides: { decodeRaw?: DecodeRawFullRes; thumbDeps?: RawDecodeDeps } = {}): TestContext {
  // realpath: tmpdir can sit behind a symlink (/var -> /private/var), and
  // root confinement compares real paths.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "f8-test-")));
  const config = {
    ...loadConfig({}),
    dataDir: path.join(dir, "data"),
    dbPath: path.join(dir, "data", "f8.db"),
    previewsDir: path.join(dir, "data", "previews"),
    tmpDir: path.join(dir, "data", "tmp"),
    libraryRoot: path.join(dir, "library"),
    roots: [dir],
    webDistDir: path.join(dir, "no-web-dist"),
  };
  const db = openDatabase(config.dbPath);
  const store = createStore(db);
  const app = createApp({
    config,
    store,
    roots: [dir],
    decodeRaw: overrides.decodeRaw ?? stubRawDecode(),
    // Route tests never touch the real encoder toolchain either: rendered
    // thumbs fall back to the original unless a test injects thumbDeps.
    thumbDeps: overrides.thumbDeps ?? { which: async () => null, run: async () => ({ status: 1, stderr: "no encoder" }) },
  });
  return {
    dir,
    store,
    app,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
