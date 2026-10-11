import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { RetouchPoint } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";
import { goldenPhoto, solidColor } from "./fixtures.js";
import {
  BLEND_FEATHER_MAX_PX,
  BLEND_FEATHER_PX,
  INPAINT_DEFAULT_METHOD,
  INPAINT_RADIUS_MAX,
  INPAINT_RADIUS_MIN,
  assertValidMask,
  blendInpainted,
  dilateRepairMask,
  featherRepairMask,
  hasRepairStrokes,
  inpaintRadiusForBrush,
  inpaintRadiusForStrokes,
  inpaintWithCv,
  rasterizeRepairMask,
  resolveFeatherPx,
  type InpaintCvApi,
  type InpaintMethod,
  type RepairMask,
} from "./inpaint.js";

function repair(x: number, y: number, size: number, strength = 100): RetouchPoint {
  return { x, y, size, strength, kind: "repair" };
}

function clone(x: number, y: number): RetouchPoint {
  return { x, y, size: 0.2, strength: 100, kind: "clone", sourceX: 0.1, sourceY: 0.1 };
}

function maskedPixels(mask: RepairMask): Array<[number, number, number]> {
  const found: Array<[number, number, number]> = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const value = mask.data[y * mask.width + x] ?? 0;
      if (value > 0) found.push([x, y, value]);
    }
  }
  return found;
}

describe("hasRepairStrokes", () => {
  it("is false for empty and clone-only strokes", () => {
    expect(hasRepairStrokes([])).toBe(false);
    expect(hasRepairStrokes([clone(0.5, 0.5)])).toBe(false);
  });

  it("is true when any stroke is a repair", () => {
    expect(hasRepairStrokes([clone(0.1, 0.1), repair(0.5, 0.5, 0.1)])).toBe(true);
  });
});

describe("assertValidMask", () => {
  it("accepts a matching single-channel buffer", () => {
    expect(() => assertValidMask({ width: 4, height: 3, data: new Uint8ClampedArray(12) })).not.toThrow();
  });

  it("rejects bad dimensions and mismatched buffers", () => {
    expect(() => assertValidMask({ width: 0, height: 3, data: new Uint8ClampedArray(0) })).toThrow(RangeError);
    expect(() => assertValidMask({ width: 4.5, height: 3, data: new Uint8ClampedArray(12) })).toThrow(RangeError);
    expect(() => assertValidMask({ width: 4, height: 3, data: new Uint8ClampedArray(11) })).toThrow(RangeError);
  });
});

