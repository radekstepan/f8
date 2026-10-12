import { describe, expect, it } from "vitest";
import {
  CULL_BLUR_THRESHOLD,
  CULL_DUPLICATE_HAMMING,
  aestheticFeatures,
  aestheticScore,
  assignCullLabels,
  assessPixels,
  blurConfidence,
  blurScore,
  grayLuma,
  groupNearDuplicates,
  hammingDistance,
  isBlurryScore,
  laplacianVariance,
  lumaStats,
  parsePhashHex,
  perceptualHash,
  phashToHex,
  pickGroupBest,
} from "./cull-assist.js";
import type { PixelImage } from "./analyze.js";

function makeImage(width: number, height: number, fill: (x: number, y: number) => number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const flat = (width: number, height: number, value: number): PixelImage => makeImage(width, height, () => value);

/** Sharp 2px-cell checkerboard: every interior pixel touches an edge. */
const checkerboard = (width = 16, height = 16): PixelImage =>
  makeImage(width, height, (x, y) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? 0 : 255));

/** 3x3 box blur of a grayscale image (a stand-in for defocus). */
function boxBlur(image: PixelImage): PixelImage {
  return makeImage(image.width, image.height, (x, y) => {
    let sum = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = Math.min(image.width - 1, Math.max(0, x + dx));
        const sy = Math.min(image.height - 1, Math.max(0, y + dy));
        sum += image.data[(sy * image.width + sx) * 4] ?? 0;
        count++;
      }
    }
    return sum / count;
  });
}

/** Smooth low-frequency scene (a stand-in for natural photo content). */
const scene = (width = 64, height = 48, shift = 0): PixelImage =>
  makeImage(width, height, (x, y) => {
    const sx = x + shift;
    const gradient = (sx / width) * 90 + (y / height) * 50;
    const blob = 70 * Math.exp(-(((sx - width * 0.62) ** 2 + (y - height * 0.4) ** 2) / (2 * (width / 7) ** 2)));
    return 40 + gradient + blob;
  });

describe("cull assist blur detection", () => {
  it("scores a flat frame 0 and a sharp checkerboard far above the threshold", () => {
    expect(blurScore(flat(16, 16, 128))).toBe(0);
    const sharp = blurScore(checkerboard());
    expect(sharp).toBeGreaterThan(CULL_BLUR_THRESHOLD * 10);
    expect(isBlurryScore(sharp)).toBe(false);
    expect(isBlurryScore(0)).toBe(true);
  });

  it("scores a blurred checkerboard below its sharp source", () => {
    const sharp = blurScore(checkerboard());
    const blurred = blurScore(boxBlur(checkerboard()));
    expect(blurred).toBeGreaterThan(0);
    expect(blurred).toBeLessThan(sharp / 4);
  });

  it("classifies at the threshold boundary", () => {
    expect(isBlurryScore(CULL_BLUR_THRESHOLD - 0.001)).toBe(true);
    expect(isBlurryScore(CULL_BLUR_THRESHOLD)).toBe(false);
    expect(isBlurryScore(Number.NaN)).toBe(false);
  });

  it("scores degenerate sizes 0 and rejects misshaped buffers", () => {
    expect(laplacianVariance(new Float32Array(4), 2, 2)).toBe(0);
    expect(() => laplacianVariance(new Float32Array(3), 2, 2)).toThrow(RangeError);
    expect(() => laplacianVariance(new Float32Array(4), 0, 2)).toThrow(RangeError);
  });

  it("fades blurry confidence toward the threshold", () => {
    expect(blurConfidence(0)).toBe(1);
    expect(blurConfidence(CULL_BLUR_THRESHOLD / 2)).toBeCloseTo(0.5, 9);
    expect(blurConfidence(CULL_BLUR_THRESHOLD)).toBe(0);
    expect(blurConfidence(CULL_BLUR_THRESHOLD * 3)).toBe(0);
    expect(blurConfidence(Number.NaN)).toBe(0);
  });
});

