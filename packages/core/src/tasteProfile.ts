/**
 * Personal taste profile: learns the user's adjustment habits from their
 * saved recipes so "ML Auto Enhance" can apply them to a new photo.
 *
 * The model is deliberately simple and transparent — per-adjustment medians
 * over the user's own edited photos, not a neural network. A photo
 * contributes one sample (its non-default look values, keyed by photo id so
 * re-saving replaces rather than double-counts), and a key joins the
 * enhance patch only when it shows a consistent habit: touched on at least
 * half of the edited photos (minimum two), with at least three edited
 * photos overall. Pure auto output (an enhance entry still flagged pure)
 * carries no human signal and is skipped, so the profile can never learn
 * the app's own defaults back from untouched Auto Enhance runs.
 *
 * Only the seventeen numeric look sliders are learned. Geometry
 * (rotation/flip/straighten/crop), retouch strokes, and denoise are
 * per-photo by nature; presets labels, enabled flags, the tone-curve
 * anchors, Selective Color/Clarity entries, and the ML look states
 * (face/selective/denoise) are excluded as structured or boolean state the
 * median cannot represent. The profile lives in the browser's localStorage
 * (see useTasteProfile) — it never leaves the device and is not part of
 * the server recipe.
 */

import { actionEntry } from "./actionStack.js";
import { DEFAULT_EDIT } from "./data.js";
import type { ActionStack } from "./actionStack.js";
import type { EditState, HistoryState } from "./types.js";

/** Numeric look sliders the taste profile learns, in Inspector order. */
export const TASTE_KEYS = [
  "temperature",
  "tint",
  "exposure",
  "brightness",
  "contrast",
  "highlights",
  "shadows",
  "blacks",
  "saturation",
  "vibrance",
  "hue",
  "clarity",
  "sharpness",
  "grain",
  "vignette",
  "fade",
  "curve",
] as const;

export type TasteKey = (typeof TASTE_KEYS)[number];

/**
 * Slider range + step per learned key, mirroring the Inspector's
 * RangeControls (temperature 2000..10000 step 50, exposure -3..3 step 0.01,
 * hue -180..180, sharpness/grain/vignette/fade floored at 0, the rest
 * -100..100 step 1). Medians snap to the step and clamp to the range so
 * the enhance patch always lands on a renderable slider value.
 */
export interface TasteKeySpec {
  min: number;
  max: number;
  step: number;
}

const BIPOLAR_100: TasteKeySpec = { min: -100, max: 100, step: 1 };
const POSITIVE_100: TasteKeySpec = { min: 0, max: 100, step: 1 };

export const TASTE_KEY_SPEC: Record<TasteKey, TasteKeySpec> = {
  temperature: { min: 2000, max: 10000, step: 50 },
  tint: { ...BIPOLAR_100 },
  exposure: { min: -3, max: 3, step: 0.01 },
  brightness: { ...BIPOLAR_100 },
  contrast: { ...BIPOLAR_100 },
  highlights: { ...BIPOLAR_100 },
  shadows: { ...BIPOLAR_100 },
  blacks: { ...BIPOLAR_100 },
  saturation: { ...BIPOLAR_100 },
  vibrance: { ...BIPOLAR_100 },
  hue: { min: -180, max: 180, step: 1 },
  clarity: { ...BIPOLAR_100 },
  sharpness: { ...POSITIVE_100 },
  grain: { ...POSITIVE_100 },
  vignette: { ...POSITIVE_100 },
  fade: { ...POSITIVE_100 },
  curve: { ...BIPOLAR_100 },
};

/** Minimum edited photos before ML Auto Enhance unlocks. */
export const MIN_TASTE_PHOTOS = 3;

/**
 * Absolute floor for a key's evidence: a one-photo habit is an anecdote,
 * not taste. Above the floor the majority rule applies (see
 * tasteKeyThreshold).
 */
export const MIN_TASTE_KEY_PHOTOS = 2;

/** Hygiene cap on stored samples; the oldest-inserted photo drops first. */
export const MAX_TASTE_SAMPLES = 500;

export const TASTE_PROFILE_VERSION = 1;

/** One photo's contribution: its non-default learned values (never empty). */
export interface TasteSample {
  values: Partial<Record<TasteKey, number>>;
}

export interface TasteProfile {
  version: typeof TASTE_PROFILE_VERSION;
  /** Samples keyed by photo id, insertion-ordered. */
  samples: Record<string, TasteSample>;
  /** ISO timestamp of the last recording. */
  updatedAt: string;
}

