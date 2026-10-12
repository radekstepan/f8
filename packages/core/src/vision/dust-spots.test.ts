// Dust-spots contract: classical blobs → ML filter → repair strokes/masks.

import { describe, expect, it } from "vitest";
import {
  DUST_SPOTS_CLASSIC_SCORE,
  DUST_SPOTS_CLASSIFIER_WEIGHTS,
  filterSpotsWithClassifier,
  parseDustSpotsWeights,
  proposeDustCandidates,
  scoreSpotFeatures,
  spotsToRepairMask,
  spotsToRepairPoints,
  type DustSpot,
  type DustSpotFeatures,
} from "./dust-spots.js";
import { rasterizeRepairMask } from "./inpaint.js";
import { planMlHealRoi } from "./ml-heal.js";
import type { PixelImage } from "./analyze.js";

function solidImage(width: number, height: number, r: number, g: number, b: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Paint a filled disc of flat color into the image. */
function paintDisc(image: PixelImage, cx: number, cy: number, radius: number, r: number, g: number, b: number): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * image.width + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
      }
    }
  }
}

function skyWithDust(): PixelImage {
  const image = solidImage(160, 120, 150, 190, 230);
  paintDisc(image, 40, 30, 4, 60, 70, 80);
  paintDisc(image, 120, 90, 3, 70, 80, 90);
  return image;
}

describe("proposeDustCandidates", () => {
  it("finds dark blobs on a bright background", () => {
    const spots = proposeDustCandidates(skyWithDust());
    expect(spots).toHaveLength(2);
    expect(spots[0]?.polarity).toBe("dark");
    expect(spots[0]?.score).toBe(DUST_SPOTS_CLASSIC_SCORE);
    // Near the painted discs (40,30) and (120,90) in normalized coords.
    const near = (x: number, y: number): boolean =>
      spots.some((spot) => Math.abs(spot.x - x) < 0.03 && Math.abs(spot.y - y) < 0.04);
    expect(near(40 / 160, 30 / 120)).toBe(true);
    expect(near(120 / 160, 90 / 120)).toBe(true);
  });

  it("finds bright specks on a dark background", () => {
    const image = solidImage(120, 100, 20, 24, 30);
    paintDisc(image, 60, 50, 3, 220, 220, 220);
    const spots = proposeDustCandidates(image);
    expect(spots).toHaveLength(1);
    expect(spots[0]?.polarity).toBe("bright");
    expect(spots[0]?.x).toBeCloseTo(0.5, 1);
    expect(spots[0]?.y).toBeCloseTo(0.5, 1);
  });

  it("ignores large regions and clean gradients", () => {
    // Half-dark / half-bright split: content, not dust.
    const image = solidImage(160, 120, 150, 190, 230);
    for (let y = 60; y < 120; y += 1) {
      for (let x = 0; x < 160; x += 1) {
        const i = (y * 160 + x) * 4;
        image.data[i] = 40;
        image.data[i + 1] = 50;
        image.data[i + 2] = 60;
      }
    }
    expect(proposeDustCandidates(image)).toEqual([]);
    expect(proposeDustCandidates(solidImage(64, 64, 128, 128, 128))).toEqual([]);
  });

  it("rejects thin scratches via the aspect gate", () => {
    const image = solidImage(160, 120, 150, 190, 230);
    for (let x = 10; x < 150; x += 1) {
      const i = (60 * 160 + x) * 4;
      image.data[i] = 40;
      image.data[i + 1] = 50;
      image.data[i + 2] = 60;
    }
    expect(proposeDustCandidates(image)).toEqual([]);
  });
});

