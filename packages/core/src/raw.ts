import exifr from "exifr";

// Camera RAW extensions accepted at import. Browsers cannot decode RAW
// sensor data natively, so imports render the largest embedded JPEG
// preview: the IFD1 thumbnail exifr reads is often tiny, while the
// full-resolution preview lives in SubIFDs or later IFDs. The preview
// also inherits the RAW file's EXIF orientation, since the extracted
// bytes carry no EXIF of their own and would otherwise display sideways.
// Container formats outside TIFF (CR3, RAF, X3F, CRW) have no preview
// exifr can read and fail per-file instead of breaking the import.
export const RAW_EXTENSIONS = [
  "3fr", "arw", "cr2", "cr3", "crw", "dcr", "dng", "erf", "fff",
  "iiq", "k25", "kdc", "mef", "mos", "mrw", "nef", "nrw", "orf",
  "pef", "ptx", "raf", "raw", "rw2", "rwl", "sr2", "srf", "srw", "x3f",
] as const;

const RAW_EXTENSION_SET: ReadonlySet<string> = new Set(RAW_EXTENSIONS);
const JPEG_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "jpeg"]);

// Dot-extension list for the file picker's accept attribute. RAW files
// often carry an empty or generic MIME type, so image/* alone would hide
// them in the picker.
export const RAW_ACCEPT = RAW_EXTENSIONS.map((extension) => `.${extension}`).join(",");

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

function stemOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot <= 0 ? filename : filename.slice(0, dot);
  return stem.toLowerCase();
}

export function isRawFilename(filename: string): boolean {
  return RAW_EXTENSION_SET.has(extensionOf(filename));
}

function isJpegFilename(filename: string): boolean {
  return JPEG_EXTENSIONS.has(extensionOf(filename));
}

export interface ImportSelection<T> {
  files: T[];
  suppressedSidecars: number;
}

// Filter dropped/picked files down to importable photos. When a RAW file
// and a JPEG share a basename (the camera wrote a RAW+JPEG pair), only the
// RAW is kept so the same picture is not imported twice; only JPEG
// sidecars are suppressed, since cameras pair RAWs with JPEGs specifically.
export function resolveImportSelection<T extends { name: string; type: string }>(
  files: readonly T[],
): ImportSelection<T> {
  const importable = files.filter((file) => file.type.startsWith("image/") || isRawFilename(file.name));
  const rawStems = new Set<string>();
  for (const file of importable) {
    if (isRawFilename(file.name)) rawStems.add(stemOf(file.name));
  }
  const selected: T[] = [];
  let suppressedSidecars = 0;
  for (const file of importable) {
    if (!isRawFilename(file.name) && isJpegFilename(file.name) && rawStems.has(stemOf(file.name))) {
      suppressedSidecars += 1;
      continue;
    }
    selected.push(file);
  }
  return { files: selected, suppressedSidecars };
}

export interface RawMetadata {
  camera: string;
  lens: string;
  iso: number;
  aperture: string;
  shutter: string;
  focalLength: string;
  date: string | undefined;
}

function trimmed(value: number): string {
  return String(Number(value.toFixed(2)));
}

