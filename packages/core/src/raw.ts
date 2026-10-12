import exifr from "exifr";

// Camera RAW extensions accepted at import. The server decodes these at
// full sensor resolution (LibRaw); there is intentionally no embedded-JPEG
// fallback — a file that cannot be decoded fails its import loudly instead
// of entering the library as a misleading low-res preview.
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

// Rendered image extensions accepted at import alongside RAW. These decode
// directly (browser or server) and never need preview extraction.
export const RENDERED_EXTENSIONS = [
  "avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg",
  "png", "svg", "tif", "tiff", "webp",
] as const;

const RENDERED_EXTENSION_SET: ReadonlySet<string> = new Set(RENDERED_EXTENSIONS);

// True for any filename the library accepts: camera RAW or rendered image.
// Used by the server for path-based imports, where no MIME type exists.
export function isImportableFilename(filename: string): boolean {
  return isRawFilename(filename) || RENDERED_EXTENSION_SET.has(extensionOf(filename));
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
export function formatRawMetadata(tags: Record<string, unknown> | undefined | null, fallbackCamera = "Imported RAW image"): RawMetadata {
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
    camera: cameraName || fallbackCamera,
    lens: lens || "No camera metadata",
    iso,
    aperture: typeof fNumber === "number" && Number.isFinite(fNumber) && fNumber > 0 ? `f/${trimmed(fNumber)}` : "-",
    shutter: formatShutter(tags?.["ExposureTime"]),
    focalLength: typeof focalLength === "number" && Number.isFinite(focalLength) && focalLength > 0 ? `${trimmed(focalLength)} mm` : "-",
    date: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : undefined,
  };
}

// Best-effort camera metadata for imported RAWs; never throws.
export async function readRawMetadata(file: Blob | Uint8Array, fallbackCamera = "Imported RAW image"): Promise<RawMetadata> {
  try {
    return formatRawMetadata(await exifr.parse(file), fallbackCamera);
  } catch {
    return formatRawMetadata(undefined, fallbackCamera);
  }
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
