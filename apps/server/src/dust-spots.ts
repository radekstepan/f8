// Server-side dust/spot detection for repair: classical blob candidates plus
// a tiny ML false-positive filter, served as suggested repair masks.
//
// Like every neural path, the ML stage runs here, never in the browser. The
// client POSTs a downsampled crop and gets scored dust spots back; it turns
// accepted spots into repair strokes (one stroke id per spot) that the
// existing ROI→inpaint pipeline heals — no new inference path.
//
// The classifier is a logistic regression over four per-candidate features,
// small enough (five floats) to ship embedded in @f8/core: there is no weight
// download and no separate weight license. F8_DUST_SPOTS_WEIGHTS may point at
// a JSON file with fitted replacements; F8_DUST_SPOTS_OFFLINE=1 (or an
// unreadable custom-weights file) serves classical-only candidates instead,
// and the response always names its source so the UI never calls a classical
// scan ML.

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  DUST_SPOTS_CLASSIC_SCORE,
  DUST_SPOTS_CLASSIFIER_WEIGHTS,
  DUST_SPOTS_MODEL_ID,
  DUST_SPOTS_MODEL_VERSION,
  filterSpotsWithClassifier,
  parseDustSpotsWeights,
  proposeDustCandidates,
  type DustSpot,
  type DustSpotsSource,
  type DustSpotsWeights,
} from "@f8/core";

export const DUST_SPOTS_MODEL_DIR_SUFFIX = path.join("models", "dust-spots");
export const DUST_SPOTS_MAX_DIM = 2048;
/** Raw RGBA payload cap (~8MP); the client sends a ≤1280px downsample. */
export const DUST_SPOTS_MAX_BYTES = 2048 * 2048 * 4;

export interface DustSpotsHealth {
  ok: boolean;
  /** Always true: detection serves with or without the ML filter. */
  ready: boolean;
  serving: boolean;
  /** False in classical-only mode (offline flag or bad custom weights). */
  mlEnabled: boolean;
  /** "ml" when the classifier filters, else "classic". */
  source: DustSpotsSource;
  classifier: { model: string; version: string; weights: "embedded" | "custom" | "none"; license: string };
  error: string | null;
}

export interface DustSpotsBody {
  width: number;
  height: number;
  /** Base64 of raw RGBA bytes (width*height*4). */
  imageB64: string;
}

export interface DustSpotsResult {
  spots: DustSpot[];
  source: DustSpotsSource;
  width: number;
  height: number;
}

function dustSpotsOffline(env: Record<string, string | undefined> = process.env): boolean {
  return env["F8_DUST_SPOTS_OFFLINE"] === "1";
}

function customWeightsPath(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env["F8_DUST_SPOTS_WEIGHTS"];
  if (!raw || !raw.trim()) return null;
  return path.resolve(raw.trim());
}

/** Custom weights, or null when none are configured (embedded serve). Throws on bad files. */
async function loadCustomWeights(env: Record<string, string | undefined>): Promise<DustSpotsWeights | null> {
  const configured = customWeightsPath(env);
  if (!configured) return null;
  const raw = await fs.readFile(configured, "utf8");
  return parseDustSpotsWeights(JSON.parse(raw) as unknown);
}

/** Resolve the serving mode: ML filter with embedded/custom weights, or classical-only. */
async function resolveServing(env: Record<string, string | undefined>): Promise<{
  mlEnabled: boolean;
  source: DustSpotsSource;
  weights: DustSpotsWeights | null;
  weightsKind: "embedded" | "custom" | "none";
  error: string | null;
}> {
  if (dustSpotsOffline(env)) {
    return { mlEnabled: false, source: "classic", weights: null, weightsKind: "none", error: null };
  }
  try {
    const custom = await loadCustomWeights(env);
    if (custom) return { mlEnabled: true, source: "ml", weights: custom, weightsKind: "custom", error: null };
    return { mlEnabled: true, source: "ml", weights: DUST_SPOTS_CLASSIFIER_WEIGHTS, weightsKind: "embedded", error: null };
  } catch (error) {
    // A configured-but-unreadable weights file degrades to classical-only
    // rather than failing detection; the error stays visible in health.
    return {
      mlEnabled: false,
      source: "classic",
      weights: null,
      weightsKind: "none",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getDustSpotsHealth(
  _dataDir: string,
  env: Record<string, string | undefined> = process.env,
): Promise<DustSpotsHealth> {
  const serving = await resolveServing(env);
  return {
    ok: true,
    ready: true,
    serving: true,
    mlEnabled: serving.mlEnabled,
    source: serving.source,
    classifier: {
      model: DUST_SPOTS_MODEL_ID,
      version: DUST_SPOTS_MODEL_VERSION,
      weights: serving.weightsKind,
      license: "embedded in @f8/core, same as the repo (no separate weight license)",
    },
    error: serving.error,
  };
}

export function validateDustSpotsBody(body: unknown): { ok: true; value: DustSpotsBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { width, height, imageB64 } = body as Record<string, unknown>;
  if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > DUST_SPOTS_MAX_DIM) {
    return { ok: false, error: "Invalid width." };
  }
  if (!Number.isInteger(height) || (height as number) < 1 || (height as number) > DUST_SPOTS_MAX_DIM) {
    return { ok: false, error: "Invalid height." };
  }
  if (typeof imageB64 !== "string" || imageB64.length === 0) return { ok: false, error: "Missing image." };
  const expected = (width as number) * (height as number) * 4;
  if (expected > DUST_SPOTS_MAX_BYTES) return { ok: false, error: "Image too large." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageB64, "base64");
  } catch {
    return { ok: false, error: "Invalid image encoding." };
  }
  if (bytes.length !== expected) return { ok: false, error: `Image bytes mismatch (got ${bytes.length}, expected ${expected}).` };
  return { ok: true, value: { width: width as number, height: height as number, imageB64 } };
}

export async function runDustSpotsDetect(
  _dataDir: string,
  body: DustSpotsBody,
  env: Record<string, string | undefined> = process.env,
): Promise<DustSpotsResult> {
  const bytes = Buffer.from(body.imageB64, "base64");
  const rgba = new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const candidates = proposeDustCandidates({ width: body.width, height: body.height, data: rgba });
  const serving = await resolveServing(env);
  if (!serving.mlEnabled || !serving.weights) {
    return {
      spots: candidates.map(({ features: _features, ...spot }) => ({ ...spot, score: DUST_SPOTS_CLASSIC_SCORE })),
      source: "classic",
      width: body.width,
      height: body.height,
    };
  }
  return {
    spots: filterSpotsWithClassifier(candidates, { weights: serving.weights }),
    source: "ml",
    width: body.width,
    height: body.height,
  };
}
