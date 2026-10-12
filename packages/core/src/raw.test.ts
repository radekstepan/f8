import { describe, expect, it } from "vitest";
import {
  RAW_ACCEPT,
  formatRawMetadata,
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

describe("readRawMetadata", () => {
  it("never throws and falls back for unreadable files", async () => {
    await expect(readRawMetadata(Buffer.from([0x00, 0x01]))).resolves.toEqual(formatRawMetadata(undefined));
  });
});

/** Minimal JPEG carrying an EXIF orientation tag (SOI + APP1 + EOI). */
function jpegWithOrientation(orientation: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xd9,
  ]);
}

describe("readOrientation", () => {
  it("reads the EXIF orientation", async () => {
    expect(await readOrientation(jpegWithOrientation(6))).toBe(6);
  });

  it("defaults to 1 for unreadable input", async () => {
    await expect(readOrientation(Buffer.from([0x00, 0x01]))).resolves.toBe(1);
  });
});
