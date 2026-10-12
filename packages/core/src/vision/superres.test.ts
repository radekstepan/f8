import { describe, expect, it } from "vitest";
import {
  SUPERRES_MAX_INPUT_DIM,
  SUPERRES_SCALE,
  SUPERRES_TILE,
  SUPERRES_TILE_OVERLAP,
  packSuperresInput,
  parseSuperresOutput,
  stitchSuperresTiles,
  superresOutputSize,
  superresTilePlan,
  superresTileProgress,
  upscaleClassic2x,
} from "./superres.js";
import type { PixelImage } from "./analyze.js";

function solid(width: number, height: number, r = 128, g = 64, b = 32, a = 255): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    data[p * 4] = r;
    data[p * 4 + 1] = g;
    data[p * 4 + 2] = b;
    data[p * 4 + 3] = a;
  }
  return { width, height, data };
}

describe("super-resolution scale math", () => {
  it("doubles both dimensions", () => {
    expect(superresOutputSize(1200, 800)).toEqual({ width: 2400, height: 1600 });
    expect(superresOutputSize(1, 1)).toEqual({ width: 2, height: 2 });
    expect(SUPERRES_SCALE).toBe(2);
  });

  it("plans a single halo-less tile for small frames", () => {
    const plan = superresTilePlan(320, 200);
    expect(plan).toHaveLength(1);
    const tile = plan[0]!;
    expect([tile.x0, tile.y0, tile.x1, tile.y1]).toEqual([0, 0, 320, 200]);
    expect([tile.px0, tile.py0, tile.px1, tile.py1]).toEqual([0, 0, 320, 200]);
    expect([tile.outX, tile.outY, tile.outW, tile.outH]).toEqual([0, 0, 640, 400]);
    expect([tile.keepX, tile.keepY]).toEqual([0, 0]);
  });

  it("tiles large frames with clamped halos that exactly cover the image", () => {
    const width = SUPERRES_TILE + 100;
    const height = SUPERRES_TILE + 60;
    const plan = superresTilePlan(width, height);
    expect(plan.length).toBe(4);
    // Cores tile the frame with no gaps or overlaps.
    const covered = new Uint8Array(width * height);
    for (const tile of plan) {
      expect(tile.x1 - tile.x0).toBeLessThanOrEqual(SUPERRES_TILE);
      expect(tile.y1 - tile.y0).toBeLessThanOrEqual(SUPERRES_TILE);
      // Core inside padded, padded inside image.
      expect(tile.px0).toBeLessThanOrEqual(tile.x0);
      expect(tile.py0).toBeLessThanOrEqual(tile.y0);
      expect(tile.px1).toBeGreaterThanOrEqual(tile.x1);
      expect(tile.py1).toBeGreaterThanOrEqual(tile.y1);
      expect(tile.px0).toBeGreaterThanOrEqual(0);
      expect(tile.py0).toBeGreaterThanOrEqual(0);
      expect(tile.px1).toBeLessThanOrEqual(width);
      expect(tile.py1).toBeLessThanOrEqual(height);
      for (let y = tile.y0; y < tile.y1; y += 1) {
        for (let x = tile.x0; x < tile.x1; x += 1) covered[y * width + x]! += 1;
      }
    }
    expect(Array.from(covered).every((count) => count === 1)).toBe(true);
    // Interior edges carry the full halo; image borders clamp.
    const first = plan[0]!;
    expect(first.px0).toBe(0);
    expect(first.px1 - first.x1).toBe(SUPERRES_TILE_OVERLAP);
    const last = plan[3]!;
    expect(last.px1).toBe(width);
    expect(last.x0 - last.px0).toBe(SUPERRES_TILE_OVERLAP);
  });

  it("rejects invalid and over-cap dimensions", () => {
    expect(() => superresTilePlan(0, 64)).toThrow(RangeError);
    expect(() => superresTilePlan(64.5, 64)).toThrow(RangeError);
    expect(() => superresTilePlan(SUPERRES_MAX_INPUT_DIM + 1, 64)).toThrow(/2048px/);
    expect(() => superresTilePlan(64, SUPERRES_MAX_INPUT_DIM + 1)).toThrow(/smaller export size/);
    expect(superresTilePlan(SUPERRES_MAX_INPUT_DIM, 64)).toHaveLength(4);
  });
});

describe("super-resolution ONNX contract", () => {
  it("packs RGB float32 NCHW 0..1", () => {
    const packed = packSuperresInput(solid(2, 1, 255, 0, 128));
    expect(packed.length).toBe(6);
    expect(packed[0]).toBe(1);
    expect(packed[1]).toBe(1);
    expect(packed[2]).toBe(0);
    expect(packed[3]).toBe(0);
    expect(packed[4]).toBeCloseTo(128 / 255, 5);
    expect(packed[5]).toBeCloseTo(128 / 255, 5);
  });

  it("parses a 2x output with clamping and upscaled alpha", () => {
    const original = solid(2, 2, 100, 150, 200, 255);
    const outPlane = 16;
    const output = new Float32Array(3 * outPlane).fill(0.5);
    output[0] = 2; // clamps to 1
    output[outPlane] = -1; // clamps to 0
    const parsed = parseSuperresOutput(output, original);
    expect(parsed.width).toBe(4);
    expect(parsed.height).toBe(4);
    expect(parsed.data[0]).toBe(255);
    expect(parsed.data[1]).toBe(0);
    expect(parsed.data[2]).toBe(128);
    expect(parsed.data[3]).toBe(255);
  });

  it("sanitizes non-finite outputs toward the original", () => {
    const original = solid(1, 1, 80, 120, 160);
    const parsed = parseSuperresOutput([Number.NaN, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], original);
    expect(parsed.data[0]).toBe(80);
    expect(parsed.data[1]).toBe(128);
  });

  it("rejects shape mismatches", () => {
    expect(() => parseSuperresOutput(new Float32Array(12), solid(2, 2))).toThrow(RangeError);
  });
});