describe("cull assist quality ranker", () => {
  it("reads luma mean and spread", () => {
    expect(lumaStats(grayLuma(flat(8, 8, 100)))).toEqual({ mean: 100, std: 0 });
    const half = lumaStats(grayLuma(makeImage(4, 2, (x) => (x < 2 ? 0 : 255))));
    expect(half.mean).toBeCloseTo(127.5, 9);
    expect(half.std).toBeCloseTo(127.5, 9);
  });

  it("normalizes aesthetic features to 0..1", () => {
    expect(aestheticFeatures(3 * CULL_BLUR_THRESHOLD, { mean: 128, std: 55 })).toEqual({ sharp: 1, exposure: 1, contrast: 1 });
    expect(aestheticFeatures(0, { mean: 0, std: 0 })).toEqual({ sharp: 0, exposure: 0, contrast: 0 });
    expect(aestheticFeatures(CULL_BLUR_THRESHOLD, { mean: 128, std: 0 }).sharp).toBeCloseTo(1 / 3, 9);
  });

  it("ranks a perfect frame above a mediocre one above a poor one", () => {
    const perfect = aestheticScore({ sharp: 1, exposure: 1, contrast: 1 });
    expect(perfect).toBeCloseTo(1 / (1 + Math.exp(-2.3)), 9);
    expect(perfect).toBeGreaterThan(0.5);
    const mid = aestheticScore({ sharp: 0.5, exposure: 0.7, contrast: 0.5 });
    const poor = aestheticScore({ sharp: 0.1, exposure: 0.3, contrast: 0.2 });
    expect(mid).toBeLessThan(perfect);
    expect(poor).toBeLessThan(mid);
    expect(poor).toBeLessThan(0.5);
  });
});

describe("cull assist perceptual hash", () => {
  it("hashes identical images equally with a hex round-trip", () => {
    const a = perceptualHash(scene());
    expect(perceptualHash(scene())).toBe(a);
    const hex = phashToHex(a);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
    expect(parsePhashHex(hex)).toBe(a);
    expect(parsePhashHex(hex.toUpperCase())).toBe(a);
  });

  it("rejects malformed hashes", () => {
    for (const bad of ["", "abc", "0".repeat(15), "0".repeat(17), "z".repeat(16), "0x1234567890abcdef"]) {
      expect(() => parsePhashHex(bad)).toThrow(RangeError);
    }
    expect(() => phashToHex(-1n)).toThrow(RangeError);
    expect(() => phashToHex(1n << 64n)).toThrow(RangeError);
  });

  it("counts differing bits", () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
    expect(hammingDistance(0n, 0xffn)).toBe(8);
    expect(hammingDistance(0n, (1n << 64n) - 1n)).toBe(64);
    expect(hammingDistance(0b1010n, 0b1001n)).toBe(2);
    expect(() => hammingDistance(-1n, 0n)).toThrow(RangeError);
  });

  it("hashes a shifted scene closer than an unrelated frame", () => {
    const base = perceptualHash(scene());
    const shifted = hammingDistance(base, perceptualHash(scene(64, 48, 2)));
    const unrelated = hammingDistance(base, perceptualHash(checkerboard(64, 48)));
    expect(shifted).toBeLessThanOrEqual(CULL_DUPLICATE_HAMMING);
    expect(unrelated).toBeGreaterThan(CULL_DUPLICATE_HAMMING);
    expect(shifted).toBeLessThan(unrelated);
  });

  it("groups near-duplicates transitively and deterministically", () => {
    // A~B at 4 bits, B~C at 4 bits, A~C at 8: one transitive group.
    const a = "0000000000000000";
    const b = "000000000000000f";
    const c = "00000000000000ff";
    expect(hammingDistance(parsePhashHex(a), parsePhashHex(c))).toBe(8);
    const groups = groupNearDuplicates(
      [
        { id: "c", phash: c },
        { id: "solo", phash: "ffffffffffffffff" },
        { id: "a", phash: a },
        { id: "b", phash: b },
      ],
      5,
    );
    expect(groups).toEqual([["a", "b", "c"]]);
  });

  it("accepts bigint hashes, skips singletons, and validates the radius", () => {
    expect(groupNearDuplicates([])).toEqual([]);
    expect(groupNearDuplicates([{ id: "a", phash: 0n }])).toEqual([]);
    expect(groupNearDuplicates([{ id: "a", phash: 0n }, { id: "b", phash: 0b11111n }])).toEqual([["a", "b"]]);
    expect(() => groupNearDuplicates([], -1)).toThrow(RangeError);
  });

  it("picks the group best by aesthetic, then sharpness, then id", () => {
    const members = [
      { id: "b", aesthetic: 0.7, blur: 500 },
      { id: "a", aesthetic: 0.7, blur: 400 },
      { id: "c", aesthetic: 0.9, blur: 10 },
    ];
    expect(pickGroupBest(members)).toBe("c");
    expect(pickGroupBest(members.slice(0, 2))).toBe("b");
    expect(pickGroupBest([
      { id: "b", aesthetic: 0.7, blur: 400 },
      { id: "a", aesthetic: 0.7, blur: 400 },
    ])).toBe("a");
    expect(() => pickGroupBest([])).toThrow(RangeError);
  });
});

