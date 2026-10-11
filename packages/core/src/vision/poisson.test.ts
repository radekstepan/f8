import { describe, expect, it } from "vitest";
import {
  HEAL_POISSON_MAX_ITERATIONS,
  HEAL_POISSON_OMEGA,
  solveHarmonicLightingField,
} from "./poisson.js";

/** Square hole mask: 1 inside the inclusive rect, 0 outside. */
function holeMask(width: number, height: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      mask[y * width + x] = 1;
    }
  }
  return mask;
}

function constantField(size: number, value: number): Float32Array {
  return new Float32Array(size).fill(value);
}

describe("solveHarmonicLightingField", () => {
  it("leaves a constant boundary field flat inside the hole", () => {
    const width = 12;
    const height = 12;
    const mask = holeMask(width, height, 4, 4, 7, 7);
    const { fieldR, fieldG, fieldB } = solveHarmonicLightingField(
      mask,
      constantField(width * height, 30),
      constantField(width * height, -12),
      constantField(width * height, 5),
      width,
      height,
    );
    for (let i = 0; i < width * height; i += 1) {
      expect(fieldR[i]).toBeCloseTo(30, 1);
      expect(fieldG[i]).toBeCloseTo(-12, 1);
      expect(fieldB[i]).toBeCloseTo(5, 1);
    }
  });

  it("interpolates a linear ramp smoothly across the hole", () => {
    // Boundary carries a left-to-right ramp; the harmonic interior must
    // continue it instead of collapsing to the mean.
    const width = 16;
    const height = 8;
    const mask = holeMask(width, height, 5, 2, 10, 5);
    const boundary = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        boundary[y * width + x] = x * 4;
      }
    }
    const { fieldR } = solveHarmonicLightingField(
      mask,
      boundary,
      constantField(width * height, 0),
      constantField(width * height, 0),
      width,
      height,
    );
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 5; x <= 10; x += 1) {
        // Exact discrete-harmonic values bow slightly off the straight ramp
        // near the top/bottom edges; 3.0 tolerates that without hiding seams.
        expect(fieldR[y * width + x]).toBeCloseTo(x * 4, 0);
      }
    }
  });

  it("keeps boundary pixels exact and never mutates its inputs", () => {
    const width = 10;
    const height = 10;
    const mask = holeMask(width, height, 3, 3, 6, 6);
    const boundaryR = constantField(width * height, 0);
    for (let i = 0; i < boundaryR.length; i += 1) boundaryR[i] = (i * 37) % 61 - 30;
    const snapshot = new Float32Array(boundaryR);
    const { fieldR } = solveHarmonicLightingField(
      mask,
      boundaryR,
      constantField(width * height, 0),
      constantField(width * height, 0),
      width,
      height,
    );
    expect(boundaryR).toEqual(snapshot);
    for (let i = 0; i < width * height; i += 1) {
      if (mask[i] === 0) expect(fieldR[i]).toBe(snapshot[i] ?? 0);
      expect(Number.isFinite(fieldR[i])).toBe(true);
    }
  });

  it("returns the boundary field untouched when no hole boundary exists", () => {
    const width = 6;
    const height = 6;
    const boundaryR = constantField(width * height, 7);
    const { fieldR } = solveHarmonicLightingField(
      new Uint8Array(width * height),
      boundaryR,
      constantField(width * height, 0),
      constantField(width * height, 0),
      width,
      height,
    );
    expect(fieldR).toEqual(boundaryR);
  });

  it("is deterministic for identical inputs", () => {
    const width = 12;
    const height = 12;
    const mask = holeMask(width, height, 4, 4, 7, 7);
    const boundaryR = constantField(width * height, 0);
    for (let i = 0; i < boundaryR.length; i += 1) boundaryR[i] = Math.sin(i * 1.7) * 40;
    const first = solveHarmonicLightingField(mask, boundaryR, boundaryR, boundaryR, width, height);
    const second = solveHarmonicLightingField(mask, boundaryR, boundaryR, boundaryR, width, height);
    expect(first.fieldR).toEqual(second.fieldR);
    expect(first.fieldG).toEqual(second.fieldG);
    expect(first.fieldB).toEqual(second.fieldB);
  });

  it("honours an explicit iteration budget of zero", () => {
    const width = 12;
    const height = 12;
    const mask = holeMask(width, height, 4, 4, 7, 7);
    const { fieldR } = solveHarmonicLightingField(
      mask,
      constantField(width * height, 20),
      constantField(width * height, 0),
      constantField(width * height, 0),
      width,
      height,
      { maxIterations: 0 },
    );
    // Interior seeds to the boundary mean (20) with no sweeps to move it.
    expect(fieldR[5 * width + 5]).toBeCloseTo(20, 5);
  });

  it("rejects malformed dimensions, buffers, and solver options", () => {
    const mask = new Uint8Array(16);
    const field = new Float32Array(16);
    expect(() => solveHarmonicLightingField(mask, field, field, field, 0, 4)).toThrow(RangeError);
    expect(() => solveHarmonicLightingField(new Uint8Array(8), field, field, field, 4, 4)).toThrow(
      RangeError,
    );
    expect(() =>
      solveHarmonicLightingField(mask, field, field, field, 4, 4, { maxIterations: -1 }),
    ).toThrow(RangeError);
    expect(() => solveHarmonicLightingField(mask, field, field, field, 4, 4, { omega: 2 })).toThrow(
      RangeError,
    );
    expect(() =>
      solveHarmonicLightingField(mask, field, field, field, 4, 4, { tolerance: -0.5 }),
    ).toThrow(RangeError);
  });

  it("exposes the documented solver defaults", () => {
    expect(HEAL_POISSON_MAX_ITERATIONS).toBe(45);
    expect(HEAL_POISSON_OMEGA).toBeCloseTo(1.75, 5);
  });
});