describe("super-resolution stitching", () => {
  it("reassembles tile cores at their output placements", () => {
    const width = SUPERRES_TILE + 8;
    const height = 64;
    const plan = superresTilePlan(width, height);
    expect(plan).toHaveLength(2);
    const outputs = plan.map((tile, index) => {
      const w = (tile.px1 - tile.px0) * SUPERRES_SCALE;
      const h = (tile.py1 - tile.py0) * SUPERRES_SCALE;
      // Halo poison (index 200+) must never survive the stitch; cores carry index.
      return solid(w, h, 200 + index, 0, 0);
    });
    // Paint each core with its index so placement is checkable.
    const painted = plan.map((tile, index) => {
      const output = outputs[index]!;
      const data = new Uint8ClampedArray(output.data);
      for (let y = 0; y < tile.outH; y += 1) {
        for (let x = 0; x < tile.outW; x += 1) {
          data[((tile.keepY + y) * output.width + (tile.keepX + x)) * 4] = index;
        }
      }
      return { ...output, data };
    });
    const stitched = stitchSuperresTiles(plan, painted, width, height);
    expect(stitched.width).toBe(width * 2);
    expect(stitched.height).toBe(height * 2);
    // Every output pixel carries its tile's core index; no halo poison leaks.
    for (let y = 0; y < stitched.height; y += 1) {
      for (let x = 0; x < stitched.width; x += 1) {
        const value = stitched.data[(y * stitched.width + x) * 4]!;
        const owner = plan.findIndex(
          (tile) => x >= tile.outX && x < tile.outX + tile.outW && y >= tile.outY && y < tile.outY + tile.outH,
        );
        expect(value).toBe(owner);
      }
    }
  });

  it("rejects count and size mismatches", () => {
    const plan = superresTilePlan(32, 32);
    expect(() => stitchSuperresTiles(plan, [], 32, 32)).toThrow(RangeError);
    expect(() => stitchSuperresTiles(plan, [solid(60, 64)], 32, 32)).toThrow(/tile 0/);
  });
});

describe("super-resolution tile progress", () => {
  it("maps tile counts into the 0.15..0.95 band with tile copy", () => {
    expect(superresTileProgress(0, 4)).toEqual({ fraction: 0.15, stage: "Upscaling tile 1 of 4…" });
    expect(superresTileProgress(2, 4)).toEqual({ fraction: 0.55, stage: "Upscaling tile 3 of 4…" });
    expect(superresTileProgress(4, 4).fraction).toBeCloseTo(0.95, 5);
    // Over-counts clamp instead of overflowing the bar.
    expect(superresTileProgress(9, 4).fraction).toBeCloseTo(0.95, 5);
  });

  it("holds steady copy for single-tile, classical, and invalid counts", () => {
    expect(superresTileProgress(0, 1)).toEqual({ fraction: 0.4, stage: "Upscaling…" });
    expect(superresTileProgress(0, 0)).toEqual({ fraction: 0.4, stage: "Upscaling…" });
    expect(superresTileProgress(-1, 4)).toEqual({ fraction: 0.4, stage: "Upscaling…" });
  });
});

describe("classical 2x fallback", () => {
  it("doubles dimensions and passes flats through", () => {
    const upscaled = upscaleClassic2x(solid(8, 6, 100, 150, 200));
    expect(upscaled.width).toBe(16);
    expect(upscaled.height).toBe(12);
    for (let p = 0; p < 16 * 12; p += 1) {
      expect(upscaled.data[p * 4]).toBe(100);
      expect(upscaled.data[p * 4 + 1]).toBe(150);
      expect(upscaled.data[p * 4 + 2]).toBe(200);
      expect(upscaled.data[p * 4 + 3]).toBe(255);
    }
  });

  it("keeps a hard step edge monotonic without collapsing it", () => {
    const data = new Uint8ClampedArray(16 * 1 * 4);
    for (let x = 0; x < 16; x += 1) {
      const v = x < 8 ? 0 : 255;
      data[x * 4] = v;
      data[x * 4 + 1] = v;
      data[x * 4 + 2] = v;
      data[x * 4 + 3] = 255;
    }
    const upscaled = upscaleClassic2x({ width: 16, height: 1, data });
    expect(upscaled.width).toBe(32);
    const row = Array.from({ length: 32 }, (_, x) => upscaled.data[x * 4]!);
    // Far ends settle at the step levels; the middle crosses from dark to light.
    expect(row[0]).toBeLessThan(8);
    expect(row[31]).toBeGreaterThan(247);
    expect(row[15]).toBeLessThan(128);
    expect(row[16]).toBeGreaterThan(128);
  });

  it("upscales alpha bilinearly", () => {
    const ramp = solid(4, 1);
    for (let x = 0; x < 4; x += 1) ramp.data[x * 4 + 3] = x === 0 ? 0 : 255;
    const upscaled = upscaleClassic2x(ramp);
    expect(upscaled.data[3]).toBe(0);
    expect(upscaled.data[7 * 4 + 3]).toBe(255);
    const mid = upscaled.data[1 * 4 + 3]!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(255);
  });
});
