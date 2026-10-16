// Album-view export: filename mapping, progress copy, and a dependency-free
// ZIP writer for the "export album view" flow (album page → confirm format +
// quality → progress → one zipped download).
//
// The writer stores entries uncompressed on purpose: exported photos are
// already-compressed JPEG/PNG/WebP bytes, so DEFLATE would buy single-digit
// percents at the cost of a compression dependency in the single-file web
// bundle — stored entries keep the download byte-exact and the bundle lean.
// Readers (Finder, Explorer, unzip) open stored archives like any other zip.

import { importPercent } from "./raw.js";

/** Batch exports render at full source resolution (the dialog's "Original source size"). */
export const ALBUM_EXPORT_MAX_SIZE = 10000;

/** The export pipeline's formats (canvas encoders — TIFF has none, so it stays out). */
export const ALBUM_EXPORT_FORMATS = [
  { value: "jpeg", label: "JPEG - Best for sharing" },
  { value: "png", label: "PNG - Lossless quality" },
  { value: "webp", label: "WebP - Smaller file size" },
] as const;

export type AlbumExportFormat = (typeof ALBUM_EXPORT_FORMATS)[number]["value"];

/** File extension for an export format (JPEG keeps its three-letter form). */
export function albumExportExtension(format: string): string {
  return format === "jpeg" ? "jpg" : format;
}

// Same illegal-character set as the single-photo export filename: the zip
// must extract cleanly on Windows, macOS, and Linux alike.
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/** Strip the source extension and sanitize for cross-platform extraction. */
export function albumExportBasename(photoName: string): string {
  const base = photoName.replace(/\.[^.]+$/, "").replace(UNSAFE_FILENAME_CHARS, "-").trim();
  // Dot-only leftovers ("..") would escape the archive on extraction.
  if (!base || base === "." || base === "..") return "photo";
  return base;
}

/**
 * Unique member filename inside the zip: `used` tracks names already taken
 * (case-insensitively, for Windows/macOS disks) and collisions gain a
 * ` (2)`-style suffix before the extension. The chosen name is added to
 * `used`, so callers pass one set across the whole batch.
 */
export function albumExportFilename(photoName: string, format: string, used: Set<string>): string {
  const base = albumExportBasename(photoName);
  const ext = albumExportExtension(format);
  const candidate = (n: number): string => (n === 1 ? `${base}.${ext}` : `${base} (${n}).${ext}`);
  let n = 1;
  while (used.has(candidate(n).toLowerCase())) n += 1;
  const name = candidate(n);
  used.add(name.toLowerCase());
  return name;
}

/** Download filename for the finished archive, named after the collection. */
export function albumExportZipName(collectionTitle: string): string {
  const base = collectionTitle.replace(UNSAFE_FILENAME_CHARS, "-").trim() || "photos";
  return `${base}-export.zip`;
}

// Persistent status line for batch exports, mirroring the import toast copy:
// file counts plus a % estimate, collapsing to a bare label without a total.
export function formatAlbumExportProgress(done: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "Exporting…";
  const clamped = Math.max(0, Math.min(Number.isFinite(done) ? Math.floor(done) : 0, Math.floor(total)));
  return `Exporting ${clamped} of ${Math.floor(total)} (${importPercent(clamped, total)}%)…`;
}

/** Completion summary for the batch export toast. */
export function formatAlbumExportSummary(exported: number, failed: number): string {
  if (exported <= 0 && failed <= 0) return "Nothing to export.";
  const notes = [
    exported > 0 ? `${exported} ${exported === 1 ? "photo" : "photos"} exported as a zip file.` : "",
    failed > 0 ? `${failed} ${failed === 1 ? "photo" : "photos"} could not be exported.` : "",
  ];
  return notes.filter(Boolean).join(" ");
}

// CRC-32 (ISO 3309): the integrity check stored per zip member. Table-driven,
// so multi-megabyte photos checksum in milliseconds.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (CRC_TABLE[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipStoreEntry {
  /** Member path inside the archive (UTF-8, `/` separators). */
  name: string;
  data: Uint8Array;
}

// MS-DOS timestamp for the member headers: second resolution, from the
// current local time. Deterministic content never depends on it.
function dosDateTime(now: Date): { time: number; date: number } {
  const time = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() >> 1) & 31);
  const date = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  return { time, date };
}

/**
 * Pack entries as a stored (method 0) ZIP archive: local headers + data,
 * then the central directory and end record. Throws on >65535 entries or a
 * >4GB archive (the 32-bit zip32 limits) rather than writing a corrupt file.
 */
export function zipStoreFiles(entries: readonly ZipStoreEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > 0xffff) throw new Error("Too many files for one zip archive.");
  const encoder = new TextEncoder();
  const names = entries.map((entry) => encoder.encode(entry.name));
  let total = 22; // End-of-central-directory record.
  for (let i = 0; i < entries.length; i++) {
    const name = names[i] ?? new Uint8Array();
    const data = entries[i]?.data ?? new Uint8Array();
    total += 30 + name.length + data.length + 46 + name.length;
  }
  if (total > 0xffffffff) throw new Error("This export is too large for one zip archive.");
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const { time, date } = dosDateTime(new Date());
  // Bit 11 marks UTF-8 filenames; method 0 stores without compression.
  const flags = 0x0800;
  const offsets: number[] = [];
  let at = 0;
  for (let i = 0; i < entries.length; i++) {
    const name = names[i] ?? new Uint8Array();
    const data = entries[i]?.data ?? new Uint8Array();
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true); // Local file header signature.
    view.setUint16(at + 4, 20, true); // Version needed to extract (2.0).
    view.setUint16(at + 6, flags, true);
    view.setUint16(at + 8, 0, true); // Method: stored.
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, date, true);
    view.setUint32(at + 14, crc32(data), true);
    view.setUint32(at + 18, data.length, true);
    view.setUint32(at + 22, data.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true); // No extra field.
    out.set(name, at + 30);
    out.set(data, at + 30 + name.length);
    at += 30 + name.length + data.length;
  }
  const centralAt = at;
  for (let i = 0; i < entries.length; i++) {
    const name = names[i] ?? new Uint8Array();
    const data = entries[i]?.data ?? new Uint8Array();
    view.setUint32(at, 0x02014b50, true); // Central directory signature.
    view.setUint16(at + 4, 63, true); // Version made by (6.3, Unix).
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, flags, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, date, true);
    view.setUint32(at + 16, crc32(data), true);
    view.setUint32(at + 20, data.length, true);
    view.setUint32(at + 24, data.length, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint16(at + 30, 0, true); // No extra field.
    view.setUint16(at + 32, 0, true); // No comment.
    view.setUint16(at + 34, 0, true); // Disk number.
    view.setUint16(at + 36, 0, true); // Internal attributes.
    view.setUint32(at + 38, 0, true); // External attributes.
    view.setUint32(at + 42, offsets[i] ?? 0, true); // Local header offset.
    out.set(name, at + 46);
    at += 46 + name.length;
  }
  view.setUint32(at, 0x06054b50, true); // End-of-central-directory signature.
  view.setUint16(at + 4, 0, true); // Disk number.
  view.setUint16(at + 6, 0, true); // Central directory start disk.
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralAt, true); // Central directory size.
  view.setUint32(at + 16, centralAt, true); // Central directory offset.
  view.setUint16(at + 20, 0, true); // No comment.
  return out;
}
