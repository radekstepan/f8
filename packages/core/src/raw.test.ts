import { describe, expect, it } from "vitest";
import {
  RAW_ACCEPT,
  decodeRawImport,
  extractRawPreview,
  findJpegPreviews,
  formatRawMetadata,
  injectExifOrientation,
  isRawFilename,
  readOrientation,
  readRawMetadata,
  resolveImportSelection,
} from "./raw.js";

function candidate(name: string, type = "") {
  return { name, type };
}

describe("isRawFilename", () => {
  it("detects common camera RAW extensions", () => {
    for (const name of [
      "DSC_0001.ARW", "IMG_1234.CR2", "IMG_1234.CR3", "_DSC1234.NEF",
      "P1000123.RW2", "DSCF1234.RAF", "PA160001.DNG", "P1234567.ORF",
      "IMGP1234.PEF", "DSC00001.SRW", "photo.3fr", "photo.iiq",
    ]) {
      expect(isRawFilename(name), name).toBe(true);
    }
  });

  it("matches extensions case-insensitively", () => {
    expect(isRawFilename("photo.arw")).toBe(true);
    expect(isRawFilename("photo.ArW")).toBe(true);
    expect(isRawFilename("photo.NEF")).toBe(true);
  });

  it("rejects rendered images and non-photos", () => {
    for (const name of [
      "photo.jpg", "photo.JPEG", "photo.png", "photo.webp", "photo.tiff",
      "photo.heic", "clip.mp4", "notes.txt", "noextension", ".arw",
    ]) {
      expect(isRawFilename(name), name).toBe(false);
    }
  });
});

describe("RAW_ACCEPT", () => {
  it("lists dot-extensions for the file picker", () => {
    expect(RAW_ACCEPT).toContain(".arw");
    expect(RAW_ACCEPT).toContain(".cr2");
    expect(RAW_ACCEPT).toContain(".cr3");
    expect(RAW_ACCEPT).toContain(".nef");
    expect(RAW_ACCEPT).toContain(".dng");
    expect(RAW_ACCEPT).not.toContain(" ");
  });
});

describe("resolveImportSelection", () => {
  it("keeps the RAW file and drops its JPEG sidecar with the same basename", () => {
    const raw = candidate("DSC_0001.ARW", "");
    const { files, suppressedSidecars } = resolveImportSelection([
      raw, candidate("DSC_0001.JPG", "image/jpeg"),
    ]);
    expect(files).toEqual([raw]);
    expect(suppressedSidecars).toBe(1);
  });

  it("matches RAW/JPEG pairs case-insensitively, including .jpeg", () => {
    const { files, suppressedSidecars } = resolveImportSelection([
      candidate("dsc_0001.jpg", "image/jpeg"),
      candidate("DSC_0001.CR2", "application/octet-stream"),
      candidate("DSC_0002.jpeg", "image/jpeg"),
      candidate("DSC_0002.NEF", ""),
    ]);
    expect(files.map((file) => file.name)).toEqual(["DSC_0001.CR2", "DSC_0002.NEF"]);
    expect(suppressedSidecars).toBe(2);
  });

  it("detects RAW files with missing or generic MIME types", () => {
    const { files } = resolveImportSelection([
      candidate("IMG_1.CR3", ""),
      candidate("IMG_2.NEF", "application/octet-stream"),
    ]);
    expect(files.map((file) => file.name)).toEqual(["IMG_1.CR3", "IMG_2.NEF"]);
  });

  it("keeps JPEGs and RAWs with different basenames", () => {
    const { files, suppressedSidecars } = resolveImportSelection([
      candidate("IMG_1.JPG", "image/jpeg"),
      candidate("IMG_2.CR2", ""),
    ]);
    expect(files.map((file) => file.name)).toEqual(["IMG_1.JPG", "IMG_2.CR2"]);
    expect(suppressedSidecars).toBe(0);
  });

  it("keeps non-JPEG renderables that share a RAW basename", () => {
    const { files, suppressedSidecars } = resolveImportSelection([
      candidate("edit.PNG", "image/png"),
      candidate("edit.ARW", ""),
    ]);
    expect(files.map((file) => file.name)).toEqual(["edit.PNG", "edit.ARW"]);
    expect(suppressedSidecars).toBe(0);
  });

  it("filters out non-image, non-RAW files and preserves order", () => {
    const { files, suppressedSidecars } = resolveImportSelection([
      candidate("b.jpg", "image/jpeg"),
      candidate("clip.mp4", "video/mp4"),
      candidate("notes.txt", "text/plain"),
      candidate("a.cr2", ""),
      candidate("a.jpg", "image/jpeg"),
    ]);
    expect(files.map((file) => file.name)).toEqual(["b.jpg", "a.cr2"]);
    expect(suppressedSidecars).toBe(1);
  });
});

