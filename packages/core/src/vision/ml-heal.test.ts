import { describe, expect, it } from "vitest";
import { solidColor } from "./fixtures.js";
import type { RepairMask } from "./inpaint.js";
import {
  ML_HEAL_MODEL_SIZE,
  compositeMlHealOutput,
  packMlHealInput,
  planMlHealRoi,
} from "./ml-heal.js";

function rectMask(width: number, height: number, x0: number, y0: number, x1: number, y1: number): RepairMask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      data[y * width + x] = 255;
    }
  }
  return { width, height, data };
}

describe("planMlHealRoi", () => {
  it("returns null for an empty mask", () => {
    const mask: RepairMask = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16) };
    expect(planMlHealRoi(mask)).toBeNull();
  });

  it("covers the bbox with a square clamped to the image", () => {
    const roi = planMlHealRoi(rectMask(64, 64, 10, 12, 20, 14));
    expect(roi).not.toBeNull();
    const { x0, y0, size } = roi ?? { x0: 0, y0: 0, size: 0 };
    expect(size).toBeGreaterThanOrEqual(11);
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(y0).toBeGreaterThanOrEqual(0);
    expect(x0 + size).toBeLessThanOrEqual(64);
    expect(y0 + size).toBeLessThanOrEqual(64);
    // Bbox corners inside the ROI.
    expect(x0).toBeLessThanOrEqual(10);
    expect(y0).toBeLessThanOrEqual(12);
    expect(x0 + size - 1).toBeGreaterThanOrEqual(20);
    expect(y0 + size - 1).toBeGreaterThanOrEqual(14);
  });

  it("clamps a corner blemish to the edge", () => {
    const roi = planMlHealRoi(rectMask(32, 32, 0, 0, 3, 3));
    expect(roi).not.toBeNull();
    expect(roi?.x0).toBe(0);
    expect(roi?.y0).toBe(0);
  });
});

describe("packMlHealInput", () => {
  it("packs fixed-size NCHW tensors with a binary mask", () => {
    const image = solidColor(24, 24, 200, 100, 50);
    const roi = planMlHealRoi(rectMask(24, 24, 10, 10, 12, 12)) ?? { x0: 0, y0: 0, size: 24 };
    const packed = packMlHealInput(image, rectMask(24, 24, 10, 10, 12, 12), roi);
    expect(packed.image.length).toBe(3 * ML_HEAL_MODEL_SIZE * ML_HEAL_MODEL_SIZE);
    expect(packed.mask.length).toBe(ML_HEAL_MODEL_SIZE * ML_HEAL_MODEL_SIZE);
    for (const v of packed.image) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect([...packed.mask].some((v) => v === 1)).toBe(true);
    expect([...packed.mask].every((v) => v === 0 || v === 1)).toBe(true);
  });

  it("throws on dimension mismatch", () => {
    const image = solidColor(8, 8, 0, 0, 0);
    const mask = rectMask(4, 4, 0, 0, 1, 1);
    expect(() => packMlHealInput(image, mask, { x0: 0, y0: 0, size: 4 })).toThrow(RangeError);
  });
});

describe("compositeMlHealOutput", () => {
  it("passes unmasked pixels through and fills masked ones", () => {
    const source = solidColor(16, 16, 10, 20, 30);
    const mask = rectMask(16, 16, 4, 4, 7, 7);
    const roi = planMlHealRoi(mask) ?? { x0: 0, y0: 0, size: 16 };
    const fake = new Float32Array(3 * ML_HEAL_MODEL_SIZE * ML_HEAL_MODEL_SIZE).fill(250);
    const out = compositeMlHealOutput(source, mask, roi, fake);
    // Outside the mask: bit-exact passthrough.
    expect(out.data[0]).toBe(10);
    expect(out.data[1]).toBe(20);
    // Inside the mask: model fill.
    const inside = (5 * 16 + 5) * 4;
    expect(out.data[inside]).toBe(250);
    expect(out.data[inside + 1]).toBe(250);
    // Alpha always from source.
    expect(out.data[inside + 3]).toBe(255);
    expect(out).not.toBe(source);
  });

  it("throws on bad output length", () => {
    const source = solidColor(8, 8, 0, 0, 0);
    const mask = rectMask(8, 8, 1, 1, 2, 2);
    const roi = planMlHealRoi(mask) ?? { x0: 0, y0: 0, size: 8 };
    expect(() => compositeMlHealOutput(source, mask, roi, new Float32Array(4))).toThrow(RangeError);
  });
});