describe("rasterizeRepairMask", () => {
  it("lands a centered brush on the exact covered pixels", () => {
    // Center (5, 5), radius 1: pixel centers at distance <= 1 are the 2x2
    // block (4,4)..(5,5), each at distance sqrt(0.5).
    const mask = rasterizeRepairMask([repair(0.5, 0.5, 0.2)], 10, 10);
    expect(mask.width).toBe(10);
    expect(mask.height).toBe(10);
    expect(maskedPixels(mask)).toEqual([
      [4, 4, 255],
      [5, 4, 255],
      [4, 5, 255],
      [5, 5, 255],
    ]);
  });

  it("scales the disc with brush size", () => {
    // Center (5, 5), radius 2: 12 pixels; the diagonal neighbours at
    // distance sqrt(4.5) stay outside.
    const mask = rasterizeRepairMask([repair(0.5, 0.5, 0.4)], 10, 10);
    const pixels = maskedPixels(mask);
    expect(pixels).toHaveLength(12);
    expect(pixels).toContainEqual([3, 4, 255]);
    expect(pixels).toContainEqual([6, 5, 255]);
    expect(pixels).toContainEqual([4, 3, 255]);
    expect(pixels).toContainEqual([5, 6, 255]);
    expect(mask.data[3 * 10 + 3]).toBe(0);
    expect(mask.data[6 * 10 + 6]).toBe(0);
  });

  it("clamps brushes at the image edges without throwing", () => {
    // Center (0, 0), radius 1: only pixel (0, 0) has its center inside.
    const mask = rasterizeRepairMask([repair(0, 0, 0.2)], 10, 10);
    expect(maskedPixels(mask)).toEqual([[0, 0, 255]]);
  });

  it("clamps fully off-canvas brushes to an empty mask", () => {
    const mask = rasterizeRepairMask([repair(-0.5, 0.5, 0.2)], 10, 10);
    expect(maskedPixels(mask)).toEqual([]);
  });

  it("ignores clone strokes", () => {
    const mask = rasterizeRepairMask([clone(0.5, 0.5), repair(0.5, 0.5, 0.2, 100)], 10, 10);
    // The clone stroke at the same spot carries strength 100 too, but with a
    // different brush (0.2 vs its own size) it would paint a different disc if
    // it were rasterized; the repair disc alone is the 2x2 block.
    expect(maskedPixels(mask)).toHaveLength(4);
    const cloneOnly = rasterizeRepairMask([clone(0.5, 0.5)], 10, 10);
    expect(maskedPixels(cloneOnly)).toEqual([]);
  });

  it("encodes per-point strength in the mask value, max wins on overlap", () => {
    const mask = rasterizeRepairMask(
      [repair(0.5, 0.5, 0.2, 25), repair(0.5, 0.5, 0.2, 100), repair(0.15, 0.15, 0.2, 50)],
      10,
      10,
    );
    // Center disc takes the stronger stroke; the offset disc keeps 50%.
    expect(mask.data[4 * 10 + 4]).toBe(255);
    expect(mask.data[1 * 10 + 1]).toBe(Math.round((50 / 100) * 255));
  });

  it("skips degenerate strokes instead of throwing", () => {
    const mask = rasterizeRepairMask(
      [
        repair(NaN, 0.5, 0.2),
        repair(0.5, NaN, 0.2),
        repair(0.5, 0.5, 0),
        repair(0.5, 0.5, -0.1),
        repair(0.5, 0.5, NaN),
        repair(0.5, 0.5, 0.2, 0),
        repair(0.5, 0.5, 0.2, -5),
        repair(0.5, 0.5, 0.2, NaN),
      ],
      10,
      10,
    );
    expect(maskedPixels(mask)).toEqual([]);
  });

  it("clamps over-range strength to full instead of skipping", () => {
    const mask = rasterizeRepairMask([repair(0.5, 0.5, 0.2, 120)], 10, 10);
    expect(mask.data[4 * 10 + 4]).toBe(255);
  });

  it("rejects invalid dimensions", () => {
    expect(() => rasterizeRepairMask([], 0, 10)).toThrow(RangeError);
    expect(() => rasterizeRepairMask([], 10, -2)).toThrow(RangeError);
    expect(() => rasterizeRepairMask([], 10.5, 10)).toThrow(RangeError);
  });
});

describe("inpaintRadiusForBrush", () => {
  it("ties the radius to brush size within the documented bounds", () => {
    // Default 45px brush on an 1800px preview: radius ~6.
    expect(inpaintRadiusForBrush(45 / 800, 1800)).toBe(6);
    // Smallest brush still gets the OpenCV tutorial default.
    expect(inpaintRadiusForBrush(5 / 800, 1800)).toBe(INPAINT_RADIUS_MIN);
    // Largest brush is capped to bound compute cost.
    expect(inpaintRadiusForBrush(160 / 800, 1800)).toBe(INPAINT_RADIUS_MAX);
  });

  it("falls back to the minimum for degenerate brushes", () => {
    expect(inpaintRadiusForBrush(0, 1800)).toBe(INPAINT_RADIUS_MIN);
    expect(inpaintRadiusForBrush(NaN, 1800)).toBe(INPAINT_RADIUS_MIN);
  });

  it("rejects invalid widths", () => {
    expect(() => inpaintRadiusForBrush(0.05, 0)).toThrow(RangeError);
  });
});

describe("INPAINT_DEFAULT_METHOD", () => {
  it("heals by transplanting texture instead of smudging it", () => {
    expect(INPAINT_DEFAULT_METHOD).toBe("heal");
  });
});

describe("dilateRepairMask", () => {
  it("grows a single pixel into a 3x3 block", () => {
    const mask: RepairMask = { width: 5, height: 5, data: new Uint8ClampedArray(25) };
    mask.data[2 * 5 + 2] = 255;
    const out = dilateRepairMask(mask, 1);
    expect(maskedPixels(out)).toEqual([
      [1, 1, 255],
      [2, 1, 255],
      [3, 1, 255],
      [1, 2, 255],
      [2, 2, 255],
      [3, 2, 255],
      [1, 3, 255],
      [2, 3, 255],
      [3, 3, 255],
    ]);
  });

  it("carries the strongest nearby strength outward", () => {
    const mask: RepairMask = { width: 5, height: 1, data: new Uint8ClampedArray([0, 64, 0, 200, 0]) };
    const out = dilateRepairMask(mask, 1);
    expect(Array.from(out.data)).toEqual([64, 64, 200, 200, 200]);
  });

  it("copies at radius 0 without aliasing the input", () => {
    const mask: RepairMask = { width: 3, height: 2, data: new Uint8ClampedArray([0, 9, 0, 0, 0, 7]) };
    const out = dilateRepairMask(mask, 0);
    expect(out.data).not.toBe(mask.data);
    expect(Array.from(out.data)).toEqual([0, 9, 0, 0, 0, 7]);
  });

  it("rejects invalid radii and masks", () => {
    const mask: RepairMask = { width: 2, height: 2, data: new Uint8ClampedArray(4) };
    expect(() => dilateRepairMask(mask, -1)).toThrow(RangeError);
    expect(() => dilateRepairMask(mask, 1.5)).toThrow(RangeError);
    expect(() => dilateRepairMask({ width: 2, height: 2, data: new Uint8ClampedArray(3) }, 1)).toThrow(RangeError);
  });
});

