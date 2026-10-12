// Local semantic search / smart albums: pure, dependency-free CLIP helpers
// shared by the photo server and the web client.
//
// CLIP-image embeddings (ViT-B/32, 512-d) are computed server-side at import
// and stored in the SQLite catalog; a text query ("beach", "dog") maps onto
// the same space through precomputed concept vectors (see
// semantic-concepts.ts), so search ranks photos by cosine similarity with no
// cloud involved. This module holds the deterministic pieces:
//
// - packSemanticInput: CLIP preprocessing (shortest edge -> 224, center-crop
//   224, /255, CLIP mean/std) into float32 NCHW for the vision ONNX export.
// - parseSemanticOutput: raw image_embeds output -> L2-normalized 512-d unit
//   vector (RangeError on misshape, so a wrong model fails loudly).
// - assignSemanticLabels: zero-shot softmax over the vocabulary -> up to 3
//   stored labels per photo (drives keyword search + label chips).
// - conceptsOfQuery / rankSemanticPhotos: text query -> ranked photo ids.
// - encodeEmbedding / decodeEmbedding: the catalog wire format (base64
//   little-endian float32, 2KB per photo).
//
// The runtime ships the vision encoder only (~89MB quantized ONNX, lazily
// downloaded once). Text never runs through a model at query time: the
// vocabulary's concept vectors were embedded once at build time with the
// matching text encoder, so a query only needs keyword->concept mapping
// (exact + aliases + plural folding). Open-vocabulary queries fall back to
// substring matching over labels and metadata — still local, never cloud.
//
// Inputs are never mutated. Pure functions throughout: safe in Node tests,
// workers, and UI.

import type { PhotoLabel } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";
import {
  SEMANTIC_CONCEPT_COUNT,
  SEMANTIC_CONCEPT_DIM,
  SEMANTIC_CONCEPT_LABELS,
  SEMANTIC_CONCEPT_VECTORS_B64,
} from "./semantic-concepts.js";

/** CLIP ViT-B/32 image grid (the Xenova ONNX export runs at 224x224). */
export const SEMANTIC_SEARCH_SIZE = 224;
/** CLIP ViT-B/32 joint embedding dimension. */
export const SEMANTIC_SEARCH_DIM = 512;
/** Model identity stamped on every stored embedding (re-embed on change). */
export const SEMANTIC_SEARCH_MODEL_ID = "clip-vit-base-patch32";
export const SEMANTIC_SEARCH_MODEL_VERSION = "v1-quantized";
/** Single-file quantized vision ONNX weights, lazily downloaded once. */
export const SEMANTIC_SEARCH_FILE = "vision_model_quantized.onnx";
/** Exact download size in bytes (measured from the HF asset). */
export const SEMANTIC_SEARCH_FILE_SIZE = 89_117_001;
/**
 * Default weights: CLIP ViT-B/32 vision encoder, ONNX-quantized port by
 * Xenova (transformers.js). Overridable at runtime — the server reads the
 * pooled output dynamically and accepts any 512-d image_embeds output.
 */
export const SEMANTIC_SEARCH_DEFAULT_URL =
  "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx";
/**
 * License of the default weights. OpenAI's CLIP release ships no separate
 * weights license file (the code is MIT); the ONNX port is a Xenova
 * conversion of those weights. Operators see this in /health.
 */