describe("formatRawMetadata", () => {
  it("maps translated EXIF tags to photo fields", () => {
    expect(formatRawMetadata({
      Make: "SONY", Model: "ILCE-7M4", LensModel: "FE 24-70mm F2.8 GM II",
      ISO: 200, FNumber: 8, ExposureTime: 1 / 250, FocalLength: 24,
      DateTimeOriginal: new Date("2024-09-18T07:20:00.000Z"),
    })).toEqual({
      camera: "SONY ILCE-7M4", lens: "FE 24-70mm F2.8 GM II", iso: 200,
      aperture: "f/8", shutter: "1/250 s", focalLength: "24 mm",
      date: "2024-09-18T07:20:00.000Z",
    });
  });

  it("avoids repeating the maker when the model already names it", () => {
    expect(formatRawMetadata({ Make: "Canon", Model: "Canon EOS 350D DIGITAL" }).camera).toBe("Canon EOS 350D DIGITAL");
    expect(formatRawMetadata({ Make: "NIKON CORPORATION", Model: "NIKON D40" }).camera).toBe("NIKON D40");
    expect(formatRawMetadata({ Make: "SONY", Model: "ILCE-7M4" }).camera).toBe("SONY ILCE-7M4");
  });

  it("formats fractional apertures and long exposures", () => {
    const formatted = formatRawMetadata({ FNumber: 2.8, ExposureTime: 2, FocalLength: 70.5 });
    expect(formatted.aperture).toBe("f/2.8");
    expect(formatted.shutter).toBe("2 s");
    expect(formatted.focalLength).toBe("70.5 mm");
  });

  it("falls back gracefully when tags are missing or invalid", () => {
    expect(formatRawMetadata(undefined)).toEqual({
      camera: "Imported RAW image", lens: "No camera metadata", iso: 0,
      aperture: "-", shutter: "-", focalLength: "-", date: undefined,
    });
    const formatted = formatRawMetadata({ ISO: "high", FNumber: 0, ExposureTime: -1 });
    expect(formatted.iso).toBe(0);
    expect(formatted.aperture).toBe("-");
    expect(formatted.shutter).toBe("-");
  });
});

/** Minimal little-endian TIFF whose IFD1 points at a 4-byte JPEG (SOI + EOI). */
function syntheticRaw(): Buffer {
  const jpegOffset = 44;
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], 0); // II, 42, IFD0 @ 8
  view.setUint16(8, 0, true); // IFD0 entry count
  view.setUint32(10, 14, true); // next IFD @ 14
  view.setUint16(14, 2, true); // IFD1 entry count
  view.setUint16(16, 0x0201, true); // ThumbnailOffset
  view.setUint16(18, 4, true); // LONG
  view.setUint32(20, 1, true);
  view.setUint32(24, jpegOffset, true);
  view.setUint16(28, 0x0202, true); // ThumbnailLength
  view.setUint16(30, 4, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, 4, true);
  view.setUint32(40, 0, true); // end of IFD chain
  bytes.set([0xff, 0xd8, 0xff, 0xd9], jpegOffset);
  return Buffer.from(bytes);
}

describe("extractRawPreview", () => {
  it("extracts the embedded JPEG preview", async () => {
    const preview = await extractRawPreview(syntheticRaw());
    expect(preview.type).toBe("image/jpeg");
    expect(preview.size).toBe(4);
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });

  it("prefers the largest embedded JPEG over the IFD1 thumbnail", async () => {
    const large = [0xff, 0xd8, 0xbb, 0xcc, 0xd9];
    const file = buildTiff({
      thumbnail: { width: 160, height: 120, bytes: [0xff, 0xd8, 0xaa, 0xd9] },
      previews: [{ width: 6000, height: 4000, bytes: large }],
    });
    const preview = await extractRawPreview(file);
    expect(preview.type).toBe("image/jpeg");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(new Uint8Array(large));
  });

  it("still imports a mislabeled JPEG via the thumbnail fallback", async () => {
    const thumb = [0xff, 0xd8, 0xaa, 0xd9];
    const file = buildJpegWithExifThumbnail(thumb);
    const preview = await extractRawPreview(file);
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(new Uint8Array(thumb));
  });

  it("rejects files without an embedded JPEG preview", async () => {
    await expect(extractRawPreview(Buffer.from([0x00, 0x01, 0x02, 0x03]))).rejects.toThrow();
  });
});

describe("readRawMetadata", () => {
  it("never throws and falls back for unreadable files", async () => {
    await expect(readRawMetadata(Buffer.from([0x00, 0x01]))).resolves.toEqual(formatRawMetadata(undefined));
  });
});

