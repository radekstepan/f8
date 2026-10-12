import { describe, expect, it } from "vitest";
import {
  SEMANTIC_CONCEPT_COUNT,
  SEMANTIC_CONCEPT_DIM,
  SEMANTIC_CONCEPT_LABELS,
} from "./semantic-concepts.js";
import {
  SEMANTIC_SEARCH_DIM,
  SEMANTIC_SEARCH_LABEL_BOOST,
  SEMANTIC_SEARCH_LABEL_MIN_PROB,
  SEMANTIC_SEARCH_MAX_RESULTS,
  SEMANTIC_SEARCH_MIN_SCORE,
  SEMANTIC_SEARCH_SIZE,
  assignSemanticLabels,
  conceptIndexForWord,
  conceptsOfQuery,
  cosineSimilarity,
  decodeEmbedding,
  encodeEmbedding,
  normalizeEmbedding,
  normalizeUserLabel,
  packSemanticInput,
  parseSemanticOutput,
  queryEmbedding,
  rankSemanticPhotos,
  semanticConceptMatrix,
  semanticConceptVector,
  semanticHitScore,
  softmax,
  vectorNorm,
} from "./semantic-search.js";
import type { PixelImage } from "./analyze.js";

function solidImage(width: number, height: number, r: number, g: number, b: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe("semantic search", () => {
  it("packs the CLIP 224 grid as normalized NCHW", () => {
    const { data, size } = packSemanticInput(solidImage(640, 480, 255, 0, 0));
    expect(size).toBe(SEMANTIC_SEARCH_SIZE);
    expect(data.length).toBe(3 * SEMANTIC_SEARCH_SIZE * SEMANTIC_SEARCH_SIZE);
    // Solid red: R lane (1-mean)/std, G/B lanes (0-mean)/std.
    expect(data[0]).toBeCloseTo((1 - 0.48145466) / 0.26862954, 4);
    expect(data[SEMANTIC_SEARCH_SIZE * SEMANTIC_SEARCH_SIZE]).toBeCloseTo(
      (0 - 0.4578275) / 0.26130258, 4,
    );
  });

  it("center-crops panoramas instead of stretching them", () => {
    // Left half green, right half blue: the 224 center crop of a 448x224
    // panorama straddles the seam, so the packed grid holds both colors in
    // the middle columns and the R lane stays flat (no red anywhere).
    const data = new Uint8ClampedArray(448 * 224 * 4);
    for (let y = 0; y < 224; y++) {
      for (let x = 0; x < 448; x++) {
        const i = (y * 448 + x) * 4;
        data[i + 1] = x < 224 ? 255 : 0;
        data[i + 2] = x < 224 ? 0 : 255;
        data[i + 3] = 255;
      }
    }
    const packed = packSemanticInput({ width: 448, height: 224, data }).data;
    const plane = SEMANTIC_SEARCH_SIZE * SEMANTIC_SEARCH_SIZE;
    // A stretched resize would smear green across the whole grid; the crop
    // keeps the left edge green and the right edge blue.
    expect(packed[plane + 112 * 224 + 10]).toBeGreaterThan(1);
    expect(packed[plane + 112 * 224 + 213]).toBeLessThan(0);
    expect(packed[2 * plane + 112 * 224 + 10]).toBeLessThan(0);
    expect(packed[2 * plane + 112 * 224 + 213]).toBeGreaterThan(1);
  });

  it("rejects bad image shapes when packing", () => {
    expect(() => packSemanticInput({ width: 0, height: 8, data: new Uint8ClampedArray(0) })).toThrow(RangeError);
  });

  it("parses pooled outputs into unit vectors and rejects misshapes", () => {
    const values = new Array(SEMANTIC_SEARCH_DIM).fill(2);
    const parsed = parseSemanticOutput(values);
    expect(vectorNorm(parsed)).toBeCloseTo(1, 6);
    expect(parsed[0]).toBeCloseTo(2 / Math.hypot(...values), 6);
    expect(() => parseSemanticOutput([1, 2, 3])).toThrow(RangeError);
  });

  it("sanitizes non-finite lanes instead of poisoning the vector", () => {
    const values = new Array(SEMANTIC_SEARCH_DIM).fill(1);
    values[7] = Number.NaN;
    values[9] = Number.POSITIVE_INFINITY;
    const parsed = parseSemanticOutput(values);
    expect(parsed[7]).toBe(0);
    expect(parsed[9]).toBe(0);
    expect(vectorNorm(parsed)).toBeCloseTo(1, 6);
  });

  it("normalizes embeddings and keeps zero vectors zero", () => {
    const unit = normalizeEmbedding([3, 4]);
    expect(unit[0]).toBeCloseTo(0.6, 6);
    expect(unit[1]).toBeCloseTo(0.8, 6);
    expect([...normalizeEmbedding([0, 0, 0])]).toEqual([0, 0, 0]);
  });

  it("measures cosine similarity and rejects dim mismatches", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 9);
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 9);
    expect(() => cosineSimilarity([1, 0], [1])).toThrow(RangeError);
  });

  it("computes a stable softmax", () => {
    const probs = softmax([1000, 1001, 999]);
    expect((probs[0] ?? 0) + (probs[1] ?? 0) + (probs[2] ?? 0)).toBeCloseTo(1, 6);
    expect(probs[1]).toBeGreaterThan(probs[0] ?? 0);
    expect(probs[1]).toBeGreaterThan(probs[2] ?? 0);
    expect([...softmax([])]).toEqual([]);
  });

  it("decodes the embedded concept matrix (unit vectors, known count)", () => {
    const matrix = semanticConceptMatrix();
    expect(matrix.length).toBe(SEMANTIC_CONCEPT_COUNT * SEMANTIC_CONCEPT_DIM);
    expect(SEMANTIC_CONCEPT_COUNT).toBe(SEMANTIC_CONCEPT_LABELS.length);
    for (const index of [0, 7, SEMANTIC_CONCEPT_COUNT - 1]) {
      expect(vectorNorm(semanticConceptVector(index))).toBeCloseTo(1, 4);
    }
    expect(() => semanticConceptVector(-1)).toThrow(RangeError);
    expect(() => semanticConceptVector(SEMANTIC_CONCEPT_COUNT)).toThrow(RangeError);
  });

  it("labels an embedding near a concept with that concept first", () => {
    const beach = SEMANTIC_CONCEPT_LABELS.indexOf("beach");
    expect(beach).toBeGreaterThanOrEqual(0);
    // A photo embedding almost exactly on the beach concept: the zero-shot
    // softmax must concentrate there.
    const vector = semanticConceptVector(beach);
    const noisy = Float32Array.from(vector, (value, i) => value + (i % 2 === 0 ? 0.0001 : -0.0001));
    const labels = assignSemanticLabels(normalizeEmbedding(noisy));
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels[0]?.label).toBe("beach");
    expect(labels[0]?.source).toBe("ml");
    expect(labels[0]?.score).toBeGreaterThan(0.5);
    expect(labels.length).toBeLessThanOrEqual(3);
  });

  it("keeps secondary labels only above the probability floor", () => {
    const mountain = semanticConceptVector(SEMANTIC_CONCEPT_LABELS.indexOf("mountain"));
    const snow = semanticConceptVector(SEMANTIC_CONCEPT_LABELS.indexOf("snow"));
    // Halfway between mountain and snow: both clear the floor, the rest do not.
    const mixed = normalizeEmbedding(Float32Array.from(mountain, (value, i) => value + (snow[i] ?? 0)));
    const labels = assignSemanticLabels(mixed);
    const names = labels.map((entry) => entry.label);
    expect(names).toContain("mountain");
    expect(names).toContain("snow");
    for (const entry of labels.slice(1)) expect(entry.score).toBeGreaterThanOrEqual(SEMANTIC_SEARCH_LABEL_MIN_PROB);
    const scores = labels.map((entry) => entry.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("rejects misshaped embeddings when labeling", () => {
    expect(() => assignSemanticLabels([1, 2, 3])).toThrow(RangeError);
  });

  it("maps query words through labels, aliases, and plurals", () => {
    expect(conceptsOfQuery("beach")).toEqual([{ word: "beach", label: "beach", index: SEMANTIC_CONCEPT_LABELS.indexOf("beach") }]);
    const puppy = conceptsOfQuery("puppy");
    expect(puppy).toHaveLength(1);
    expect(puppy[0]?.label).toBe("dog");
    const plural = conceptsOfQuery("churches");
    expect(plural).toHaveLength(1);
    expect(plural[0]?.label).toBe("church");
    const dogs = conceptsOfQuery("dogs");
    expect(dogs).toHaveLength(1);
    expect(dogs[0]?.label).toBe("dog");
    expect(conceptIndexForWord("xyzzy")).toBeNull();
    expect(conceptIndexForWord("beach")).toBe(SEMANTIC_CONCEPT_LABELS.indexOf("beach"));
    // Unknown words map to nothing (keyword fallback), duplicates collapse.
    expect(conceptsOfQuery("xyzzy")).toEqual([]);
    expect(conceptsOfQuery("dog puppy dogs")).toHaveLength(1);
    expect(conceptsOfQuery("Beach, SUNSET!")).toHaveLength(2);
  });

  it("averages multi-concept queries into one unit vector", () => {
    const single = queryEmbedding(conceptsOfQuery("dog"));
    expect(single).not.toBeNull();
    expect(vectorNorm(single as Float32Array)).toBeCloseTo(1, 6);
    const multi = queryEmbedding(conceptsOfQuery("dog beach"));
    expect(multi).not.toBeNull();
    expect(vectorNorm(multi as Float32Array)).toBeCloseTo(1, 6);
    // The average sits between its concepts, closer to neither pole exactly.
    const dog = semanticConceptVector(SEMANTIC_CONCEPT_LABELS.indexOf("dog"));
    expect(cosineSimilarity(multi as Float32Array, dog)).toBeGreaterThan(0.5);
    expect(cosineSimilarity(multi as Float32Array, dog)).toBeLessThan(1);
    expect(queryEmbedding([])).toBeNull();
  });

  // Mock photo embeddings with an exact cosine to the query: concept
  // vectors cannot stand in for photos (text-text similarities live in a
  // tighter cone than the image-text floors calibrated on real photos).
  function mockPhoto(query: Float32Array, cosine: number, seed: number): Float32Array {
    const random = new Float32Array(query.length);
    let state = seed;
    for (let i = 0; i < random.length; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      random[i] = state / 0x7fffffff - 0.5;
    }
    let dot = 0;
    for (let i = 0; i < query.length; i++) dot += (random[i] ?? 0) * (query[i] ?? 0);
    const ortho = normalizeEmbedding(Float32Array.from(random, (value, i) => value - dot * (query[i] ?? 0)));
    return normalizeEmbedding(Float32Array.from(query, (value, i) => value * cosine + (ortho[i] ?? 0) * Math.sqrt(1 - cosine * cosine)));
  }

  it("ranks mocked photo embeddings by cosine with a score floor", () => {
    const concepts = conceptsOfQuery("clock");
    const query = queryEmbedding(concepts) as Float32Array;
    const ranked = rankSemanticPhotos(query, concepts, [
      { id: "far", embedding: mockPhoto(query, 0.1, 7), labels: [] },
      { id: "missing", embedding: null, labels: [] },
      { id: "near", embedding: mockPhoto(query, 0.9, 11), labels: ["clock"] },
    ]);
    // The far photo scores below the floor; the missing one has no signal.
    expect(ranked.map((entry) => entry.photoId)).toEqual(["near"]);
    expect(ranked[0]?.score).toBeGreaterThan(SEMANTIC_SEARCH_MIN_SCORE);
    expect(ranked[0]?.score).toBeCloseTo(0.9, 4);
    expect(ranked[0]?.labelMatch).toBe(true);
  });

  it("boosts label matches above the floor and caps the results", () => {
    const concepts = conceptsOfQuery("dog");
    const query = queryEmbedding(concepts) as Float32Array;
    // A hand-labeled photo with a just-under cosine still matches via labels.
    const ranked = rankSemanticPhotos(query, concepts, [
      { id: "hand", embedding: mockPhoto(query, 0.2, 13), labels: ["Dog"] },
      { id: "none", embedding: mockPhoto(query, 0.2, 17), labels: ["beach"] },
    ]);
    expect(ranked.map((entry) => entry.photoId)).toEqual(["hand"]);
    expect(ranked[0]?.labelMatch).toBe(true);
    const many = Array.from({ length: SEMANTIC_SEARCH_MAX_RESULTS + 10 }, (_, i) => ({
      id: `p${i}`,
      embedding: query,
      labels: [] as string[],
    }));
    expect(rankSemanticPhotos(query, concepts, many)).toHaveLength(SEMANTIC_SEARCH_MAX_RESULTS);
  });

  it("applies the hit truth table (strong, support, label, miss)", () => {
    // Strong cosines hit on their own.
    expect(semanticHitScore({ cosine: 0.3, prob: 0, labelMatch: false })).toBe(0.3);
    // Weaker cosines need zero-shot support...
    expect(semanticHitScore({ cosine: 0.25, prob: 0.13, labelMatch: false })).toBe(0.25);
    // ...and miss without it (the hub false-positive: 0.25 cosine, flat 0.06).
    expect(semanticHitScore({ cosine: 0.251, prob: 0.055, labelMatch: false })).toBeNull();
    expect(semanticHitScore({ cosine: 0.2, prob: 0.9, labelMatch: false })).toBeNull();
    // Label matches always hit, boosted to the label floor.
    expect(semanticHitScore({ cosine: 0.1, prob: 0, labelMatch: true })).toBe(SEMANTIC_SEARCH_LABEL_BOOST);
    expect(semanticHitScore({ cosine: -1, prob: 0, labelMatch: true })).toBe(SEMANTIC_SEARCH_LABEL_BOOST);
  });

  // Real CLIP embeddings from the dev library (float32 LE base64, the
  // catalog wire format): a weak-but-supported flower photo and the
  // out-of-vocabulary bedroom hub. See docs/tasks/14-semantic-search-ml.md.
  const FLOWER_WEAK_B64 = '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'; // DSC06318: flower cos 0.256, p 0.127
  const BEDROOM_HUB_B64 = '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'; // DSC06393: dog cos 0.251, p 0.055
  it("keeps supported weak hits and drops hubs end to end", () => {
    const flowerWeak = decodeEmbedding(FLOWER_WEAK_B64) as Float32Array;
    const bedroomHub = decodeEmbedding(BEDROOM_HUB_B64) as Float32Array;
    const concepts = conceptsOfQuery("flower");
    const query = queryEmbedding(concepts) as Float32Array;
    // The weak flower photo lands through zero-shot support (0.256 cosine,
    // 0.127 probability); the hub's flat 0.245 scores nothing.
    const ranked = rankSemanticPhotos(query, concepts, [
      { id: "flower-weak", embedding: flowerWeak, labels: [] },
      { id: "bedroom", embedding: bedroomHub, labels: [] },
    ]);
    expect(ranked.map((entry) => entry.photoId)).toEqual(["flower-weak"]);
    // Same story for the hub's own best concept: dog scores 0.251 with a
    // flat 0.055, so the bedroom matches nothing semantic.
    const dogConcepts = conceptsOfQuery("dog");
    const dogQuery = queryEmbedding(dogConcepts) as Float32Array;
    expect(
      rankSemanticPhotos(dogQuery, dogConcepts, [{ id: "bedroom", embedding: bedroomHub, labels: [] }]),
    ).toEqual([]);
  });

  it("round-trips embeddings through the catalog format", () => {
    const vector = semanticConceptVector(0);
    const decoded = decodeEmbedding(encodeEmbedding(vector));
    expect(decoded).not.toBeNull();
    expect(decoded?.length).toBe(SEMANTIC_SEARCH_DIM);
    for (let i = 0; i < SEMANTIC_SEARCH_DIM; i += 61) {
      expect(decoded?.[i]).toBeCloseTo(vector[i] ?? 0, 6);
    }
    expect(() => encodeEmbedding([1, 2])).toThrow(RangeError);
    expect(decodeEmbedding("not-base64!!")).toBeNull();
    expect(decodeEmbedding(Buffer.from([1, 2, 3]).toString("base64"))).toBeNull();
  });

  it("validates user labels", () => {
    expect(normalizeUserLabel("  Golden Gate ")).toBe("golden gate");
    expect(normalizeUserLabel("a".repeat(33))).toBeNull();
    expect(normalizeUserLabel("")).toBeNull();
    expect(normalizeUserLabel("beach!")).toBeNull();
    expect(normalizeUserLabel("-beach")).toBeNull();
  });
});