function formatShutter(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "-";
  if (seconds >= 1) return `${trimmed(seconds)} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

// Map exifr's translated tags onto photo fields. Unknown shapes fall back
// to the same placeholders regular imports use.
export function formatRawMetadata(tags: Record<string, unknown> | undefined | null): RawMetadata {
  const make = typeof tags?.["Make"] === "string" ? tags["Make"] : "";
  const model = typeof tags?.["Model"] === "string" ? tags["Model"] : "";
  const lens = typeof tags?.["LensModel"] === "string" ? tags["LensModel"] : "";
  const iso = typeof tags?.["ISO"] === "number" && Number.isFinite(tags["ISO"]) ? tags["ISO"] : 0;
  const fNumber = tags?.["FNumber"];
  const focalLength = tags?.["FocalLength"];
  const taken = tags?.["DateTimeOriginal"];
  const maker = make.split(/\s+/)[0] ?? "";
  const cameraName = maker && model.toLowerCase().startsWith(maker.toLowerCase())
    ? model
    : `${make} ${model}`.trim();
  return {
    camera: cameraName || "Imported RAW image",
    lens: lens || "No camera metadata",
    iso,
    aperture: typeof fNumber === "number" && Number.isFinite(fNumber) && fNumber > 0 ? `f/${trimmed(fNumber)}` : "-",
    shutter: formatShutter(tags?.["ExposureTime"]),
    focalLength: typeof focalLength === "number" && Number.isFinite(focalLength) && focalLength > 0 ? `${trimmed(focalLength)} mm` : "-",
    date: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : undefined,
  };
}

// Head bytes read to map the TIFF structure. IFD entries and SubIFD
// offsets sit near the file start; the JPEG payloads they point at are
// sliced separately, so multi-megabyte RAWs never load fully.
const TIFF_HEAD_SIZE = 1024 * 1024;
const MAX_IFD_ENTRIES = 512;
const MAX_IFDS = 64;

export interface JpegPreviewCandidate {
  offset: number;
  length: number;
  width: number;
  height: number;
  /** TIFF compression tag: 6 (old JPEG), 7 (JPEG), or 0 when unknown. */
  compression: number;
}

// Scan the TIFF structure for embedded JPEGs: every IFD in the chain plus
// every SubIFD, recursively. JPEG payloads appear either as strips under a
// JPEG compression tag or as IFD1-style interchange offsets. Returns
// candidates largest-first; every read is bounds-checked so corrupt data
// yields fewer candidates instead of an exception.
export function findJpegPreviews(head: Uint8Array, fileSize: number): JpegPreviewCandidate[] {
  const candidates: JpegPreviewCandidate[] = [];
  if (head.length < 8 || fileSize < 8) return candidates;
  const littleEndian = head[0] === 0x49 && head[1] === 0x49;
  const bigEndian = head[0] === 0x4d && head[1] === 0x4d;
  if (!littleEndian && !bigEndian) return candidates;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const u16 = (offset: number): number | undefined =>
    offset >= 0 && offset + 2 <= head.length ? view.getUint16(offset, littleEndian) : undefined;
  const u32 = (offset: number): number | undefined =>
    offset >= 0 && offset + 4 <= head.length ? view.getUint32(offset, littleEndian) : undefined;
  // Magic 42 is classic TIFF; 85 is Panasonic RW2, which reuses the TIFF
  // IFD layout under its own magic. Anything else is walked by the exifr
  // fallback instead.
  if (u16(2) !== 42 && u16(2) !== 85) return candidates;
  const firstIfd = u32(4);
  if (firstIfd === undefined) return candidates;

  const readValues = (type: number, count: number, valueField: number): number[] | undefined => {
    if ((type !== 3 && type !== 4) || count < 1 || count > 256) return undefined;
    const size = type === 3 ? 2 : 4;
    if (size * count <= 4) {
      const values: number[] = [];
      for (let index = 0; index < count; index++) {
        const shift = littleEndian ? index * size * 8 : 32 - (index + 1) * size * 8;
        values.push((valueField >>> shift) & (size === 2 ? 0xffff : 0xffffffff));
      }
      return values;
    }
    if (valueField + size * count > head.length) return undefined;
    const values: number[] = [];
    for (let index = 0; index < count; index++) {
      values.push(size === 2 ? view.getUint16(valueField + index * 2, littleEndian) : view.getUint32(valueField + index * 4, littleEndian));
    }
    return values;
  };

  const queue: number[] = [firstIfd];
  const visited = new Set<number>();
  const seen = new Set<string>();
  while (queue.length && visited.size < MAX_IFDS) {
    const at = queue.shift()!;
    if (visited.has(at) || at < 8 || at + 2 > head.length) continue;
    visited.add(at);
    const count = u16(at);
    if (count === undefined || count > MAX_IFD_ENTRIES) continue;
    let width = 0;
    let height = 0;
    let compression = 0;
    let stripOffsets: number[] | undefined;
    let stripLengths: number[] | undefined;
    let jpegOffset = 0;
    let jpegLength = 0;
    const subIfds: number[] = [];
    for (let index = 0; index < count; index++) {
      const p = at + 2 + index * 12;
      if (p + 12 > head.length) break;
      const tag = view.getUint16(p, littleEndian);
      const type = view.getUint16(p + 2, littleEndian);
      const tagCount = view.getUint32(p + 4, littleEndian);
      const valueField = view.getUint32(p + 8, littleEndian);
      switch (tag) {
        case 256:
        case 257:
        case 259:
        case 513:
        case 514: {
          if (tagCount !== 1) break;
          const values = readValues(type, 1, valueField);
          const value = values?.[0] ?? 0;
          if (tag === 256) width = value;
          else if (tag === 257) height = value;
          else if (tag === 259) compression = value;
          else if (tag === 513) jpegOffset = value;
          else jpegLength = value;
          break;
        }
        case 273:
          stripOffsets = readValues(type, tagCount, valueField);
          break;
        case 279:
          stripLengths = readValues(type, tagCount, valueField);
          break;
        case 330: {
          const values = readValues(type, tagCount, valueField);
          if (values) subIfds.push(...values);
          break;
        }
      }
    }
    const next = u32(at + 2 + count * 12);
    if (next !== undefined && next !== 0) queue.push(next);
    for (const sub of subIfds) queue.push(sub);
    const add = (offset: number, length: number) => {
      if (offset <= 0 || length <= 0 || offset + length > fileSize) return;
      const key = `${offset}:${length}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ offset, length, width, height, compression });
    };
    if ((compression === 6 || compression === 7) && stripOffsets?.length === 1 && stripLengths?.length === 1) {
      add(stripOffsets[0]!, stripLengths[0]!);
    } else if (jpegOffset > 0 && jpegLength > 0) {
      add(jpegOffset, jpegLength);
    }
  }
  // Largest area first; old-style JPEG (tables stored separately, riskier
  // to slice raw) loses ties against self-contained payloads.
  candidates.sort((a, b) => b.width * b.height - a.width * a.height || Number(a.compression === 6) - Number(b.compression === 6) || b.length - a.length);
  return candidates;
}

