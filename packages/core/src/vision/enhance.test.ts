import { describe, expect, it } from "vitest";
import {
  AUTO_ENHANCE_KEYS,
  blackWhitePoints,
  channelHistograms,
  computeAutoEnhance,
  computeColorAuto,
  computeLightnessAuto,
  computeWhiteBalanceAuto,
  estimateExposureShift,
  grayWorldGains,
  meanSaturation,
  percentileValue,
} from "./enhance.js";
import { goldenPhoto, halfBlackHalfWhite, horizontalGradient, solidColor } from "./fixtures.js";

describe("channelHistograms", () => {
  it("counts every pixel into a single bin for solid colors", () => {
    const { red, green, blue, luminance } = channelHistograms(solidColor(10, 10, 200, 100, 50));
    expect(red[200]).toBe(100);
    expect(green[100]).toBe(100);
    expect(blue[50]).toBe(100);
    expect(red.reduce((a, b) => a + b, 0)).toBe(100);
    expect(luminance.reduce((a, b) => a + b, 0)).toBe(100);
    expect(luminance[Math.round(0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50)]).toBe(100);
  });

  it("spreads a full gradient across all bins", () => {
    const { luminance } = channelHistograms(horizontalGradient(256, 2));
    for (let bin = 0; bin < 256; bin += 1) {
      expect(luminance[bin]).toBe(2);
    }
  });
});

describe("percentileValue", () => {
  it("returns the bin where the cumulative count reaches the percentile", () => {
    const histogram = new Uint32Array(256);
    histogram[10] = 50;
    histogram[200] = 50;
    expect(percentileValue(histogram, 100, 0)).toBe(10);
    expect(percentileValue(histogram, 100, 0.5)).toBe(10);
    expect(percentileValue(histogram, 100, 0.51)).toBe(200);
    expect(percentileValue(histogram, 100, 1)).toBe(200);
  });

  it("clamps out-of-range percentiles and empty histograms", () => {
    const histogram = new Uint32Array(256);
    histogram[77] = 4;
    expect(percentileValue(histogram, 4, -1)).toBe(77);
    expect(percentileValue(histogram, 4, 2)).toBe(77);
    expect(percentileValue(new Uint32Array(256), 0, 0.5)).toBe(0);
  });
});

describe("blackWhitePoints", () => {
  it("spans the full range for half-black-half-white", () => {
    expect(blackWhitePoints(halfBlackHalfWhite(100, 10))).toEqual({ black: 0, white: 255 });
  });

  it("collapses to a single value for solid colors", () => {
    expect(blackWhitePoints(solidColor(16, 16, 90, 90, 90))).toEqual({ black: 90, white: 90 });
  });
});

describe("estimateExposureShift", () => {
  it("adds positive exposure to a dark image", () => {
    expect(estimateExposureShift(solidColor(32, 32, 30, 28, 26))).toBeGreaterThan(0);
  });

  it("removes exposure from a bright image", () => {
    expect(estimateExposureShift(solidColor(32, 32, 230, 228, 226))).toBeLessThan(0);
  });

  it("stays at zero for a mid-gray image", () => {
    expect(estimateExposureShift(horizontalGradient(256, 4))).toBe(0);
  });
});

describe("grayWorldGains", () => {
  it("returns neutral gains for gray", () => {
    expect(grayWorldGains(solidColor(8, 8, 128, 128, 128))).toEqual({ red: 1, green: 1, blue: 1 });
  });

  it("attenuates the dominant channel of a cast image", () => {
    const gains = grayWorldGains(solidColor(8, 8, 180, 120, 80));
    expect(gains.red).toBeLessThan(1);
    expect(gains.blue).toBeGreaterThan(1);
    expect(gains.red * 180).toBeCloseTo(gains.blue * 80, 8);
  });
});

describe("meanSaturation", () => {
  it("is zero for gray and rises with colorfulness", () => {
    expect(meanSaturation(solidColor(8, 8, 100, 100, 100))).toBe(0);
    expect(meanSaturation(solidColor(8, 8, 200, 100, 100))).toBeCloseTo(0.5, 10);
  });
});

