import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { imageSize } from "image-size";

const runFile = promisify(execFile);

export class RawDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawDecodeError";
  }
}

// Full sensor-resolution image decoded from a camera RAW file. The pixels
// are already upright (the decoder applies the EXIF flip) and carry no
// orientation tag, so importers must store width/height as-is.
export interface DecodedRaw {
  bytes: Uint8Array;
  width: number;
  height: number;
}

// Full-res RAW decode. Throws RawDecodeError when the toolchain is missing
// or the file cannot be decoded — the importer turns that into a per-file
// failure instead of silently importing a low-res preview. Injected in
// tests; production uses decodeRawFullRes bound to the server temp dir.
export type DecodeRawFullRes = (absPath: string) => Promise<DecodedRaw>;

export interface RawDecodeDeps {
  which(cmd: string): Promise<string | null>;
  run(cmd: string, args: string[]): Promise<{ status: number; stderr: string }>;
}

async function findOnPath(cmd: string): Promise<string | null> {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0);
  for (const dir of dirs) {
    const full = path.join(dir, cmd);
    try {
      await fs.access(full, fs.constants.X_OK);
      return full;
    } catch {
      // Not executable here; keep searching.
    }
  }
  return null;
}

async function runCommand(cmd: string, args: string[]): Promise<{ status: number; stderr: string }> {
  try {
    const { stderr } = await runFile(cmd, args, { timeout: 300000, maxBuffer: 1024 * 1024 });
    return { status: 0, stderr: String(stderr ?? "") };
  } catch (error) {
    const details = error as { code?: unknown; stderr?: unknown; message?: unknown; killed?: unknown };
    if (details.killed === true) return { status: 1, stderr: "timed out after 5 minutes" };
    const stderr = typeof details.stderr === "string" && details.stderr.length > 0
      ? details.stderr
      : typeof details.message === "string" ? details.message : "decode failed";
    const status = typeof details.code === "number" ? details.code : 1;
    return { status: status === 0 ? 1 : status, stderr };
  }
}

const defaultDeps: RawDecodeDeps = { which: findOnPath, run: runCommand };

// Real toolchain probes for production routes (thumbnail downscaling);
// tests inject stubs through AppContext instead.
export const defaultToolDeps: RawDecodeDeps = defaultDeps;

// LibRaw decode: camera white balance, sRGB output, AHD interpolation,
// TIFF intermediate (libraw cannot write JPEG). Quality 92 keeps a 24MP
// decode around 3-5MB — the preview cache stays proportional to the library.
const DECODE_ARGS = ["-w", "-T", "-o", "1", "-q", "3"];
const JPEG_QUALITY = "92";
const ENCODERS = ["magick", "convert", "sips"] as const;

function detail(stderr: string): string {
  return stderr.trim().split("\n").slice(-3).join(" ").slice(-300);
}

// Decode a camera RAW file at full sensor resolution via LibRaw
// (dcraw_emu) plus a TIFF-to-JPEG encoder. Temp files are always removed.
export async function decodeRawFullRes(
  absPath: string,
  tmpDir: string,
  deps: RawDecodeDeps = defaultDeps,
): Promise<DecodedRaw> {
  const decoder = await deps.which("dcraw_emu");
  if (!decoder) {
    throw new RawDecodeError(
      "LibRaw is not installed (dcraw_emu was not found). Install it to import RAW files: brew install libraw",
    );
  }
  let encoder: { name: (typeof ENCODERS)[number]; path: string } | null = null;
  for (const name of ENCODERS) {
    const found = await deps.which(name);
    if (found) {
      encoder = { name, path: found };
      break;
    }
  }
  if (!encoder) {
    throw new RawDecodeError(
      "No JPEG encoder found (looked for magick, convert, sips). Install ImageMagick to import RAW files: brew install imagemagick",
    );
  }
  await fs.mkdir(tmpDir, { recursive: true });
  const tag = randomUUID();
  const tiffPath = path.join(tmpDir, `raw-${tag}.tif`);
  const jpgPath = path.join(tmpDir, `raw-${tag}.jpg`);
  try {
    const decoded = await deps.run(decoder, [...DECODE_ARGS, "-Z", tiffPath, absPath]);
    if (decoded.status !== 0) {
      throw new RawDecodeError(`This RAW file could not be decoded (${detail(decoded.stderr)}).`);
    }
    try {
      await fs.access(tiffPath);
    } catch {
      throw new RawDecodeError("The RAW decoder produced no output for this file.");
    }
    const encodeArgs = encoder.name === "sips"
      ? ["-s", "format", "jpeg", tiffPath, "--out", jpgPath]
      : [tiffPath, "-quality", JPEG_QUALITY, jpgPath];
    const encoded = await deps.run(encoder.path, encodeArgs);
    if (encoded.status !== 0) {
      throw new RawDecodeError(`The decoded RAW image could not be encoded (${detail(encoded.stderr)}).`);
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(jpgPath);
    } catch {
      throw new RawDecodeError("The JPEG encoder produced no output for this file.");
    }
    if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new RawDecodeError("The encoder output for this RAW file is not a JPEG.");
    }
    try {
      const dims = imageSize(bytes);
      return { bytes, width: dims.width, height: dims.height };
    } catch {
      throw new RawDecodeError("The decoded RAW image could not be measured.");
    }
  } finally {
    await fs.unlink(tiffPath).catch(() => undefined);
    await fs.unlink(jpgPath).catch(() => undefined);
  }
}