describe("decodeRawImport", () => {
  it("returns the preview and metadata together", async () => {
    const { preview, metadata } = await decodeRawImport(syntheticRaw());
    expect(preview.type).toBe("image/jpeg");
    expect(metadata.camera).toBe("Imported RAW image");
  });

  it("returns the largest preview with the RAW orientation embedded", async () => {
    const large = [0xff, 0xd8, 0xbb, 0xcc, 0xd9];
    const file = buildTiff({
      orientation: 6,
      thumbnail: { width: 160, height: 120, bytes: [0xff, 0xd8, 0xaa, 0xd9] },
      previews: [{ width: 6000, height: 4000, bytes: large }],
    });
    const { preview, metadata } = await decodeRawImport(file);
    const bytes = new Uint8Array(await preview.arrayBuffer());
    expect(await readOrientation(Buffer.from(bytes))).toBe(6);
    expect(bytes.length).toBe(large.length + 36);
    expect(Array.from(bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(bytes.subarray(bytes.length - (large.length - 2)))).toEqual(large.slice(2));
    expect(metadata.camera).toBe("Imported RAW image");
  });
});

interface TiffPreviewSpec {
  width: number;
  height: number;
  bytes: number[];
}

/** Build a minimal TIFF: IFD0 with an orientation tag and SubIFD previews, plus an IFD1 thumbnail. */
function buildTiff(spec: {
  bigEndian?: boolean;
  magic?: number;
  orientation?: number;
  thumbnail?: TiffPreviewSpec;
  previews?: TiffPreviewSpec[];
}): Buffer {
  const littleEndian = !spec.bigEndian;
  const previews = spec.previews ?? [];
  const ifd0Count = (spec.orientation === undefined ? 0 : 1) + (previews.length ? 1 : 0);
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const ifd1Size = spec.thumbnail ? 2 + 4 * 12 + 4 : 0;
  const subSize = 2 + 5 * 12 + 4;
  const ifd0At = 8;
  const ifd1At = ifd0At + ifd0Size;
  const subsAt = ifd1At + ifd1Size;
  let dataAt = subsAt + previews.length * subSize;
  const arrayAt = dataAt;
  if (previews.length > 1) dataAt += previews.length * 4;
  const blobs = [...(spec.thumbnail ? [spec.thumbnail.bytes] : []), ...previews.map((item) => item.bytes)];
  const blobOffsets: number[] = [];
  let total = dataAt;
  for (const blob of blobs) {
    blobOffsets.push(total);
    total += blob.length;
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, littleEndian);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, littleEndian);
  out[0] = littleEndian ? 0x49 : 0x4d;
  out[1] = littleEndian ? 0x49 : 0x4d;
  u16(2, spec.magic ?? 42);
  u32(4, ifd0At);
  let p = ifd0At;
  u16(p, ifd0Count);
  p += 2;
  const entry = (tag: number, type: number, count: number, value: number) => {
    u16(p, tag);
    u16(p + 2, type);
    u32(p + 4, count);
    if (type === 3 && count === 1) {
      u16(p + 8, value);
      u16(p + 10, 0);
    } else {
      u32(p + 8, value);
    }
    p += 12;
  };
  if (spec.orientation !== undefined) entry(0x0112, 3, 1, spec.orientation);
  if (previews.length === 1) entry(0x014a, 4, 1, subsAt);
  else if (previews.length > 1) entry(0x014a, 4, previews.length, arrayAt);
  u32(p, spec.thumbnail ? ifd1At : 0);
  if (spec.thumbnail) {
    p = ifd1At;
    u16(p, 4);
    p += 2;
    entry(256, 4, 1, spec.thumbnail.width);
    entry(257, 4, 1, spec.thumbnail.height);
    entry(513, 4, 1, blobOffsets[0]!);
    entry(514, 4, 1, spec.thumbnail.bytes.length);
    u32(p, 0);
  }
  previews.forEach((preview, index) => {
    p = subsAt + index * subSize;
    u16(p, 5);
    p += 2;
    const offset = blobOffsets[(spec.thumbnail ? 1 : 0) + index]!;
    entry(256, 4, 1, preview.width);
    entry(257, 4, 1, preview.height);
    entry(259, 3, 1, 7);
    entry(273, 4, 1, offset);
    entry(279, 4, 1, preview.bytes.length);
    u32(p, 0);
  });
  if (previews.length > 1) previews.forEach((_, index) => u32(arrayAt + index * 4, subsAt + index * subSize));
  blobs.forEach((blob, index) => out.set(blob, blobOffsets[index]!));
  return Buffer.from(out);
}