export const SEMANTIC_SEARCH_LICENSE = "OpenAI CLIP weights (no separate license file; code MIT), ONNX port by Xenova";
/** Override env for the weight URL (mirrors F8_SELECTIVE_MASK_*). */
export const SEMANTIC_SEARCH_URL_ENV = "F8_SEMANTIC_SEARCH_URL";
export const SEMANTIC_SEARCH_DIR_ENV = "F8_SEMANTIC_SEARCH_DIR";
/** Set to "1" to disable weight downloads (imports skip embedding; labeling reports it honestly). */
export const SEMANTIC_SEARCH_OFFLINE_ENV = "F8_SEMANTIC_SEARCH_OFFLINE";
/** CLIP image normalization (preprocessor_config.json of the source model). */
export const SEMANTIC_SEARCH_NORM_MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
export const SEMANTIC_SEARCH_NORM_STD = [0.26862954, 0.26130258, 0.27577711] as const;
/** Zero-shot logit scale (CLIP's learned temperature, ~100). */
export const SEMANTIC_SEARCH_LOGIT_SCALE = 100;
/** Stored labels per photo (top-k of the zero-shot softmax). */
export const SEMANTIC_SEARCH_LABEL_TOP_K = 3;
/** Minimum softmax probability for the top label (skips pathological flats). */
export const SEMANTIC_SEARCH_LABEL_MIN_TOP = 0.1;
/** Minimum softmax probability for 2nd/3rd labels. */
export const SEMANTIC_SEARCH_LABEL_MIN_PROB = 0.12;
/**
 * Strong cosine similarity: a semantic search hit on its own. Calibrated on
 * library photos: true subjects score 0.26–0.31 here.
 */
export const SEMANTIC_SEARCH_MIN_SCORE = 0.26;
/**
 * Support cosine: below the strong floor, a hit needs the concept to also
 * stand out in the photo's zero-shot distribution (the support probability).
 * Out-of-vocabulary scenes (a bedroom interior) otherwise match a dozen
 * concepts weakly at 0.24–0.255 — the hubness false-positive the support
 * rule exists to kill. True-but-weak subjects (small flowers at 0.256 with
 * probability 0.13) still land through it.
 */
export const SEMANTIC_SEARCH_SUPPORT_COSINE = 0.22;
/** Minimum zero-shot probability for a support hit (hub tops sit ~0.09). */
export const SEMANTIC_SEARCH_SUPPORT_PROB = 0.1;
/**
 * Label matches (query word equals a stored label) join the results ranked
 * at least here, so hand-added labels are always findable even when the
 * embedding cosine sits just under the threshold.
 */
export const SEMANTIC_SEARCH_LABEL_BOOST = 0.245;
/** Cap on ranked results per query. */
export const SEMANTIC_SEARCH_MAX_RESULTS = 50;

export const SEMANTIC_CONCEPT_LABEL_COUNT = SEMANTIC_CONCEPT_COUNT;
export const SEMANTIC_CONCEPT_VOCAB: readonly string[] = SEMANTIC_CONCEPT_LABELS;

/**
 * Query aliases onto the vocabulary: synonyms, plurals, and near-misses that
 * users type. Keys and values are lowercase; the lookup folds plurals too,
 * so only irregular forms need entries here.
 */
export const SEMANTIC_SEARCH_ALIASES: Record<string, string> = {
  puppy: "dog",
  puppies: "dog",
  doggy: "dog",
  kitten: "cat",
  kitty: "cat",
  sea: "ocean",
  seaside: "beach",
  shore: "beach",
  coast: "beach",
  peak: "mountain",
  peaks: "mountain",
  alps: "mountain",
  woods: "forest",
  woodland: "forest",
  lakehouse: "lake",
  creek: "river",
  stream: "river",
  falls: "waterfall",
  dune: "desert",
  dunes: "desert",
  snowfall: "snow",
  winter: "snow",
  sunrise: "sunset",
  dusk: "sunset",
  dawn: "sunset",
  golden: "sunset",
  nighttime: "night",
  evening: "night",
  blossom: "flower",
  blossoms: "flower",
  bloom: "flower",
  blooms: "flower",
  bouquet: "flower",
  roses: "flower",
  tulip: "flower",
  trees: "tree",
  pine: "tree",
  botanical: "garden",
  downtown: "city",
  skyline: "city",
  urban: "city",
  town: "city",
  village: "city",
  road: "street",
  avenue: "street",
  architecture: "building",
  tower: "building",
  cathedral: "church",
  chapel: "church",
  temple: "church",
  mosque: "church",
  monastery: "church",
  bazaar: "market",
  gallery: "museum",
  portraiture: "portrait",
  headshot: "portrait",
  selfie: "portrait",
  people: "group",
  family: "group",
  friends: "group",
  crowd: "group",
  kid: "baby",
  kids: "baby",
  child: "baby",
  children: "baby",
  toddler: "baby",
  newborn: "baby",
  bride: "wedding",
  groom: "wedding",
  marriage: "wedding",
  gig: "concert",
  festival: "concert",
  music: "concert",
  birdwatching: "bird",
  seagull: "bird",
  eagle: "bird",
  owl: "bird",
  pony: "horse",
  automobile: "car",
  vehicle: "car",
  taxi: "car",
  bike: "bicycle",
  cycling: "bicycle",
  motorbike: "motorcycle",
  plane: "airplane",
  jet: "airplane",
  aircraft: "airplane",
  flight: "airplane",
  airport: "airplane",
  sailboat: "boat",
  ship: "boat",
  ferry: "boat",
  kayak: "boat",
  canoe: "boat",
  yacht: "boat",
  railway: "train",
  metro: "train",
  subway: "train",
  tram: "train",
  dinner: "food",
  lunch: "food",
  breakfast: "food",
  meal: "food",
  restaurant: "food",
  dessert: "food",
  cake: "food",
  pizza: "food",
  espresso: "coffee",
  latte: "coffee",
  cappuccino: "coffee",
  cafe: "coffee",
  watch: "clock",
  campfire: "camping",
  tent: "camping",
  camp: "camping",
  backpacking: "camping",
  swim: "pool",
  swimming: "pool",
  surfer: "surf",
  wave: "surf",
  waves: "surf",
  ski: "skiing",
  snowboard: "skiing",
  hike: "mountain",
  hiking: "mountain",
  trail: "mountain",
};

