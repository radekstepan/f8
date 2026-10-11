import { describe, expect, it } from "vitest";
import { solidColor } from "./fixtures.js";
import type { RepairMask } from "./inpaint.js";
import {
  ML_HEAL_ENGINE_EPS,
  ML_HEAL_MODEL_SIZE,
  MOEBIUS_TRAIN_STEPS,
  compositeMlHealOutput,
  downsampleMaskToLatent,
  formatMlCapabilities,
  makeSeededGaussian,
  maskMlHealInputForEncode,
  mlHealEngineForQuality,
  mlHealWasmThreads,
  moebiusAlphasCumprod,
  moebiusBetas,
  moebiusStepCount,
  moebiusTimesteps,
  packMlHealInput,
  planMlHealRoi,
  seedMoebiusLatents,
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

describe("mlHealEngineForQuality", () => {
  it("maps Fast to classic, Balanced to LaMa, Best to Moebius", () => {
    expect(mlHealEngineForQuality("fast")).toBe("classic");
    expect(mlHealEngineForQuality("balanced")).toBe("lama");
    expect(mlHealEngineForQuality("best")).toBe("moebius");
  });

  it("routes LaMa to wasm-only and Moebius to webgpu-only", () => {
    expect(ML_HEAL_ENGINE_EPS.lama).toEqual(["wasm"]);
    expect(ML_HEAL_ENGINE_EPS.moebius).toEqual(["webgpu"]);
    expect(ML_HEAL_ENGINE_EPS.classic).toEqual([]);
  });
});

describe("mlHealWasmThreads", () => {
  it("is single-threaded without cross-origin isolation", () => {
    expect(mlHealWasmThreads(false, 16)).toBe(1);
  });

  it("uses up to 4 threads with isolation", () => {
    expect(mlHealWasmThreads(true, 16)).toBe(4);
    expect(mlHealWasmThreads(true, 2)).toBe(2);
    expect(mlHealWasmThreads(true, 0)).toBe(1);
  });
});

describe("formatMlCapabilities", () => {
  it("summarizes webgpu and threading", () => {
    expect(formatMlCapabilities({ webgpu: true, crossOriginIsolated: false, hardwareConcurrency: 8 })).toBe(
      "WebGPU: yes · Threads: single",
    );
    expect(formatMlCapabilities({ webgpu: false, crossOriginIsolated: true, hardwareConcurrency: 8 })).toBe(
      "WebGPU: no · Threads: shared (4)",
    );
  });
});

describe("moebius schedule", () => {
  it("uses 19 steps at 20 inference steps and 0.99 strength", () => {
    expect(moebiusStepCount(20, 0.99)).toBe(19);
    expect(moebiusTimesteps(20, 0.99)).toHaveLength(19);
  });

  it("matches the reference floor-grid schedule exactly", () => {
    // floor(1000/20)=50 grid [0..950], reversed, strength-trimmed to 19.
    expect(moebiusTimesteps(20, 0.99)).toEqual([
      900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50, 0,
    ]);
    expect(moebiusTimesteps(10, 0.99)).toEqual([800, 700, 600, 500, 400, 300, 200, 100, 0]);
  });

  it("emits descending timesteps within the training range", () => {
    const steps = moebiusTimesteps();
    for (const t of steps) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(MOEBIUS_TRAIN_STEPS);
    }
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i] as number).toBeLessThan(steps[i - 1] as number);
    }
  });

  it("builds a decaying cumulative alpha product", () => {
    const alphas = moebiusAlphasCumprod(moebiusBetas());
    expect(alphas.length).toBe(MOEBIUS_TRAIN_STEPS);
    expect(alphas[0] as number).toBeLessThan(1);
    expect(alphas[0] as number).toBeGreaterThan(0.99);
    expect(alphas[alphas.length - 1] as number).toBeLessThan(alphas[0] as number);
    for (let i = 1; i < alphas.length; i += 1) {
      expect(alphas[i] as number).toBeLessThanOrEqual(alphas[i - 1] as number);
    }
  });
});

describe("downsampleMaskToLatent", () => {
  it("samples the top-left pixel of each 8x8 block (reference parity)", () => {
    const mask = new Float32Array(ML_HEAL_MODEL_SIZE * ML_HEAL_MODEL_SIZE);
    mask[100 * ML_HEAL_MODEL_SIZE + 100] = 1;
    const latent = downsampleMaskToLatent(mask);
    expect(latent.length).toBe(64 * 64);
    // (100,100) is not a block top-left (96,96)..(103,103) → sampled at (96,96)? no:
    // top-left sampling reads mask[ly*8*512 + lx*8]; pixel (100,100) is never read.
    expect(latent[(100 >> 3) * 64 + (100 >> 3)]).toBe(0);
    mask[96 * ML_HEAL_MODEL_SIZE + 96] = 1;
    expect(downsampleMaskToLatent(mask)[12 * 64 + 12]).toBe(1);
    expect(latent[0]).toBe(0);
    expect(latent[63 * 64 + 63]).toBe(0);
  });

  it("throws on wrong input size", () => {
    expect(() => downsampleMaskToLatent(new Float32Array(4))).toThrow(RangeError);
  });
});

describe("maskMlHealInputForEncode", () => {
  it("zeroes the masked hole in [-1, 1] space and keeps context", () => {
    const size = ML_HEAL_MODEL_SIZE;
    const image = new Float32Array(3 * size * size).fill(1); // white → +1
    const mask = new Float32Array(size * size);
    mask[0] = 1;
    const out = maskMlHealInputForEncode(image, mask);
    expect(out[0]).toBe(0);
    expect(out[size * size]).toBe(0);
    expect(out[1]).toBe(1);
    expect(() => maskMlHealInputForEncode(new Float32Array(4), mask)).toThrow(RangeError);
  });
});

describe("seedMoebiusLatents", () => {
  it("is deterministic with per-channel offsets", () => {
    const a = seedMoebiusLatents(makeSeededGaussian, 0);
    expect(a.length).toBe(4 * 64 * 64);
    expect(Array.from(a)).toEqual(Array.from(seedMoebiusLatents(makeSeededGaussian, 0)));
    expect(Array.from(a)).not.toEqual(Array.from(seedMoebiusLatents(makeSeededGaussian, 1)));
    // Channel means differ by the small per-channel offset, not by whole sigmas.
    const mean = (c: number) => a.slice(c * 4096, (c + 1) * 4096).reduce((s, v) => s + v, 0) / 4096;
    for (let c = 0; c < 4; c += 1) expect(Math.abs(mean(c))).toBeLessThan(0.5);
  });
});

describe("makeSeededGaussian", () => {
  it("is deterministic for one seed and differs across seeds", () => {
    const first = makeSeededGaussian(0);
    const second = makeSeededGaussian(0);
    const values = Array.from({ length: 8 }, () => first());
    expect(Array.from({ length: 8 }, () => second())).toEqual(values);
    expect(makeSeededGaussian(1)()).not.toBe(values[0]);
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