/** Build a JPEG whose EXIF carries an IFD1 thumbnail (covers the fallback path). */
function buildJpegWithExifThumbnail(thumb: number[]): Buffer {
  // APP1: "Exif\0\0" + TIFF (IFD0 empty -> IFD1 with tags 513/514).
  const tiffHeaderSize = 8;
  const ifd0Size = 2 + 4;
  const ifd1Size = 2 + 2 * 12 + 4;
  const thumbOffset = tiffHeaderSize + ifd0Size + ifd1Size;
  const payload = new Uint8Array(6 + thumbOffset + thumb.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
  const view = new DataView(payload.buffer, 6);
  view.setUint16(0, 0x4949);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 0, true);
  view.setUint32(10, 14, true);
  view.setUint16(14, 2, true);
  view.setUint16(16, 0x0201, true);
  view.setUint16(18, 4, true);
  view.setUint32(20, 1, true);
  view.setUint32(24, thumbOffset, true);
  view.setUint16(28, 0x0202, true);
  view.setUint16(30, 4, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, thumb.length, true);
  view.setUint32(40, 0, true);
  payload.set(thumb, 6 + thumbOffset);
  const out = new Uint8Array(2 + 2 + 2 + payload.length + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff], 0);
  out.set(payload, 6);
  out.set([0xff, 0xd9], 6 + payload.length);
  return Buffer.from(out);
}

describe("findJpegPreviews", () => {
  it("finds IFD1 thumbnails and SubIFD previews, largest first", () => {
    const thumb = { width: 160, height: 120, bytes: [0xff, 0xd8, 0xaa, 0xd9] };
    const preview = { width: 6000, height: 4000, bytes: [0xff, 0xd8, 0xbb, 0xcc, 0xd9] };
    const file = buildTiff({ thumbnail: thumb, previews: [preview] });
    const found = findJpegPreviews(new Uint8Array(file), file.length);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ width: 6000, height: 4000 });
    expect(found[1]).toMatchObject({ width: 160, height: 120 });
    const specs = [preview, thumb];
    found.forEach((candidate, index) => {
      expect(Array.from(file.subarray(candidate.offset, candidate.offset + candidate.length))).toEqual(specs[index]!.bytes);
    });
  });

  it("reads big-endian TIFF structure", () => {
    const file = buildTiff({
      bigEndian: true,
      previews: [{ width: 640, height: 480, bytes: [0xff, 0xd8, 0xd9] }],
    });
    const found = findJpegPreviews(new Uint8Array(file), file.length);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ width: 640, height: 480 });
  });

  it("reads Panasonic RW2 structure under magic 85", () => {
    const file = buildTiff({
      magic: 85,
      previews: [{ width: 4000, height: 3000, bytes: [0xff, 0xd8, 0xbb, 0xd9] }],
    });
    const found = findJpegPreviews(new Uint8Array(file), file.length);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ width: 4000, height: 3000 });
  });

  it("returns no candidates for non-TIFF data", () => {
    expect(findJpegPreviews(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 8)).toEqual([]);
    expect(findJpegPreviews(new Uint8Array(0), 0)).toEqual([]);
  });
});

describe("injectExifOrientation", () => {
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  it("leaves already-upright images untouched", () => {
    expect(injectExifOrientation(bare, 1)).toEqual(bare);
    expect(injectExifOrientation(bare, 0)).toEqual(bare);
    expect(injectExifOrientation(bare, 9)).toEqual(bare);
  });

  it("embeds the orientation so EXIF-aware decoders rotate it", async () => {
    const oriented = injectExifOrientation(bare, 6);
    expect(oriented.length).toBeGreaterThan(bare.length);
    expect(await readOrientation(Buffer.from(oriented))).toBe(6);
  });

  it("preserves image data and non-EXIF segments", () => {
    const withApp1 = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0xaa, 0xbb, 0xff, 0xd9]);
    const oriented = injectExifOrientation(withApp1, 6);
    expect(oriented.length).toBe(2 + 36 + withApp1.length - 2);
    expect(Array.from(oriented.subarray(2 + 36))).toEqual(Array.from(withApp1.subarray(2)));
  });

  it("replaces a stale embedded orientation instead of duplicating it", async () => {
    const stale = injectExifOrientation(bare, 3);
    expect(await readOrientation(Buffer.from(stale))).toBe(3);
    const fixed = injectExifOrientation(stale, 6);
    expect(await readOrientation(Buffer.from(fixed))).toBe(6);
    expect(fixed.length).toBe(stale.length);
  });

  it("leaves non-JPEG input untouched", () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(injectExifOrientation(data, 6)).toEqual(data);
  });
});

describe("readOrientation", () => {
  it("reads the RAW file orientation", async () => {
    expect(await readOrientation(buildTiff({ orientation: 6 }))).toBe(6);
  });

  it("defaults to 1 for unreadable input", async () => {
    await expect(readOrientation(Buffer.from([0x00, 0x01]))).resolves.toBe(1);
  });
});