describe("computeWhiteBalanceAuto", () => {
  it("carries only the white-balance fields", () => {
    expect(Object.keys(computeWhiteBalanceAuto(solidColor(8, 8, 100, 100, 100))).sort()).toEqual(["temperature", "tint"]);
  });

  it("cools a strongly warm cast", () => {
    const patch = computeWhiteBalanceAuto(solidColor(32, 32, 180, 120, 80));
    expect(patch.temperature).toBeLessThan(5500);
  });

  it("pushes tint against a green cast", () => {
    const patch = computeWhiteBalanceAuto(solidColor(32, 32, 100, 180, 100));
    expect(patch.tint).toBeLessThan(0);
  });

  it("stays neutral for a mid-gray image", () => {
    expect(computeWhiteBalanceAuto(horizontalGradient(256, 4))).toEqual({ temperature: 5500, tint: 0 });
  });
});

describe("computeLightnessAuto", () => {
  it("carries only the lightness fields", () => {
    expect(Object.keys(computeLightnessAuto(solidColor(8, 8, 100, 100, 100))).sort()).toEqual(
      ["contrast", "exposure", "highlights", "shadows"],
    );
  });

  it("brightens a dark image", () => {
    const patch = computeLightnessAuto(solidColor(32, 32, 30, 28, 26));
    expect(patch.exposure).toBeGreaterThan(0);
  });

  it("recovers near-clipped whites with negative highlights", () => {
    const patch = computeLightnessAuto(solidColor(32, 32, 255, 252, 250));
    expect(patch.highlights).toBeLessThan(0);
  });

  it("lifts crushed blacks with positive shadows", () => {
    const patch = computeLightnessAuto(solidColor(32, 32, 2, 2, 2));
    expect(patch.shadows).toBeGreaterThan(0);
  });

  it("stays near-neutral for a balanced image", () => {
    expect(computeLightnessAuto(horizontalGradient(256, 4))).toEqual({
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
    });
  });
});

describe("computeColorAuto", () => {
  it("carries only the saturation field", () => {
    expect(Object.keys(computeColorAuto(solidColor(8, 8, 100, 100, 100)))).toEqual(["saturation"]);
  });

  it("boosts muted colors", () => {
    expect(computeColorAuto(solidColor(32, 32, 140, 110, 100)).saturation).toBeGreaterThan(0);
  });

  it("leaves vivid colors alone", () => {
    expect(computeColorAuto(solidColor(32, 32, 220, 40, 40)).saturation).toBe(0);
  });

  it("stays at zero for gray", () => {
    expect(computeColorAuto(solidColor(8, 8, 100, 100, 100))).toEqual({ saturation: 0 });
  });

  it("stays at zero for a mid-gray image", () => {
    expect(computeColorAuto(horizontalGradient(256, 4))).toEqual({ saturation: 0 });
  });
});

describe("computeAutoEnhance", () => {
  it("carries only the five tonal fields, never geometry or retouch state", () => {
    const patch = computeAutoEnhance(solidColor(8, 8, 100, 100, 100));
    expect(Object.keys(patch).sort()).toEqual([...AUTO_ENHANCE_KEYS].sort());
  });

  it("brightens a dark image", () => {
    const patch = computeAutoEnhance(solidColor(32, 32, 30, 28, 26));
    expect(patch.exposure).toBeGreaterThan(0);
  });

  it("cools a strongly warm cast", () => {
    const patch = computeAutoEnhance(solidColor(32, 32, 180, 120, 80));
    expect(patch.temperature).toBeLessThan(5500);
  });

  it("pushes tint against a green cast", () => {
    const patch = computeAutoEnhance(solidColor(32, 32, 100, 180, 100));
    expect(patch.tint).toBeLessThan(0);
  });

  it("stays near-neutral for a mid-gray image", () => {
    expect(computeAutoEnhance(horizontalGradient(256, 4))).toEqual({
      exposure: 0,
      contrast: 0,
      temperature: 5500,
      tint: 0,
      saturation: 0,
    });
  });

  it("matches the recorded golden values for the fixture photo", () => {
    const patch = computeAutoEnhance(goldenPhoto());
    expect(patch.exposure).toBeCloseTo(0.55, 2);
    expect(patch.contrast).toBeGreaterThanOrEqual(14);
    expect(patch.contrast).toBeLessThanOrEqual(16);
    expect(patch.temperature).toBeGreaterThanOrEqual(4750);
    expect(patch.temperature).toBeLessThanOrEqual(4850);
    expect(patch.tint).toBeGreaterThanOrEqual(-1);
    expect(patch.tint).toBeLessThanOrEqual(1);
    expect(patch.saturation).toBeGreaterThanOrEqual(0);
    expect(patch.saturation).toBeLessThanOrEqual(1);
  });
});