describe("featherRepairMask", () => {
  it("ramps the edge over the feather radius and keeps the interior", () => {
    const data = new Uint8ClampedArray(81);
    for (let y = 2; y <= 6; y += 1) {
      for (let x = 2; x <= 6; x += 1) {
        data[y * 9 + x] = 255;
      }
    }
    const out = featherRepairMask({ width: 9, height: 9, data }, 2);
    // Adjacent to the outside: half strength; two pixels in: full.
    expect(out.data[2 * 9 + 2]).toBe(128);
    expect(out.data[2 * 9 + 4]).toBe(128);
    expect(out.data[3 * 9 + 3]).toBe(255);
    expect(out.data[4 * 9 + 4]).toBe(255);
    expect(out.data[0]).toBe(0);
    expect(out.data[1 * 9 + 4]).toBe(0);
  });

  it("scales partial strengths proportionally", () => {
    const data = new Uint8ClampedArray(25);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        data[y * 5 + x] = 100;
      }
    }
    const out = featherRepairMask({ width: 5, height: 5, data }, 2);
    expect(out.data[1 * 5 + 1]).toBe(50);
    expect(out.data[2 * 5 + 2]).toBe(100);
  });

  it("leaves a mask with no outside at full strength", () => {
    const out = featherRepairMask({ width: 2, height: 2, data: new Uint8ClampedArray([255, 128, 64, 32]) }, 2);
    expect(Array.from(out.data)).toEqual([255, 128, 64, 32]);
  });

  it("copies at radius 0 and rejects invalid radii", () => {
    const mask: RepairMask = { width: 2, height: 2, data: new Uint8ClampedArray([0, 9, 0, 7]) };
    const out = featherRepairMask(mask, 0);
    expect(out.data).not.toBe(mask.data);
    expect(Array.from(out.data)).toEqual([0, 9, 0, 7]);
    expect(() => featherRepairMask(mask, -2)).toThrow(RangeError);
    expect(() => featherRepairMask(mask, NaN)).toThrow(RangeError);
  });
});

describe("resolveFeatherPx", () => {
  it("passes the slider range through untouched", () => {
    expect(resolveFeatherPx(0)).toBe(0);
    expect(resolveFeatherPx(2)).toBe(2);
    expect(resolveFeatherPx(8)).toBe(8);
  });

  it("falls back to the default for absent or non-finite input", () => {
    expect(resolveFeatherPx()).toBe(BLEND_FEATHER_PX);
    expect(resolveFeatherPx(NaN)).toBe(BLEND_FEATHER_PX);
  });

  it("clamps to the supported 0..MAX range", () => {
    expect(resolveFeatherPx(-3)).toBe(0);
    expect(resolveFeatherPx(40)).toBe(BLEND_FEATHER_MAX_PX);
    expect(resolveFeatherPx(2.6)).toBe(3);
  });
});

describe("inpaintWithCv method guard", () => {
  it("rejects heal before touching OpenCV", () => {
    // Validation runs before any Mat is created, so no runtime is needed.
    expect(() =>
      inpaintWithCv(
        {} as unknown as InpaintCvApi,
        solidColor(4, 4, 10, 10, 10),
        { width: 4, height: 4, data: new Uint8ClampedArray(16) },
        3,
        "heal",
      ),
    ).toThrow(RangeError);
  });
});