/** Vocabulary index by label (includes the canonical labels themselves). */
const conceptIndexByLabel = new Map<string, number>(
  SEMANTIC_CONCEPT_LABELS.map((label, index) => [label, index]),
);

let cachedConceptMatrix: Float32Array | null = null;

/** Decode the embedded concept blob (little-endian float32, dim per label). */
export function semanticConceptMatrix(): Float32Array {
  if (cachedConceptMatrix) return cachedConceptMatrix;
  const binary = Buffer.from(SEMANTIC_CONCEPT_VECTORS_B64, "base64");
  const expected = SEMANTIC_CONCEPT_COUNT * SEMANTIC_CONCEPT_DIM * 4;
  if (binary.length !== expected) {
    throw new Error(`Concept blob has ${binary.length} bytes, expected ${expected}.`);
  }
  const matrix = new Float32Array(SEMANTIC_CONCEPT_COUNT * SEMANTIC_CONCEPT_DIM);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  for (let i = 0; i < matrix.length; i++) matrix[i] = view.getFloat32(i * 4, true);
  cachedConceptMatrix = matrix;
  return matrix;
}

/** One L2-normalized concept vector (a copy; the cache is never exposed). */
export function semanticConceptVector(index: number): Float32Array {
  if (!Number.isInteger(index) || index < 0 || index >= SEMANTIC_CONCEPT_COUNT) {
    throw new RangeError(`Concept index ${index} is outside 0..${SEMANTIC_CONCEPT_COUNT - 1}.`);
  }
  const matrix = semanticConceptMatrix();
  return matrix.slice(index * SEMANTIC_CONCEPT_DIM, (index + 1) * SEMANTIC_CONCEPT_DIM);
}