describe("cull assist label planning", () => {
  const sharpPretty = { blur: 500, phash: "0000000000000000", aesthetic: 0.9 };
  const sharpPretty2 = { blur: 400, phash: "0000000000000000", aesthetic: 0.8 };
  const mediocre = { blur: 300, phash: "ffffffffffffffff", aesthetic: 0.4 };
  const soft = { blur: 10, phash: "000000000000ffff", aesthetic: 0.3 };

  it("flags a blurry solo photo and nothing else", () => {
    const labels = assignCullLabels([{ id: "a", metrics: soft }]);
    expect([...labels.keys()]).toEqual(["a"]);
    expect(labels.get("a")).toEqual([{ label: "blurry", score: blurConfidence(10), source: "ml" }]);
  });

  it("leaves a sharp pretty solo photo unflagged — no positive state", () => {
    const labels = assignCullLabels([{ id: "a", metrics: sharpPretty }]);
    expect(labels.size).toBe(0);
  });

  it("leaves a mediocre solo photo unflagged", () => {
    expect(assignCullLabels([{ id: "a", metrics: mediocre }]).size).toBe(0);
  });

  it("spares the group best and flags the rest as duplicates", () => {
    const labels = assignCullLabels([
      { id: "a", metrics: sharpPretty },
      { id: "b", metrics: sharpPretty2 },
    ]);
    expect(labels.get("a")).toBeUndefined();
    expect(labels.get("b")).toEqual([{ label: "duplicate", score: 1, source: "ml" }]);
  });

  it("flags a blurry non-best group member blurry and duplicate", () => {
    const labels = assignCullLabels([
      { id: "a", metrics: sharpPretty },
      // Same hash (grouped), soft blur, lower aesthetic: not the best.
      { id: "b", metrics: { blur: 10, phash: "0000000000000000", aesthetic: 0.3 } },
    ]);
    expect(labels.get("a")).toBeUndefined();
    expect(labels.get("b")).toEqual([
      { label: "blurry", score: blurConfidence(10), source: "ml" },
      { label: "duplicate", score: 1, source: "ml" },
    ]);
  });

  it("flags a blurry group best blurry only — never duplicate", () => {
    const labels = assignCullLabels([
      { id: "a", metrics: { blur: 10, phash: "1111111111111111", aesthetic: 0.9 } },
      { id: "b", metrics: { blur: 5, phash: "1111111111111111", aesthetic: 0.3 } },
    ]);
    // Best by aesthetic, but blurry: only the blurry flag fires.
    expect(labels.get("a")).toEqual([{ label: "blurry", score: blurConfidence(10), source: "ml" }]);
    expect(labels.get("b")?.map((entry) => entry.label).sort()).toEqual(["blurry", "duplicate"]);
  });

  it("never emits a keeper label over a mixed batch", () => {
    const labels = assignCullLabels([
      { id: "sharp-solo", metrics: sharpPretty },
      { id: "group-best", metrics: sharpPretty2 },
      { id: "group-dup", metrics: { blur: 450, phash: "0000000000000000", aesthetic: 0.7 } },
      { id: "soft", metrics: soft },
    ]);
    const emitted = [...labels.values()].flat().map((entry) => entry.label);
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted).not.toContain("keeper");
    expect(new Set(emitted)).toEqual(new Set(["blurry", "duplicate"]));
  });
});

describe("cull assist full assessment", () => {
  it("assesses a sharp frame as sharp and a flat frame as blurry", () => {
    const sharp = assessPixels(checkerboard());
    expect(sharp.blurry).toBe(false);
    expect(sharp.phash).toBe(phashToHex(perceptualHash(checkerboard())));
    const flatResult = assessPixels(flat(16, 16, 128));
    expect(flatResult).toEqual({ blur: 0, blurry: true, phash: flatResult.phash, aesthetic: flatResult.aesthetic });
    expect(sharp.aesthetic).toBeGreaterThan(flatResult.aesthetic);
    expect(flatResult.phash).toMatch(/^[0-9a-f]{16}$/);
  });
});
