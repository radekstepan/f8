import { describe, expect, it } from "vitest";
import {
  estimateStraightenGradient,
  packStraightenInput,
  parseStraightenOutput,
  STRAIGHTEN_ML_SIZE,
} from "./straighten-ml.js";
import type { PixelImage } from "./analyze.js";

function solid(width: number, height: number, r = 10, g = 20, b = 30): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe("straighten-ml", () => {
  it("packs to 1x3x224x224 normalized floats", () => {
    const packed = packStraightenInput(solid(8, 6, 255, 255, 255));
    expect(packed.length).toBe(3 * STRAIGHTEN_ML_SIZE * STRAIGHTEN_ML_SIZE);
    // White (1.0) minus ImageNet mean over std: red channel ≈ 2.25.
    expect(packed[0] ?? 0).toBeCloseTo((1 - 0.485) / 0.229, 3);
  });

  it("clamps and rounds regressor output, never wild", () => {
    expect(parseStraightenOutput(45, 0)).toEqual({ angle: 15, confidence: 1 });
    expect(parseStraightenOutput(-2.34, 0)).toEqual({ angle: -2.3, confidence: 1 });
    expect(parseStraightenOutput(Number.NaN)).toEqual({ angle: 0, confidence: 0 });
    expect(parseStraightenOutput(3, 24).confidence).toBe(0);
  });

  it("votes ~0 at high confidence on a horizontal edge", () => {
    const image = solid(64, 64, 0, 0, 0);
    for (let x = 0; x < 64; x += 1) {
      const i = (32 * 64 + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
    }
    const vote = estimateStraightenGradient(image);
    expect(vote.angle).toBeCloseTo(0, 0);
    expect(vote.confidence).toBeGreaterThan(0.5);
  });

  it("returns zero confidence on flat input", () => {
    const vote = estimateStraightenGradient(solid(32, 32, 128, 128, 128));
    expect(vote).toEqual({ angle: 0, confidence: 0 });
  });
});