/** L2 norm of a vector (0 for the zero vector). */
export function vectorNorm(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

/** Unit-length copy (zero vectors come back all-zero, never NaN). */
export function normalizeEmbedding(values: ArrayLike<number>): Float32Array {
  const norm = vectorNorm(values);
  const out = new Float32Array(values.length);
  if (!(norm > 0) || !Number.isFinite(norm)) return out;
  for (let i = 0; i < values.length; i++) out[i] = (values[i] ?? 0) / norm;
  return out;
}

/** Cosine similarity of two unit vectors (plain dot product). */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new RangeError(`Embedding dims differ (${a.length} vs ${b.length}).`);
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

function bilinearChannelAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const cx = Math.max(0, Math.min(width - 1.001, x));
  const cy = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const v00 = data[(y0 * width + x0) * 4 + channel] ?? 0;
  const v10 = data[(y0 * width + x1) * 4 + channel] ?? 0;
  const v01 = data[(y1 * width + x0) * 4 + channel] ?? 0;
  const v11 = data[(y1 * width + x1) * 4 + channel] ?? 0;
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/**
 * CLIP image preprocessing: shortest edge -> 224 (bilinear), center-crop
 * 224, /255, CLIP mean/std into float32 NCHW (single batch). The reference
 * uses bicubic resampling; bilinear differs negligibly for retrieval and
 * keeps the pack dependency-free.
 */
export function packSemanticInput(image: PixelImage): { data: Float32Array; size: number } {
  assertValidImage(image);
  const size = SEMANTIC_SEARCH_SIZE;
  const scale = size / Math.min(image.width, image.height);
  const scaledWidth = Math.max(size, Math.round(image.width * scale));
  const scaledHeight = Math.max(size, Math.round(image.height * scale));
  const cropX = (scaledWidth - size) / 2;
  const cropY = (scaledHeight - size) / 2;
  const data = new Float32Array(3 * size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map the crop pixel back to source coordinates through the scale.
      const sx = (cropX + x + 0.5) / scale - 0.5;
      const sy = (cropY + y + 0.5) / scale - 0.5;
      for (let c = 0; c < 3; c++) {
        const mean = SEMANTIC_SEARCH_NORM_MEAN[c] ?? 0;
        const std = SEMANTIC_SEARCH_NORM_STD[c] ?? 1;
        data[c * size * size + y * size + x] = bilinearChannelAt(image.data, image.width, image.height, sx, sy, c) / 255 / std - mean / std;
      }
    }
  }
  return { data, size };
}

/**
 * Pooled image_embeds output -> L2-normalized 512-d unit vector. Accepts the
 * flat 512 values (batched [1, 512] reads identically). Non-finite inputs
 * sanitize to 0 before normalizing so one bad lane cannot poison the vector.
 */
export function parseSemanticOutput(values: ArrayLike<number>): Float32Array {
  if (values.length !== SEMANTIC_SEARCH_DIM) {
    throw new RangeError(`Semantic output has ${values.length} values, expected ${SEMANTIC_SEARCH_DIM}.`);
  }
  const clean = new Float32Array(SEMANTIC_SEARCH_DIM);
  for (let i = 0; i < clean.length; i++) {
    const value = values[i] ?? 0;
    clean[i] = Number.isFinite(value) ? value : 0;
  }
  return normalizeEmbedding(clean);
}

/** Softmax over scaled logits (numerically stable shift by the max). */
export function softmax(logits: ArrayLike<number>): Float32Array {
  const out = new Float32Array(logits.length);
  if (!logits.length) return out;
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i] ?? -Infinity);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const value = Math.exp((logits[i] ?? 0) - max);
    out[i] = value;
    sum += value;
  }
  if (!(sum > 0)) return out;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / sum;
  return out;
}

/**
 * Zero-shot distribution of one image embedding over the vocabulary: cosine
 * vs every concept, softmax at the CLIP logit scale. Shared by labeling
 * (top-k above the floors) and search (the support rule).
 */
export function zeroShotProbabilities(embedding: ArrayLike<number>): Float32Array {
  if (embedding.length !== SEMANTIC_SEARCH_DIM) {
    throw new RangeError(`Embedding has ${embedding.length} dims, expected ${SEMANTIC_SEARCH_DIM}.`);
  }
  const matrix = semanticConceptMatrix();
  const sims = new Float32Array(SEMANTIC_CONCEPT_COUNT);
  for (let i = 0; i < SEMANTIC_CONCEPT_COUNT; i++) {
    let dot = 0;
    const base = i * SEMANTIC_CONCEPT_DIM;
    for (let j = 0; j < SEMANTIC_CONCEPT_DIM; j++) dot += (embedding[j] ?? 0) * (matrix[base + j] ?? 0);
    sims[i] = dot;
  }
  const scaled = new Float32Array(sims.length);
  for (let i = 0; i < scaled.length; i++) scaled[i] = (sims[i] ?? 0) * SEMANTIC_SEARCH_LOGIT_SCALE;
  return softmax(scaled);
}

