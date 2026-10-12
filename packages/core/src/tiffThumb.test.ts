import { describe, expect, it } from "vitest";
import { extractEmbeddedJpeg } from "./tiffThumb.js";

function jpegMarker(width: number, height: number): Buffer {
  // Minimal SOI…EOI with SOF0 dimensions, like the server fixtures.
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  value: number;
}

/** Minimal classic-TIFF builder: header + IFD chain + appended JPEG blobs. */
function buildTiff(options: {
  littleEndian?: boolean;
  ifds?: TiffEntry[][];
  blobs?: Buffer[];
  nextIfd?: number[];
}): Buffer {
  const littleEndian = options.littleEndian ?? true;
  const ifds = options.ifds ?? [];
  const blobs = options.blobs ?? [];
  const header = Buffer.alloc(8);
  header.write(littleEndian ? "II" : "MM", 0);
  if (littleEndian) {
    header.writeUInt16LE(42, 2);
    header.writeUInt32LE(8, 4);
  } else {
    header.writeUInt16BE(42, 2);
    header.writeUInt32BE(8, 4);
  }
  const parts: Buffer[] = [header];
  let cursor = 8;
  // Reserve IFD blocks first so blob offsets are known up front.
  const ifdOffsets: number[] = [];
  for (const entries of ifds) {
    ifdOffsets.push(cursor);
    cursor += 2 + entries.length * 12 + 4;
  }
  const blobOffsets: number[] = [];
  for (const blob of blobs) {
    blobOffsets.push(cursor);
    cursor += blob.length;
  }
  const write16 = (buf: Buffer, value: number, at: number): void => {
    if (littleEndian) buf.writeUInt16LE(value, at);
    else buf.writeUInt16BE(value, at);
  };
  const write32 = (buf: Buffer, value: number, at: number): void => {
    if (littleEndian) buf.writeUInt32LE(value, at);
    else buf.writeUInt32BE(value, at);
  };
  ifds.forEach((entries, ifdIndex) => {
    const block = Buffer.alloc(2 + entries.length * 12 + 4);
    write16(block, entries.length, 0);
    entries.forEach((entry, index) => {
      const at = 2 + index * 12;
      write16(block, entry.tag, at);
      write16(block, entry.type, at + 2);
      write32(block, entry.count, at + 4);
      write32(block, entry.value, at + 8);
    });
    const next = options.nextIfd?.[ifdIndex] ?? (ifdIndex + 1 < ifds.length ? ifdOffsets[ifdIndex + 1] : 0);
    write32(block, next as number, 2 + entries.length * 12);
    parts.push(block);
  });
  parts.push(...blobs);
  void blobOffsets;
  return Buffer.concat(parts);
}

// Blob start for a header + IFDs shape, from per-IFD entry counts.
function blobBase(entryCounts: number[]): number {
  return 8 + entryCounts.reduce((sum, count) => sum + 2 + count * 12 + 4, 0);
}

