import exifr from "exifr";

// Camera RAW extensions accepted at import. Browsers cannot decode RAW
// sensor data natively, so imports render the embedded JPEG preview via
// exifr (TIFF-based formats such as CR2, NEF, ARW, and DNG extract
// reliably). Container formats outside TIFF (CR3, RAF, X3F, CRW) have no
// preview exifr can read and fail per-file instead of breaking the import.
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
  return {
    camera: `${make} ${model}`.trim() || "Imported RAW image",
    lens: lens || "No camera metadata",
    iso,
    aperture: typeof fNumber === "number" && Number.isFinite(fNumber) && fNumber > 0 ? `f/${trimmed(fNumber)}` : "-",
    shutter: formatShutter(tags?.["ExposureTime"]),
    focalLength: typeof focalLength === "number" && Number.isFinite(focalLength) && focalLength > 0 ? `${trimmed(focalLength)} mm` : "-",
    date: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : undefined,
  };
}

// Extract the embedded JPEG preview so the RAW file can be displayed and
// edited like any other import. Rejects when the file has no readable
// embedded preview.
export async function extractRawPreview(file: Blob | Uint8Array): Promise<Blob> {
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

export async function decodeRawImport(file: Blob | Uint8Array): Promise<RawImport> {
  const preview = await extractRawPreview(file);
  const metadata = await readRawMetadata(file);
  return { preview, metadata };
}