/**
 * Zero-shot labels for one image embedding: top-k of the zero-shot
 * distribution above the probability floors. The top label always lands
 * when it clears the lower floor; extras need the higher one. Scores are
 * softmax probabilities (0..1), sorted best first.
 */
export function assignSemanticLabels(
  embedding: ArrayLike<number>,
  topK: number = SEMANTIC_SEARCH_LABEL_TOP_K,
): PhotoLabel[] {
  const probs = zeroShotProbabilities(embedding);
  const order = probs.map((_prob, index) => index).sort((a, b) => (probs[b] ?? 0) - (probs[a] ?? 0));
  const labels: PhotoLabel[] = [];
  for (const index of order.slice(0, Math.max(1, topK))) {
    const prob = probs[index] ?? 0;
    const floor = labels.length === 0 ? SEMANTIC_SEARCH_LABEL_MIN_TOP : SEMANTIC_SEARCH_LABEL_MIN_PROB;
    if (prob < floor) continue;
    labels.push({ label: SEMANTIC_CONCEPT_LABELS[index] ?? "", score: prob, source: "ml" });
  }
  return labels;
}

/** Split a query into lowercase words (letters/digits only). */
export function tokenizeSemanticQuery(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).map((word) => word.trim()).filter((word) => word.length > 0);
}

/**
 * Map one query word onto a vocabulary index: exact label, alias, then
 * singular folding ("beaches" -> "beach", "churches" -> "church"). Null when
 * the word names no concept (the query falls back to keyword matching).
 */
export function conceptIndexForWord(word: string): number | null {
  const direct = conceptIndexByLabel.get(word) ?? SEMANTIC_SEARCH_ALIASES[word];
  if (direct !== undefined) {
    return typeof direct === "number" ? direct : (conceptIndexByLabel.get(direct) ?? null);
  }
  // Plural folding: -es for sibilants ("churches"), else bare -s ("dogs").
  // Runs after the alias table so irregular plurals ("puppies") win there.
  const singular = word.endsWith("es") && /(s|sh|ch|x|z)es$/.test(word)
    ? word.slice(0, -2)
    : word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : null;
  if (!singular) return null;
  const folded = conceptIndexByLabel.get(singular) ?? SEMANTIC_SEARCH_ALIASES[singular];
  if (folded === undefined) return null;
  return typeof folded === "number" ? folded : (conceptIndexByLabel.get(folded) ?? null);
}

/**
 * Query -> concept hits: each matched word with its vocabulary index, in
 * query order, deduplicated. Empty when nothing maps (keyword fallback).
 */
export function conceptsOfQuery(query: string): { word: string; label: string; index: number }[] {
  const hits: { word: string; label: string; index: number }[] = [];
  const seen = new Set<number>();
  for (const word of tokenizeSemanticQuery(query)) {
    const index = conceptIndexForWord(word);
    if (index === null || seen.has(index)) continue;
    seen.add(index);
    hits.push({ word, label: SEMANTIC_CONCEPT_LABELS[index] ?? word, index });
  }
  return hits;
}

/**
 * Mean concept vector for one query (L2-normalized). Multi-concept queries
 * ("church mountain") average their concepts; single-concept queries return
 * the concept itself. Null when no word maps.
 */
export function queryEmbedding(concepts: { index: number }[]): Float32Array | null {
  if (!concepts.length) return null;
  const mean = new Float32Array(SEMANTIC_CONCEPT_DIM);
  for (const { index } of concepts) {
    const vector = semanticConceptVector(index);
    for (let j = 0; j < mean.length; j++) mean[j] = (mean[j] ?? 0) + (vector[j] ?? 0);
  }
  return normalizeEmbedding(mean);
}

export interface RankedPhoto {
  photoId: string;
  /** Cosine similarity (label-boosted matches report at least the boost). */
  score: number;
  /** True when a stored label (any source) matched the query. */
  labelMatch: boolean;
}

export interface SemanticHitSignals {
  /** Cosine similarity of the query and photo embeddings (-1 when unknown). */
  cosine: number;
  /** Best zero-shot probability of a matched concept (0 when uncomputed). */
  prob: number;
  /** True when a stored label (any source) names a matched concept. */
  labelMatch: boolean;
}