async function readRange(file: Blob | Uint8Array, start: number, end: number): Promise<Uint8Array> {
  if (file instanceof Uint8Array) return file.subarray(start, Math.min(end, file.length));
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

// Extract the largest embedded JPEG preview so the RAW file can be
// displayed and edited like any other import. Falls back to exifr's IFD1
// thumbnail for layouts this scan cannot reach (including mislabeled
// JPEGs). Rejects when the file has no readable embedded preview.
export async function extractRawPreview(file: Blob | Uint8Array): Promise<Blob> {
  const fileSize = file instanceof Uint8Array ? file.length : file.size;
  if (fileSize >= 8) {
    const head = await readRange(file, 0, Math.min(TIFF_HEAD_SIZE, fileSize));
    for (const candidate of findJpegPreviews(head, fileSize)) {
      if (candidate.offset + candidate.length > fileSize || candidate.length < 2) continue;
      const bytes = await readRange(file, candidate.offset, candidate.offset + candidate.length);
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        return new Blob([bytes as BlobPart], { type: "image/jpeg" });
      }
    }
  }
  let bytes: Uint8Array | undefined;
  try {
    const thumbnail = await exifr.thumbnail(file);
    bytes = thumbnail instanceof Uint8Array ? thumbnail : undefined;
  } catch {
    bytes = undefined;
  }
  if (!bytes || bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("This RAW file has no embedded preview this browser can read.");
  }
  return new Blob([bytes as BlobPart], { type: "image/jpeg" });
}

// Best-effort camera metadata for imported RAWs; never throws.
export async function readRawMetadata(file: Blob | Uint8Array): Promise<RawMetadata> {
  try {
    return formatRawMetadata(await exifr.parse(file));
  } catch {
    return formatRawMetadata(undefined);
  }
}

export interface RawImport {
  preview: Blob;
  metadata: RawMetadata;
}

// Best-effort EXIF orientation (1-8); 1 when missing or unreadable.
export async function readOrientation(input: Blob | Uint8Array): Promise<number> {
  try {
    const value = await exifr.orientation(input);
    return value !== undefined && value >= 1 && value <= 8 ? value : 1;
  } catch {
    return 1;
  }
}

// Embed an EXIF orientation tag in JPEG bytes: a minimal APP1 segment is
// inserted after SOI, replacing any existing EXIF APP1 so the orientation
// is never duplicated. Upright images and non-JPEG input pass through
// untouched. Pure bytes, no re-encode, so there is no quality loss.
export function injectExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const value = Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : 1;
  if (value === 1) return jpeg;
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const app1 = new Uint8Array([
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, value, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const kept: Uint8Array[] = [jpeg.subarray(0, 2)];
  let pos = 2;
  const end = jpeg.length;
  while (pos + 2 <= end) {
    if (jpeg[pos] !== 0xff) break;
    const marker = jpeg[pos + 1] ?? 0;
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (pos + 4 > end) break;
    const length = ((jpeg[pos + 2] ?? 0) << 8) | (jpeg[pos + 3] ?? 0);
    if (length < 2 || pos + 2 + length > end) break;
    const start = pos;
    pos += 2 + length;
    const isExif = marker === 0xe1 && length >= 8 &&
      jpeg[start + 4] === 0x45 && jpeg[start + 5] === 0x78 &&
      jpeg[start + 6] === 0x69 && jpeg[start + 7] === 0x66 &&
      jpeg[start + 8] === 0x00 && jpeg[start + 9] === 0x00;
    if (!isExif) kept.push(jpeg.subarray(start, pos));
  }
  kept.push(jpeg.subarray(pos));
  const out = new Uint8Array(kept.reduce((size, part) => size + part.length, app1.length));
  let at = 0;
  const first = kept[0]!;
  out.set(first, at);
  at += first.length;
  out.set(app1, at);
  at += app1.length;
  for (let index = 1; index < kept.length; index++) {
    const part = kept[index]!;
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// Give the extracted preview the RAW file's orientation. The sliced bytes
// carry no EXIF of their own, so without this the import pipeline (which
// relies on browser EXIF auto-orientation, like regular JPEG imports)
// would display portrait shots sideways.
async function applyRawOrientation(source: Blob | Uint8Array, preview: Blob): Promise<Blob> {
  const orientation = await readOrientation(source);
  if (orientation === 1) return preview;
  const fixed = injectExifOrientation(new Uint8Array(await preview.arrayBuffer()), orientation);
  return new Blob([fixed as BlobPart], { type: "image/jpeg" });
}

export async function decodeRawImport(file: Blob | Uint8Array): Promise<RawImport> {
  const preview = await extractRawPreview(file);
  const oriented = await applyRawOrientation(file, preview);
  const metadata = await readRawMetadata(file);
  return { preview: oriented, metadata };
}
