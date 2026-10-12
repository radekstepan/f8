import { describe, expect, it } from "vitest";
import { stripExifApp1 } from "./jpeg.js";

const SOI = [0xff, 0xd8];
const APP0_JFIF = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00];
const APP1_EXIF = [
  0xff, 0xe1, 0x00, 0x10,
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x01, 0x02, 0x03, 0x04,
];
const APP1_XMP = [
  0xff, 0xe1, 0x00, 0x0c,
  0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x78, 0x2e, 0x6d,
];
const SOF0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x06, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00];
const EOI = [0xff, 0xd9];

describe("stripExifApp1", () => {
  it("drops the APP1 Exif segment and keeps everything else byte-identical", () => {
    const jpeg = new Uint8Array([...SOI, ...APP0_JFIF, ...APP1_EXIF, ...APP1_XMP, ...SOF0, ...EOI]);

    expect(stripExifApp1(jpeg)).toEqual(new Uint8Array([...SOI, ...APP0_JFIF, ...APP1_XMP, ...SOF0, ...EOI]));
  });

  it("returns the input unchanged when no Exif segment is present", () => {
    const jpeg = new Uint8Array([...SOI, ...APP0_JFIF, ...APP1_XMP, ...SOF0, ...EOI]);

    expect(stripExifApp1(jpeg)).toBe(jpeg);
  });

  it("returns the input unchanged for malformed bytes and never throws", () => {
    const cases: Uint8Array[] = [
      new Uint8Array([]),
      new Uint8Array([0xff]),
      new Uint8Array([0x00, 0x00, 0xff, 0xd8]),
      new Uint8Array([...SOI, 0xff]), // Truncated marker.
      new Uint8Array([...SOI, 0xff, 0xe1, 0x00]), // Truncated length.
      new Uint8Array([...SOI, 0xff, 0xe1, 0xff, 0xff]), // Length past the end.
      new Uint8Array([...SOI, 0x00, 0xe1, 0x00, 0x02]), // Missing marker prefix.
    ];
    for (const input of cases) {
      expect(stripExifApp1(input)).toBe(input);
    }
  });
});