describe("inpaintRadiusForStrokes", () => {
  it("takes the largest repair brush and ignores clones", () => {
    expect(inpaintRadiusForStrokes([repair(0.1, 0.1, 45 / 800), repair(0.5, 0.5, 80 / 800)], 1800)).toBe(
      inpaintRadiusForBrush(80 / 800, 1800),
    );
    expect(inpaintRadiusForStrokes([clone(0.5, 0.5)], 1800)).toBe(INPAINT_RADIUS_MIN);
    expect(inpaintRadiusForStrokes([], 1800)).toBe(INPAINT_RADIUS_MIN);
  });
});

describe("blendInpainted", () => {
  const source = solidColor(4, 4, 100, 100, 100);
  const filled = solidColor(4, 4, 200, 200, 200);
  const maskOf = (value: number): RepairMask => ({
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(16).fill(value),
  });

  it("copies the source where the mask is zero", () => {
    const out = blendInpainted(source, filled, maskOf(0));
    expect(out).not.toBe(source);
    expect(Array.from(out.data)).toEqual(Array.from(source.data));
  });

  it("takes the inpainted pixels where the mask is full", () => {
    const out = blendInpainted(source, filled, maskOf(255));
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(Array.from(out.data)).toEqual(Array.from(filled.data));
  });

  it("interpolates partial mask values and keeps source alpha", () => {
    const dim = solidColor(2, 2, 100, 100, 100, 40);
    const bright = solidColor(2, 2, 200, 200, 200, 200);
    const out = blendInpainted(dim, bright, { width: 2, height: 2, data: new Uint8ClampedArray([128, 0, 255, 64]) });
    // 128/255 alpha: round(100 * (127/255) + 200 * (128/255)) = 150.
    expect(Array.from(out.data.slice(0, 4))).toEqual([150, 150, 150, 40]);
    expect(Array.from(out.data.slice(4, 8))).toEqual([100, 100, 100, 40]);
    expect(Array.from(out.data.slice(8, 12))).toEqual([200, 200, 200, 40]);
    expect(out.data[15]).toBe(40);
  });

  it("rejects mismatched dimensions", () => {
    expect(() => blendInpainted(source, solidColor(2, 2, 0, 0, 0), maskOf(255))).toThrow(RangeError);
    expect(() => blendInpainted(source, filled, { width: 2, height: 2, data: new Uint8ClampedArray(4) })).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// Golden tests: real cv.inpaint through the same helper the vision worker
// calls. OpenCV loads lazily here so the pure tests above stay fast.
// ---------------------------------------------------------------------------

let cachedCv: InpaintCvApi | null = null;

async function loadTestCv(): Promise<InpaintCvApi> {
  if (cachedCv) return cachedCv;
  // require(), not import(): the Emscripten export carries a `then` that
  // vite-node surfaces as a named export, which breaks `await import()`.
  // Same normalization as the vision worker otherwise: the export is the
  // runtime module or a promise of it.
  const require = createRequire(import.meta.url);
  const raw = require("@techstark/opencv-js") as unknown;
  const maybeDefault = (raw as { default?: unknown }).default ?? raw;
  const settled = (
    maybeDefault instanceof Promise ? await maybeDefault : maybeDefault
  ) as InpaintCvApi & { Mat?: unknown; onRuntimeInitialized?: (() => void) | null };
  if (!settled.Mat) {
    await new Promise<void>((resolve) => {
      settled.onRuntimeInitialized = () => resolve();
    });
  }
  cachedCv = settled;
  return settled;
}

/** Deterministic photo-like image with a synthetic dark blemish. */
function blemishedFixture(): { image: PixelImage; mask: RepairMask; radius: number } {
  const image = goldenPhoto(48, 32);
  // 5x5 blemish, much darker than the warm gradient around it.
  for (let y = 12; y <= 16; y += 1) {
    for (let x = 20; x <= 24; x += 1) {
      const i = (y * 48 + x) * 4;
      image.data[i] = 10;
      image.data[i + 1] = 8;
      image.data[i + 2] = 8;
    }
  }
  const strokes = [repair(22.5 / 48, 14.5 / 32, 0.15, 100)];
  const mask = rasterizeRepairMask(strokes, 48, 32);
  return { image, mask, radius: inpaintRadiusForStrokes(strokes, 48) };
}

// Masked-pixel RGB triplets in row-major order (37 pixels), recorded from
// @techstark/opencv-js 5.0.0-release.1 at radius 3. Re-record if the OpenCV
// build changes; per-channel tolerance is +-2.
const TELEA_GOLDEN: number[] = [
  88, 79, 64, 91, 80, 62, 91, 81, 63,
  94, 77, 68, 92, 80, 67, 91, 80, 63,
  95, 83, 66, 98, 86, 66, 103, 85, 70,
  100, 83, 70, 98, 83, 69, 100, 87, 70,
  99, 87, 69, 99, 89, 69, 100, 91, 71,
  109, 94, 73, 109, 93, 74, 107, 92, 74,
  108, 94, 76, 105, 91, 75, 104, 92, 74,
  102, 91, 75, 113, 96, 79, 116, 98, 82,
  115, 97, 81, 112, 97, 78, 116, 101, 79,
  116, 100, 80, 111, 96, 79, 121, 102, 87,
  125, 104, 88, 123, 107, 84, 125, 108, 85,
  123, 106, 82, 128, 106, 90, 128, 112, 86,
  129, 112, 86,
];
const NS_GOLDEN: number[] = [
  90, 78, 63, 93, 80, 62, 93, 82, 62,
  94, 79, 68, 93, 79, 65, 94, 81, 63,
  95, 84, 64, 98, 88, 67, 104, 87, 69,
  101, 86, 68, 100, 85, 67, 98, 85, 67,
  98, 87, 68, 100, 90, 71, 101, 91, 73,
  108, 93, 71, 109, 95, 72, 108, 93, 73,
  107, 92, 74, 104, 91, 74, 102, 91, 74,
  101, 89, 76, 110, 96, 78, 115, 98, 80,
  117, 99, 82, 114, 98, 81, 111, 97, 79,
  106, 94, 77, 105, 92, 77, 118, 99, 87,
  123, 101, 87, 121, 105, 84, 118, 104, 81,
  117, 101, 78, 127, 104, 87, 125, 109, 85,
  125, 112, 82,
];

function maskedRgb(image: PixelImage, mask: RepairMask): number[] {
  assertValidImage(image);
  const values: number[] = [];
  for (let p = 0; p < mask.data.length; p += 1) {
    if ((mask.data[p] ?? 0) === 0) continue;
    const i = p * 4;
    values.push(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0);
  }
  return values;
}

function expectWithinTolerance(actual: number[], expected: number[], tolerance: number): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(Math.abs((actual[i] ?? 0) - (expected[i] ?? 0))).toBeLessThanOrEqual(tolerance);
  }
}

describe("inpaintWithCv golden", () => {
  it(
    "reconstructs the blemish with TELEA within tolerance of the recording",
    async () => {
      const cv = await loadTestCv();
      const { image, mask, radius } = blemishedFixture();
      expect(radius).toBe(3);
      const out = inpaintWithCv(cv, image, mask, radius, "telea");
      // Unmasked pixels (including alpha) pass through bit-exact.
      for (let p = 0; p < mask.data.length; p += 1) {
        if ((mask.data[p] ?? 0) !== 0) continue;
        const i = p * 4;
        expect(out.data[i]).toBe(image.data[i]);
        expect(out.data[i + 1]).toBe(image.data[i + 1]);
        expect(out.data[i + 2]).toBe(image.data[i + 2]);
        expect(out.data[i + 3]).toBe(image.data[i + 3]);
      }
      // The dark core is rebuilt from the brighter surroundings.
      let coreMean = 0;
      for (let y = 12; y <= 16; y += 1) {
        for (let x = 20; x <= 24; x += 1) {
          coreMean += out.data[(y * 48 + x) * 4] ?? 0;
        }
      }
      expect(coreMean / 25).toBeGreaterThan(60);
      expectWithinTolerance(maskedRgb(out, mask), TELEA_GOLDEN, 2);
    },
    120_000,
  );

  it(
    "reconstructs the blemish with NS within tolerance of the recording",
    async () => {
      const cv = await loadTestCv();
      const { image, mask, radius } = blemishedFixture();
      const out = inpaintWithCv(cv, image, mask, radius, "ns" satisfies InpaintMethod);
      expectWithinTolerance(maskedRgb(out, mask), NS_GOLDEN, 2);
    },
    120_000,
  );

  it(
    "leaves an empty mask near-untouched",
    async () => {
      const cv = await loadTestCv();
      const image = goldenPhoto(48, 32);
      const empty: RepairMask = { width: 48, height: 32, data: new Uint8ClampedArray(48 * 32) };
      const out = inpaintWithCv(cv, image, empty, 3, "telea");
      let maxDiff = 0;
      for (let i = 0; i < image.data.length; i += 1) {
        maxDiff = Math.max(maxDiff, Math.abs((out.data[i] ?? 0) - (image.data[i] ?? 0)));
      }
      expect(maxDiff).toBeLessThanOrEqual(1);
    },
    120_000,
  );
});
