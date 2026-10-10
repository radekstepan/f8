import { describe, expect, it } from "vitest";
import { channelMeans, getPixel, meanLuminance, type PixelImage } from "./analyze.js";
import {
  brightLine,
  halfBlackHalfWhite,
  horizontalGradient,
  solidColor,
  verticalGradient,
} from "./fixtures.js";

function countWhite(image: PixelImage): number {
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [r, g, b] = getPixel(image, x, y);
      if (r === 255 && g === 255 && b === 255) count += 1;
    }
  }
  return count;
}

describe("solidColor", () => {
  it("fills every pixel with the given color", () => {
    const image = solidColor(16, 12, 200, 100, 50);
    expect(getPixel(image, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(getPixel(image, 15, 11)).toEqual([200, 100, 50, 255]);
    expect(getPixel(image, 7, 5)).toEqual([200, 100, 50, 255]);
  });

  it("reports exact channel means and Rec.709 luminance", () => {
    const image = solidColor(8, 8, 200, 100, 50);
    expect(channelMeans(image)).toEqual({ r: 200, g: 100, b: 50 });
    expect(meanLuminance(image)).toBeCloseTo(0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50, 10);
  });
});

describe("horizontalGradient", () => {
  it("runs black to white left to right with identical rows", () => {
    const image = horizontalGradient(256, 8);
    expect(getPixel(image, 0, 3)).toEqual([0, 0, 0, 255]);
    expect(getPixel(image, 255, 3)).toEqual([255, 255, 255, 255]);
    for (let x = 0; x < 256; x += 1) {
      const expected = Math.round((255 * x) / 255);
      expect(getPixel(image, x, 0)[0]).toBe(expected);
      expect(getPixel(image, x, 7)).toEqual(getPixel(image, x, 0));
    }
  });

  it("averages to mid-gray", () => {
    const means = channelMeans(horizontalGradient(256, 4));
    expect(means.r).toBeCloseTo(127.5, 0);
    expect(means.g).toBeCloseTo(127.5, 0);
    expect(means.b).toBeCloseTo(127.5, 0);
  });
});

describe("verticalGradient", () => {
  it("runs black to white top to bottom with identical columns", () => {
    const image = verticalGradient(8, 256);
    expect(getPixel(image, 3, 0)).toEqual([0, 0, 0, 255]);
    expect(getPixel(image, 3, 255)).toEqual([255, 255, 255, 255]);
    for (let y = 0; y < 256; y += 1) {
      const expected = Math.round((255 * y) / 255);
      expect(getPixel(image, 0, y)[0]).toBe(expected);
      expect(getPixel(image, 7, y)).toEqual(getPixel(image, 0, y));
    }
  });

  it("averages to mid-gray", () => {
    expect(meanLuminance(verticalGradient(4, 256))).toBeCloseTo(127.5, 0);
  });
});

describe("halfBlackHalfWhite", () => {
  it("splits black and white at the midpoint", () => {
    const image = halfBlackHalfWhite(100, 10);
    expect(getPixel(image, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(getPixel(image, 49, 9)).toEqual([0, 0, 0, 255]);
    expect(getPixel(image, 50, 0)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 99, 9)).toEqual([255, 255, 255, 255]);
  });

  it("averages to exactly mid-gray on even widths", () => {
    expect(channelMeans(halfBlackHalfWhite(100, 10))).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });
});

describe("brightLine", () => {
  it("draws a horizontal line at 0 degrees", () => {
    const image = brightLine(101, 101, 0);
    expect(getPixel(image, 50, 50)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 0, 50)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 100, 50)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 50, 0)).toEqual([10, 10, 10, 255]);
    expect(countWhite(image)).toBe(101);
  });

  it("draws a vertical line at 90 degrees", () => {
    const image = brightLine(101, 101, 90);
    expect(getPixel(image, 50, 50)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 50, 0)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 50, 100)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 0, 50)).toEqual([10, 10, 10, 255]);
    expect(countWhite(image)).toBe(101);
  });

  it("draws a diagonal line at 45 degrees", () => {
    const image = brightLine(101, 101, 45);
    expect(getPixel(image, 50, 50)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 60, 60)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 40, 40)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 60, 50)).toEqual([10, 10, 10, 255]);
    expect(countWhite(image)).toBe(101);
  });
});

describe("invalid input", () => {
  it("rejects out-of-bounds pixels and malformed buffers", () => {
    const image = solidColor(4, 4, 0, 0, 0);
    expect(() => getPixel(image, 4, 0)).toThrow(RangeError);
    expect(() => getPixel(image, 0, -1)).toThrow(RangeError);
    expect(() => channelMeans({ width: 4, height: 4, data: new Uint8ClampedArray(4) })).toThrow(RangeError);
    expect(() => meanLuminance({ width: 0, height: 4, data: new Uint8ClampedArray(0) })).toThrow(RangeError);
  });
});
