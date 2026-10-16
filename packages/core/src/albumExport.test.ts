import { describe, expect, it } from "vitest";
import {
  ALBUM_EXPORT_FORMATS,
  albumExportBasename,
  albumExportExtension,
  albumExportFilename,
  albumExportZipName,
  crc32,
  formatAlbumExportProgress,
  formatAlbumExportSummary,
  zipStoreFiles,
} from "./albumExport.js";

// Minimal zip reader for the round-trip tests: walks the local headers and
// the end record, verifying structure, names, bytes, and checksums. It reads
// only what zipStoreFiles writes (stored entries, no extra fields).
function readZip(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: { name: string; data: Uint8Array }[] = [];
  let at = 0;
  for (;;) {
    const sig = view.getUint32(at, true);
    // Central directory (or the end record itself for an empty archive):
    // the local section is done.
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    expect(sig).toBe(0x04034b50);
    const method = view.getUint16(at + 8, true);
    expect(method).toBe(0);
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    expect(view.getUint32(at + 22, true)).toBe(size);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.slice(at + 30, at + 30 + nameLen));
    const data = bytes.slice(at + 30 + nameLen + extraLen, at + 30 + nameLen + extraLen + size);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, data });
    at += 30 + nameLen + extraLen + size;
  }
  // End record: entry count and central-directory offset must agree.
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 8, true)).toBe(entries.length);
  expect(view.getUint16(end + 10, true)).toBe(entries.length);
  expect(view.getUint32(end + 16, true)).toBe(at);
  return entries;
}

describe("crc32", () => {
  it("matches the standard check vectors", () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("album export filenames", () => {
  it("maps formats to extensions", () => {
    expect(albumExportExtension("jpeg")).toBe("jpg");
    expect(albumExportExtension("png")).toBe("png");
    expect(albumExportExtension("webp")).toBe("webp");
  });

  it("offers the pipeline's three formats", () => {
    expect(ALBUM_EXPORT_FORMATS.map((entry) => entry.value)).toEqual(["jpeg", "png", "webp"]);
  });

  it("strips the source extension and sanitizes separators", () => {
    expect(albumExportBasename("DSC06320.ARW")).toBe("DSC06320");
    expect(albumExportBasename("trip/hike:day?.jpg")).toBe("trip-hike-day-");
    expect(albumExportBasename("")).toBe("photo");
    expect(albumExportBasename("..")).toBe("photo");
  });

  it("dedupes collisions case-insensitively with a numeric suffix", () => {
    const used = new Set<string>();
    expect(albumExportFilename("DSC06320.ARW", "jpeg", used)).toBe("DSC06320.jpg");
    expect(albumExportFilename("dsc06320.jpg", "jpeg", used)).toBe("dsc06320 (2).jpg");
    expect(albumExportFilename("notes.txt", "png", used)).toBe("notes.png");
  });

  it("names the archive after the collection", () => {
    expect(albumExportZipName("Road Trip")).toBe("Road Trip-export.zip");
    expect(albumExportZipName("a/b:c")).toBe("a-b-c-export.zip");
    expect(albumExportZipName("")).toBe("photos-export.zip");
  });
});

describe("album export progress copy", () => {
  it("shows file counts with a % estimate", () => {
    expect(formatAlbumExportProgress(0, 12)).toBe("Exporting 0 of 12 (0%)…");
    expect(formatAlbumExportProgress(3, 12)).toBe("Exporting 3 of 12 (25%)…");
    expect(formatAlbumExportProgress(12, 12)).toBe("Exporting 12 of 12 (100%)…");
  });

  it("clamps overruns and collapses unknown totals", () => {
    expect(formatAlbumExportProgress(15, 12)).toBe("Exporting 12 of 12 (100%)…");
    expect(formatAlbumExportProgress(0, 0)).toBe("Exporting…");
  });

  it("summarizes the finished batch", () => {
    expect(formatAlbumExportSummary(12, 0)).toBe("12 photos exported as a zip file.");
    expect(formatAlbumExportSummary(1, 0)).toBe("1 photo exported as a zip file.");
    expect(formatAlbumExportSummary(11, 1)).toBe("11 photos exported as a zip file. 1 photo could not be exported.");
    expect(formatAlbumExportSummary(0, 2)).toBe("2 photos could not be exported.");
    expect(formatAlbumExportSummary(0, 0)).toBe("Nothing to export.");
  });
});

describe("zipStoreFiles", () => {
  it("round-trips entries byte-exact through a valid archive", () => {
    const photo = Uint8Array.from({ length: 1024 }, (_, i) => (i * 7 + 3) & 0xff);
    const entries = readZip(
      zipStoreFiles([
        { name: "DSC06320.jpg", data: photo },
        { name: "notes/hike (2).png", data: new TextEncoder().encode("fake-png-bytes") },
        { name: "empty.webp", data: new Uint8Array() },
      ]),
    );
    expect(entries.map((entry) => entry.name)).toEqual(["DSC06320.jpg", "notes/hike (2).png", "empty.webp"]);
    expect(entries[0]?.data).toEqual(photo);
    expect(new TextDecoder().decode(entries[1]?.data ?? new Uint8Array())).toBe("fake-png-bytes");
    expect(entries[2]?.data.length).toBe(0);
  });

  it("keeps non-ASCII filenames intact", () => {
    const entries = readZip(zipStoreFiles([{ name: "Zürich–sunset.jpg", data: new Uint8Array([1, 2, 3]) }]));
    expect(entries.map((entry) => entry.name)).toEqual(["Zürich–sunset.jpg"]);
  });

  it("writes a valid empty archive", () => {
    expect(readZip(zipStoreFiles([]))).toEqual([]);
  });

  it("refuses archives past the zip32 limits instead of corrupting them", () => {
    const entries = Array.from({ length: 65536 }, (_, i) => ({ name: `${i}.jpg`, data: new Uint8Array() }));
    expect(() => zipStoreFiles(entries)).toThrow("Too many files");
  });
});