export function createTasteProfile(updatedAt = ""): TasteProfile {
  return { version: TASTE_PROFILE_VERSION, samples: {}, updatedAt };
}

/**
 * Extract a photo's taste sample: the learned keys whose values differ
 * from the factory defaults. Null when the recipe holds none (the photo
 * is unedited for taste purposes — its sample, if any, should be dropped).
 */
export function sampleTasteFromEdit(edit: EditState): TasteSample | null {
  const values: Partial<Record<TasteKey, number>> = {};
  for (const key of TASTE_KEYS) {
    const value = edit[key];
    if (typeof value === "number" && Number.isFinite(value) && value !== DEFAULT_EDIT[key]) {
      values[key] = value;
    }
  }
  return Object.keys(values).length > 0 ? { values } : null;
}

/**
 * True when the action stack shows the recipe is exactly auto output: an
 * enhance entry still flagged pure (any mode — classic, scene, or taste).
 * Such a recipe carries zero human signal, so recording it would teach the
 * profile the app's own suggestions. Any manual look edit clears pure
 * through the normal stack transition, making the recipe recordable.
 */
export function isPureAutoStack(actions: ActionStack | null | undefined): boolean {
  if (!actions) return false;
  return actionEntry(actions, "enhance")?.pure === true;
}

function samplesEqual(a: TasteSample | undefined, b: TasteSample | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a.values) as TasteKey[];
  const bKeys = Object.keys(b.values) as TasteKey[];
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a.values[key] === b.values[key]);
}

/**
 * Record (or drop, when the sample is null) one photo's sample. Re-saving
 * a photo replaces its sample — the profile counts photos, not saves, so
 * editing one photo a hundred times cannot outweigh the rest. Returns the
 * input profile untouched when nothing changes (no timestamp bump), so
 * callers can skip their write-through.
 */
export function recordTasteSample(
  profile: TasteProfile,
  photoId: string,
  sample: TasteSample | null,
  appliedAt: string,
): TasteProfile {
  if (samplesEqual(profile.samples[photoId], sample)) return profile;
  const samples: Record<string, TasteSample> = { ...profile.samples };
  if (sample) samples[photoId] = sample;
  else delete samples[photoId];
  // Cap hygiene: drop the oldest-inserted samples beyond the cap. (A
  // replaced sample keeps its original insertion slot — recency is
  // approximate, which is all a hygiene cap needs.)
  const ids = Object.keys(samples);
  for (let i = 0; i < ids.length - MAX_TASTE_SAMPLES; i += 1) {
    delete samples[ids[i] as string];
  }
  return { version: TASTE_PROFILE_VERSION, samples, updatedAt: appliedAt };
}

/** Drop one photo's sample (photo removed from the library). */
export function forgetTasteSample(profile: TasteProfile, photoId: string, appliedAt: string): TasteProfile {
  return recordTasteSample(profile, photoId, null, appliedAt);
}

/**
 * Evidence threshold for one key: touched on at least half of the edited
 * photos, never below the two-photo floor. With three photos a habit needs
 * two sightings; with ten it needs five.
 */
