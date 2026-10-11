import { describe, expect, it } from "vitest";
import type { PixelImage } from "./analyze.js";
import { solidColor } from "./fixtures.js";
import { healRepair } from "./heal.js";
import type { RepairMask } from "./inpaint.js";

/** Vertical 1px stripes: even columns 200, odd columns 60, fully opaque. */
function stripes(width: number, height: number): PixelImage {
  const image = solidColor(width, height, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = x % 2 === 0 ? 200 : 60;
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
    }
  }
  return image;
}

/** Horizontal gradient, black at x = 0 to white at x = width - 1. */
function gradient(width: number, height: number): PixelImage {
  const image = solidColor(width, height, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.round((255 * x) / Math.max(1, width - 1));
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
    }
  }
  return image;
}

/** Paint the inclusive rect near-black, simulating a dark blemish. */
function blemish(image: PixelImage, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * image.width + x) * 4;
      image.data[i] = 5;
      image.data[i + 1] = 5;
      image.data[i + 2] = 5;
    }
  }
}

/** Full-strength mask over the inclusive rect. */
function rectMask(width: number, height: number, x0: number, y0: number, x1: number, y1: number): RepairMask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      data[y * width + x] = 255;
    }
  }
  return { width, height, data };
}

function channel(image: PixelImage, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i] ?? -1, image.data[i + 1] ?? -1, image.data[i + 2] ?? -1, image.data[i + 3] ?? -1];
}

describe("healRepair", () => {
  it("transplants texture instead of smearing it", () => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const out = healRepair(image, rectMask(24, 24, 10, 10, 12, 12));
    // Every masked pixel continues its stripe column exactly. A diffusion
    // blur would land near the ~130 midpoint at stripe boundaries; the
    // odd column at x = 11 pins this: it must be 60, not a blend.
    for (let y = 10; y <= 12; y += 1) {
      for (let x = 10; x <= 12; x += 1) {
        const v = x % 2 === 0 ? 200 : 60;
        expect(channel(out, x, y)).toEqual([v, v, v, 255]);
      }
    }
  });

  it("repairs a single pixel from its surround", () => {
    const image = stripes(24, 24);
    blemish(image, 11, 11, 11, 11);
    const out = healRepair(image, rectMask(24, 24, 11, 11, 11, 11));
    expect(channel(out, 11, 11)).toEqual([60, 60, 60, 255]);
  });

  it("adapts the donor to the local light on a gradient", () => {
    const clean = gradient(32, 8);
    const image = gradient(32, 8);
    blemish(image, 14, 2, 17, 5);
    const out = healRepair(image, rectMask(32, 8, 14, 2, 17, 5));
    // The donor comes from nearby pixels at a slightly different brightness;
    // the ring-mean shift must pull it back onto the local gradient.
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 14; x <= 17; x += 1) {
        const [r, g, b] = channel(out, x, y);
        const [er, eg, eb] = channel(clean, x, y);
        expect(Math.abs(r - er)).toBeLessThanOrEqual(8);
        expect(Math.abs(g - eg)).toBeLessThanOrEqual(8);
        expect(Math.abs(b - eb)).toBeLessThanOrEqual(8);
      }
    }
  });

  it("heals separate blemishes from their own surroundings", () => {
    // Regions are wide on purpose: each blemish needs a clean donor within
    // its own texture, clear of the boundary and the other blemish.
    const image = stripes(64, 20);
    for (let y = 0; y < 20; y += 1) {
      for (let x = 32; x < 64; x += 1) {
        const i = (y * 64 + x) * 4;
        image.data[i] = 150;
        image.data[i + 1] = 150;
        image.data[i + 2] = 150;
      }
    }
    blemish(image, 10, 8, 12, 10);
    blemish(image, 48, 8, 50, 10);
    const mask = rectMask(64, 20, 10, 8, 12, 10);
    for (let y = 8; y <= 10; y += 1) {
      for (let x = 48; x <= 50; x += 1) {
        mask.data[y * 64 + x] = 255;
      }
    }
    const out = healRepair(image, mask);
    // Left blemish continues the stripes; right blemish stays flat 150.
    // One shared donor offset could not satisfy both.
    for (let y = 8; y <= 10; y += 1) {
      for (let x = 10; x <= 12; x += 1) {
        const v = x % 2 === 0 ? 200 : 60;
        expect(channel(out, x, y)).toEqual([v, v, v, 255]);
      }
      for (let x = 48; x <= 50; x += 1) {
        expect(channel(out, x, y)).toEqual([150, 150, 150, 255]);
      }
    }
  });

  it("treats any nonzero mask value as fill region", () => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const mask = rectMask(24, 24, 10, 10, 12, 12);
    for (let y = 10; y <= 12; y += 1) {
      for (let x = 10; x <= 12; x += 1) {
        mask.data[y * 24 + x] = 64;
      }
    }
    const out = healRepair(image, mask);
    // Strength is applied later at composite time; heal fills full values.
    expect(channel(out, 10, 10)).toEqual([200, 200, 200, 255]);
    expect(channel(out, 11, 11)).toEqual([60, 60, 60, 255]);
  });

  it("leaves unmasked pixels bit-exact and keeps source alpha", () => {
    const image = stripes(24, 24);
    for (let i = 3; i < image.data.length; i += 4) {
      image.data[i] = (i * 37) % 256;
    }
    const alphaBefore = Array.from(image.data.filter((_, i) => i % 4 === 3));
    blemish(image, 10, 10, 12, 12);
    const mask = rectMask(24, 24, 10, 10, 12, 12);
    const out = healRepair(image, mask);
    for (let p = 0; p < mask.data.length; p += 1) {
      if ((mask.data[p] ?? 0) !== 0) continue;
      const i = p * 4;
      expect(out.data[i]).toBe(image.data[i]);
      expect(out.data[i + 1]).toBe(image.data[i + 1]);
      expect(out.data[i + 2]).toBe(image.data[i + 2]);
    }
    // Alpha passes through everywhere, including healed pixels.
    expect(Array.from(out.data.filter((_, i) => i % 4 === 3))).toEqual(alphaBefore);
  });

  it("returns the source unchanged when no donor qualifies", () => {
    const image = solidColor(2, 2, 40, 50, 60);
    const mask: RepairMask = { width: 2, height: 2, data: new Uint8ClampedArray([255, 255, 255, 255]) };
    const out = healRepair(image, mask);
    expect(out).not.toBe(image);
    expect(out.data).not.toBe(image.data);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("copies the source for an empty mask", () => {
    const image = stripes(16, 16);
    const mask: RepairMask = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16) };
    const out = healRepair(image, mask);
    expect(out.data).not.toBe(image.data);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("never mutates its inputs and is deterministic", () => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const mask = rectMask(24, 24, 10, 10, 12, 12);
    const imageBefore = Array.from(image.data);
    const maskBefore = Array.from(mask.data);
    const first = healRepair(image, mask);
    const second = healRepair(image, mask);
    expect(Array.from(image.data)).toEqual(imageBefore);
    expect(Array.from(mask.data)).toEqual(maskBefore);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it("rejects mismatched dimensions", () => {
    expect(() =>
      healRepair(solidColor(4, 4, 0, 0, 0), { width: 2, height: 2, data: new Uint8ClampedArray(4) }),
    ).toThrow(RangeError);
  });
});