describe("extractEmbeddedJpeg", () => {
  it("extracts a single-strip old-style JPEG preview (compression 7)", () => {
    const preview = jpegMarker(160, 120);
    const ifds: TiffEntry[][] = [[]];
    const base = blobBase([5]);
    ifds[0] = [
      { tag: 256, type: 3, count: 1, value: 160 },
      { tag: 257, type: 3, count: 1, value: 120 },
      { tag: 259, type: 3, count: 1, value: 7 },
      { tag: 273, type: 4, count: 1, value: base },
      { tag: 279, type: 4, count: 1, value: preview.length },
    ];
    const found = extractEmbeddedJpeg(buildTiff({ ifds, blobs: [preview] }));
    expect(found && Buffer.from(found)).toEqual(preview);
  });

  it("reads big-endian TIFFs and EXIF thumbnail pointers (tags 513/514)", () => {
    const preview = jpegMarker(320, 200);
    const ifds: TiffEntry[][] = [[], []];
    const base = blobBase([1, 2]);
    // IFD0 holds raw sensor data (uncompressed); IFD1 holds the JPEG preview.
    ifds[0] = [{ tag: 259, type: 3, count: 1, value: 1 }];
    ifds[1] = [
      { tag: 513, type: 4, count: 1, value: base },
      { tag: 514, type: 4, count: 1, value: preview.length },
    ];
    const found = extractEmbeddedJpeg(buildTiff({ littleEndian: false, ifds, blobs: [preview] }));
    expect(found && Buffer.from(found)).toEqual(preview);
  });

  it("follows SubIFD offsets and keeps the largest preview", () => {
    const small = jpegMarker(16, 12);
    const padding = Buffer.alloc(64, 0x00);
    const large = Buffer.concat([jpegMarker(640, 480).subarray(0, 37), padding, Buffer.from([0xff, 0xd9])]);
    // IFD0 points at the small preview plus a SubIFD that points at the large
    // one; the scanner is not chained via next-IFD (nextIfd 0/0).
    const ifds: TiffEntry[][] = [[], []];
    const subOffset = 8 + (2 + 3 * 12 + 4);
    const start = blobBase([3, 2]);
    ifds[0] = [
      { tag: 330, type: 4, count: 1, value: subOffset },
      { tag: 513, type: 4, count: 1, value: start },
      { tag: 514, type: 4, count: 1, value: small.length },
    ];
    ifds[1] = [
      { tag: 513, type: 4, count: 1, value: start + small.length },
      { tag: 514, type: 4, count: 1, value: large.length },
    ];
    const found = extractEmbeddedJpeg(buildTiff({ ifds, blobs: [small, large], nextIfd: [0, 0] }));
    expect(found && Buffer.from(found)).toEqual(large);
  });

  it("returns a copy that does not retain the source buffer", () => {
    const preview = jpegMarker(32, 24);
    const ifds: TiffEntry[][] = [[]];
    const base = blobBase([3]);
    ifds[0] = [
      { tag: 259, type: 3, count: 1, value: 7 },
      { tag: 273, type: 4, count: 1, value: base },
      { tag: 279, type: 4, count: 1, value: preview.length },
    ];
    const source = buildTiff({ ifds, blobs: [preview] });
    const found = extractEmbeddedJpeg(source);
    expect(found).not.toBeNull();
    expect(found?.byteLength).toBe(preview.length);
    expect(found?.buffer.byteLength).toBe(preview.length);
  });

  it("returns null for non-TIFF, truncated, and preview-less files", () => {
    expect(extractEmbeddedJpeg(new Uint8Array(0))).toBeNull();
    expect(extractEmbeddedJpeg(Buffer.from("not an image"))).toBeNull();
    expect(extractEmbeddedJpeg(jpegMarker(8, 6))).toBeNull();
    // Valid TIFF header but no JPEG preview (uncompressed strip).
    const ifds: TiffEntry[][] = [[{ tag: 259, type: 3, count: 1, value: 1 }]];
    expect(extractEmbeddedJpeg(buildTiff({ ifds }))).toBeNull();
    // Truncated mid-IFD.
    expect(extractEmbeddedJpeg(Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]))).toBeNull();
  });

  it("rejects JPEG ranges that are out of bounds or fail magic validation", () => {
    // Declared length runs past EOF.
    const preview = jpegMarker(16, 12);
    const ifds: TiffEntry[][] = [[]];
    const base = blobBase([2]);
    ifds[0] = [
      { tag: 513, type: 4, count: 1, value: base },
      { tag: 514, type: 4, count: 1, value: preview.length + 500 },
    ];
    expect(extractEmbeddedJpeg(buildTiff({ ifds, blobs: [preview] }))).toBeNull();
    // Blob without JPEG magic at the declared offset.
    const flat = jpegMarker(16, 12);
    flat[0] = 0x00;
    const ifds2: TiffEntry[][] = [[]];
    const base2 = blobBase([3]);
    ifds2[0] = [
      { tag: 259, type: 3, count: 1, value: 7 },
      { tag: 273, type: 4, count: 1, value: base2 },
      { tag: 279, type: 4, count: 1, value: flat.length },
    ];
    expect(extractEmbeddedJpeg(buildTiff({ ifds: ifds2, blobs: [flat] }))).toBeNull();
  });

  it("never throws on hostile structures (cycles, huge counts)", () => {
    // IFD whose next pointer loops back to itself.
    const cyclic: TiffEntry[][] = [[{ tag: 259, type: 3, count: 1, value: 1 }]];
    expect(extractEmbeddedJpeg(buildTiff({ ifds: cyclic, nextIfd: [8] }))).toBeNull();
    // Absurd strip count with an inline value that cannot hold it.
    const wild: TiffEntry[][] = [[
      { tag: 259, type: 3, count: 1, value: 7 },
      { tag: 273, type: 4, count: 999999, value: 8 },
      { tag: 279, type: 4, count: 999999, value: 8 },
    ]];
    expect(extractEmbeddedJpeg(buildTiff({ ifds: wild }))).toBeNull();
  });
});