describe("scoreSpotFeatures + filterSpotsWithClassifier", () => {
  const strongSpot: DustSpotFeatures = { contrast: 0.5, size: 0.01, circularity: 0.9, border: 0 };
  const faintSpeckle: DustSpotFeatures = { contrast: 0.05, size: 0.001, circularity: 0.4, border: 0.9 };

  it("scores plausible dust high and border speckle low", () => {
    expect(scoreSpotFeatures(strongSpot)).toBeGreaterThan(0.8);
    expect(scoreSpotFeatures(faintSpeckle)).toBeLessThan(0.3);
  });

  it("keeps strong spots and drops likely false positives", () => {
    const candidates = [
      { x: 0.2, y: 0.2, radius: 0.01, score: DUST_SPOTS_CLASSIC_SCORE, polarity: "dark" as const, features: strongSpot },
      { x: 0.9, y: 0.9, radius: 0.01, score: DUST_SPOTS_CLASSIC_SCORE, polarity: "dark" as const, features: faintSpeckle },
    ];
    const kept = filterSpotsWithClassifier(candidates);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.x).toBe(0.2);
    expect(kept[0]?.score).toBeGreaterThan(0.5);
  });

  it("accepts the full classical → ML pipeline on a dusty photo", () => {
    const spots = filterSpotsWithClassifier(proposeDustCandidates(skyWithDust()));
    expect(spots).toHaveLength(2);
    expect(spots[0]?.score).toBeGreaterThanOrEqual(spots[1]?.score ?? 0);
  });

  it("honors custom weights", () => {
    const candidates = [
      { x: 0.2, y: 0.2, radius: 0.01, score: DUST_SPOTS_CLASSIC_SCORE, polarity: "dark" as const, features: strongSpot },
    ];
    // A prohibitive bias drops everything, whatever the features.
    expect(filterSpotsWithClassifier(candidates, { weights: { ...DUST_SPOTS_CLASSIFIER_WEIGHTS, bias: -100 } })).toEqual([]);
  });
});

describe("parseDustSpotsWeights", () => {
  it("accepts a complete coefficient set", () => {
    expect(parseDustSpotsWeights({ bias: -1, contrast: 5, size: -2, circularity: 2, border: -2, version: "custom" })).toEqual({
      bias: -1,
      contrast: 5,
      size: -2,
      circularity: 2,
      border: -2,
    });
  });

  it("rejects malformed documents", () => {
    expect(() => parseDustSpotsWeights(null)).toThrow(RangeError);
    expect(() => parseDustSpotsWeights({})).toThrow(RangeError);
    expect(() => parseDustSpotsWeights({ bias: 0, contrast: 0, size: 0, circularity: 0, border: Number.NaN })).toThrow(RangeError);
  });
});

describe("spotsToRepairPoints", () => {
  const spots: DustSpot[] = [
    { x: 0.25, y: 0.25, radius: 0.01, score: 0.9, polarity: "dark" },
    { x: 0.75, y: 0.75, radius: 0.02, score: 0.8, polarity: "bright" },
  ];

  it("emits one disc per spot with separable stroke ids", () => {
    const points = spotsToRepairPoints(spots, { stroke: 4 });
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ x: 0.25, y: 0.25, kind: "repair", strength: 100, stroke: 4 });
    expect(points[1]?.stroke).toBe(5);
    // Discs grow past the fitted radius to cover soft fringes.
    expect(points[0]?.size).toBeGreaterThan(2 * 0.01);
    expect(points[1]?.size).toBeGreaterThan(points[0]?.size ?? 0);
  });

  it("skips degenerate spots", () => {
    expect(spotsToRepairPoints([{ x: 2, y: 0.5, radius: 0.01, score: 0.9, polarity: "dark" }])).toEqual([]);
    expect(spotsToRepairPoints([{ x: 0.5, y: 0.5, radius: 0, score: 0.9, polarity: "dark" }])).toEqual([]);
  });

  it("feeds the existing heal stack (mask → ROI plan)", () => {
    const points = spotsToRepairPoints(spots);
    const mask = rasterizeRepairMask(points, 200, 100);
    expect(mask.data.some((value) => value > 0)).toBe(true);
    const roi = planMlHealRoi(mask);
    expect(roi?.size).toBeGreaterThan(0);
  });
});

describe("spotsToRepairMask", () => {
  it("fills spot discs and nothing else", () => {
    const mask = spotsToRepairMask([{ x: 0.5, y: 0.5, radius: 0.05, score: 0.9, polarity: "dark" }], 100, 100);
    expect(mask.data[50 * 100 + 50]).toBe(255);
    expect(mask.data[0]).toBe(0);
    expect(mask.data[99 * 100 + 99]).toBe(0);
  });

  it("rejects bad dimensions", () => {
    expect(() => spotsToRepairMask([], 0, 10)).toThrow(RangeError);
  });
});