export function tasteKeyThreshold(photoCount: number): number {
  return Math.max(MIN_TASTE_KEY_PHOTOS, Math.ceil(photoCount / 2));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Snap a median to the slider step and clamp to the slider range. */
export function snapTasteValue(key: TasteKey, value: number): number {
  const spec = TASTE_KEY_SPEC[key];
  const snapped = Math.round(value / spec.step) * spec.step;
  // The 0.01 exposure step needs its decimals back (0.07 * 100 = 7.000000000000001).
  const decimals = spec.step < 1 ? Math.ceil(-Math.log10(spec.step)) : 0;
  const rounded = decimals > 0 ? Math.round(snapped * 10 ** decimals) / 10 ** decimals : snapped;
  return Math.min(spec.max, Math.max(spec.min, rounded));
}

export interface TasteKeySummary {
  /** Snapped median over the photos that touched the key. */
  median: number;
  /** How many edited photos touched the key. */
  count: number;
}

export interface TasteSummary {
  /** Edited photos contributing samples. */
  photos: number;
  /** Qualifying keys only (majority-touched, median off the default). */
  keys: Partial<Record<TasteKey, TasteKeySummary>>;
}

/**
 * Summarize the profile: per-key medians for keys with a consistent habit
 * (see tasteKeyThreshold). Keys whose snapped median lands back on the
 * factory default are dropped — applying them would dirty nothing.
 */
export function summarizeTaste(profile: TasteProfile): TasteSummary {
  const samples = Object.values(profile.samples);
  const keys: Partial<Record<TasteKey, TasteKeySummary>> = {};
  if (samples.length === 0) return { photos: 0, keys };
  const threshold = tasteKeyThreshold(samples.length);
  for (const key of TASTE_KEYS) {
    const touched = samples
      .map((sample) => sample.values[key])
      .filter((value): value is number => typeof value === "number");
    if (touched.length < threshold) continue;
    const medianValue = snapTasteValue(key, median(touched));
    if (medianValue === DEFAULT_EDIT[key]) continue;
    keys[key] = { median: medianValue, count: touched.length };
  }
  return { photos: samples.length, keys };
}

/**
 * The ML Auto Enhance patch: the summary's medians as an EditState patch,
 * or null while the profile lacks evidence (fewer than MIN_TASTE_PHOTOS
 * edited photos, or no key with a consistent habit yet).
 */
export function tasteEnhancePatch(profile: TasteProfile): Partial<EditState> | null {
  const summary = summarizeTaste(profile);
  if (summary.photos < MIN_TASTE_PHOTOS) return null;
  const keys = Object.keys(summary.keys) as TasteKey[];
  if (keys.length === 0) return null;
  const patch: Partial<EditState> = {};
  const record = patch as Record<string, number>;
  for (const key of keys) {
    const entry = summary.keys[key];
    if (entry) record[key] = entry.median;
  }
  return patch;
}

function sanitizeSampleValue(key: string, value: unknown): number | null {
  if (!(key in TASTE_KEY_SPEC)) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return snapTasteValue(key as TasteKey, value);
}

/**
 * Parse a stored profile across the persistence boundary. Never throws —
 * garbage in, empty profile out. Unknown keys and non-numeric values are
 * dropped, out-of-range values snap to the slider range, and empty samples
 * are pruned.
 */
export function parseTasteProfile(value: unknown): TasteProfile {
  const empty = createTasteProfile();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const record = value as Record<string, unknown>;
  if (record.version !== TASTE_PROFILE_VERSION) return empty;
  if (!record.samples || typeof record.samples !== "object" || Array.isArray(record.samples)) return empty;
  const samples: Record<string, TasteSample> = {};
  for (const [photoId, candidate] of Object.entries(record.samples as Record<string, unknown>)) {
    if (!photoId || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const values = (candidate as { values?: unknown }).values;
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    const clean: Partial<Record<TasteKey, number>> = {};
    for (const [key, entry] of Object.entries(values as Record<string, unknown>)) {
      const sanitized = sanitizeSampleValue(key, entry);
      if (sanitized !== null) clean[key as TasteKey] = sanitized;
    }
    if (Object.keys(clean).length === 0) continue;
    samples[photoId] = { values: clean };
    if (Object.keys(samples).length >= MAX_TASTE_SAMPLES) break;
  }
  return {
    version: TASTE_PROFILE_VERSION,
    samples,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

/** Parse the localStorage JSON encoding. Never throws. */
export function parseTasteProfileJson(raw: string | null | undefined): TasteProfile {
  if (!raw) return createTasteProfile();
  try {
    return parseTasteProfile(JSON.parse(raw) as unknown);
  } catch {
    return createTasteProfile();
  }
}

export function serializeTasteProfile(profile: TasteProfile): string {
  return JSON.stringify(profile);
}

/** Seed shape for the backfill: saved recipes plus their action stacks. */
export interface TasteSeed {
  histories: Record<string, HistoryState>;
  actions: Record<string, ActionStack>;
}

/**
 * Build a profile from the library's saved recipes (the first-run
 * bootstrap: existing edits count as taste without re-editing them).
 * Pure-auto recipes are skipped — see isPureAutoStack. Replaces, never
 * merges: the seed is the library's current truth.
 */
export function tasteProfileFromSeed(seed: TasteSeed, appliedAt: string): TasteProfile {
  let profile = createTasteProfile(appliedAt);
  for (const [photoId, history] of Object.entries(seed.histories)) {
    if (!history || typeof history !== "object") continue;
    const present = (history as HistoryState).present;
    if (!present || typeof present !== "object") continue;
    if (isPureAutoStack(seed.actions[photoId])) continue;
    profile = recordTasteSample(profile, photoId, sampleTasteFromEdit(present as EditState), appliedAt);
  }
  return profile;
}