/**
 * Hit truth table: strong cosines hit on their own; weaker ones need
 * zero-shot support (the concept stands out in the photo's distribution);
 * label matches always hit (boosted to the label floor). Null misses.
 * Ranks by cosine, so strong embedding hits outrank pure label matches.
 */
export function semanticHitScore(signals: SemanticHitSignals): number | null {
  if (signals.labelMatch) {
    return Math.max(signals.cosine, SEMANTIC_SEARCH_LABEL_BOOST);
  }
  if (signals.cosine >= SEMANTIC_SEARCH_MIN_SCORE) return signals.cosine;
  if (signals.cosine >= SEMANTIC_SEARCH_SUPPORT_COSINE && signals.prob >= SEMANTIC_SEARCH_SUPPORT_PROB) {
    return signals.cosine;
  }
  return null;
}

/**
 * Rank photos for one semantic query. The full zero-shot distribution runs
 * per photo (50 dots — milliseconds even for large libraries), so the
 * support rule sees every concept. Best first, capped per query.
 */
export function rankSemanticPhotos(
  query: Float32Array,
  concepts: readonly { index: number }[],
  photos: { id: string; embedding: ArrayLike<number> | null; labels: readonly string[] }[],
  maxResults: number = SEMANTIC_SEARCH_MAX_RESULTS,
): RankedPhoto[] {
  const matchedLabels = new Set<string>();
  for (const { index } of concepts) {
    const label = SEMANTIC_CONCEPT_LABELS[index];
    if (label) matchedLabels.add(label);
  }
  const ranked: RankedPhoto[] = [];
  for (const photo of photos) {
    const labelMatch = photo.labels.some((label) => matchedLabels.has(label.toLowerCase()));
    let cosine = -1;
    let prob = 0;
    if (photo.embedding && photo.embedding.length === SEMANTIC_SEARCH_DIM) {
      let dot = 0;
      for (let j = 0; j < SEMANTIC_SEARCH_DIM; j++) dot += (query[j] ?? 0) * (photo.embedding[j] ?? 0);
      cosine = dot;
      // The distribution only runs when support could matter: strong and
      // hopeless cosines skip it.
      if (cosine >= SEMANTIC_SEARCH_SUPPORT_COSINE && cosine < SEMANTIC_SEARCH_MIN_SCORE && !labelMatch) {
        const probs = zeroShotProbabilities(photo.embedding);
        for (const { index } of concepts) prob = Math.max(prob, probs[index] ?? 0);
      }
    }
    const score = semanticHitScore({ cosine, prob, labelMatch });
    if (score === null) continue;
    ranked.push({ photoId: photo.id, score, labelMatch });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(1, maxResults));
}

/** Catalog wire format: base64 little-endian float32 (2KB per photo). */
export function encodeEmbedding(embedding: ArrayLike<number>): string {
  if (embedding.length !== SEMANTIC_SEARCH_DIM) {
    throw new RangeError(`Embedding has ${embedding.length} dims, expected ${SEMANTIC_SEARCH_DIM}.`);
  }
  const buffer = Buffer.alloc(SEMANTIC_SEARCH_DIM * 4);
  for (let i = 0; i < SEMANTIC_SEARCH_DIM; i++) buffer.writeFloatLE(embedding[i] ?? 0, i * 4);
  return buffer.toString("base64");
}

/** Decode the catalog format; null on corrupt payloads (never throws). */
export function decodeEmbedding(encoded: string): Float32Array | null {
  try {
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length !== SEMANTIC_SEARCH_DIM * 4) return null;
    const out = new Float32Array(SEMANTIC_SEARCH_DIM);
    for (let i = 0; i < out.length; i++) {
      const value = buffer.readFloatLE(i * 4);
      out[i] = Number.isFinite(value) ? value : 0;
    }
    return out;
  } catch {
    return null;
  }
}

/** Validate a user-supplied label (lowercased on success; null when invalid). */
export function normalizeUserLabel(label: string): string | null {
  const clean = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (!clean || clean.length > 32) return null;
  if (!/^[a-z0-9][a-z0-9 -]*$/.test(clean)) return null;
  return clean;
}
