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
 * Taste is conditional on subject, not one global style: each sample is
 * tagged with the photo's top ML label (the frozen CLIP zero-shot tag from
 * semantic search, e.g. "grapes"), and enhancing a photo first looks for
 * enough same-label evidence (three edited photos sharing the label) — so
 * similar photos generalize one consistent style onto each other while a
 * dissimilar photo gets its own treatment. A subject with too few edited
 * photos falls back to the global medians over all samples, and an
 * unlabeled photo (offline import, demo photo) always uses the global
 * scope. Only when a subject has evidence but no consistent habit does the
 * enhance stay silent — borrowing the global style there would paint one
 * subject's look onto another.
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
import type { EditState, HistoryState, PhotoLabel } from "./types.js";

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

export const TASTE_PROFILE_VERSION = 2;

/** Previous versions still accepted by the parser (migrated in place). */
const TASTE_PROFILE_LEGACY_VERSIONS = [1];

/** Longest stored subject label; vocabulary words are far shorter. */
export const MAX_TASTE_LABEL_LENGTH = 64;

/**
 * One photo's contribution: its non-default learned values (never empty),
 * tagged with the photo's top ML label when it had one. Untagged samples
 * (legacy profiles, unlabeled photos) still count toward the global scope —
 * they just never join a subject scope.
 */
export interface TasteSample {
  values: Partial<Record<TasteKey, number>>;
  label?: string;
}

/** Which evidence set a summary/patch was drawn from. */
export type TasteScope = "label" | "global";

/** Normalize a subject tag: trimmed, lowercase, length-capped — or null. */
export function normalizeTasteLabel(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const clean = label.trim().toLowerCase();
  if (!clean) return null;
  return clean.slice(0, MAX_TASTE_LABEL_LENGTH);
}

/**
 * The subject tag for one photo: its highest-scoring ML (CLIP zero-shot)
 * label. Hand-added labels are ignored — they are organizational free text
 * ("wedding", "to print"), not visual similarity, and their score of 1
 * would always outrank the model. Null when the photo carries no ML label
 * (offline import, demo/legacy record), in which case the photo learns and
 * enhances in the global scope only.
 */
export function topTasteLabel(labels: readonly PhotoLabel[] | null | undefined): string | null {
  if (!labels || labels.length === 0) return null;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const entry of labels) {
    if (!entry || typeof entry !== "object" || entry.source !== "ml") continue;
    const text = normalizeTasteLabel(entry.label);
    const score = typeof entry.score === "number" && Number.isFinite(entry.score) ? entry.score : -Infinity;
    if (text && score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best;
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
 * The subject tag (see topTasteLabel) rides along when given, so the
 * sample can join its subject scope as well as the global one.
 */
export function sampleTasteFromEdit(edit: EditState, label?: string | null): TasteSample | null {
  const values: Partial<Record<TasteKey, number>> = {};
  for (const key of TASTE_KEYS) {
    const value = edit[key];
    if (typeof value === "number" && Number.isFinite(value) && value !== DEFAULT_EDIT[key]) {
      values[key] = value;
    }
  }
  if (Object.keys(values).length === 0) return null;
  const tag = normalizeTasteLabel(label);
  return tag ? { values, label: tag } : { values };
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

function normalizeSampleLabel(label: string | undefined): string | null {
  return label === undefined ? null : normalizeTasteLabel(label);
}

function samplesEqual(a: TasteSample | undefined, b: TasteSample | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  // A subject retag (labels landing after the edit, or a relabel) is a
  // real change: the sample moves scopes, so the write must go through.
  if (normalizeSampleLabel(a.label) !== normalizeSampleLabel(b.label)) return false;
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
  if (sample) {
    // Canonicalize the stored tag (compare-tolerant, store-strict).
    const tag = normalizeSampleLabel(sample.label);
    samples[photoId] = tag ? { values: sample.values, label: tag } : { values: sample.values };
  } else delete samples[photoId];
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
  /** Edited photos contributing samples (in the summary's scope). */
  photos: number;
  /** Qualifying keys only (majority-touched, median off the default). */
  keys: Partial<Record<TasteKey, TasteKeySummary>>;
  /** Which evidence set this summary was drawn from. */
  scope: TasteScope;
  /** The subject tag the summary was requested for (null: global). */
  label: string | null;
}

/**
 * Summarize the profile: per-key medians for keys with a consistent habit
 * (see tasteKeyThreshold). Keys whose snapped median lands back on the
 * factory default are dropped — applying them would dirty nothing.
 *
 * Pass the target photo's subject tag (see topTasteLabel) for the
 * conditional summary: when at least MIN_TASTE_PHOTOS edited photos share
 * the tag, the medians come from that subject alone (scope "label") — one
 * consistent style generalized across similar photos. Otherwise the
 * summary falls back to all samples (scope "global"): the best available
 * guess for a subject with too little evidence. A subject scope with no
 * qualifying key is honest silence, never a global borrow — the evidence
 * says this subject has no habit, and painting another subject's look onto
 * it would be exactly the global-style leak conditioning exists to stop.
 */
export function summarizeTaste(profile: TasteProfile, label?: string | null): TasteSummary {
  const tag = normalizeTasteLabel(label);
  const all = Object.values(profile.samples);
  const matching = tag ? all.filter((sample) => normalizeSampleLabel(sample.label) === tag) : [];
  const scoped = tag !== null && matching.length >= MIN_TASTE_PHOTOS;
  const samples = scoped ? matching : all;
  const summary: TasteSummary = { photos: samples.length, keys: {}, scope: scoped ? "label" : "global", label: tag };
  if (samples.length === 0) return summary;
  const threshold = tasteKeyThreshold(samples.length);
  for (const key of TASTE_KEYS) {
    const touched = samples
      .map((sample) => sample.values[key])
      .filter((value): value is number => typeof value === "number");
    if (touched.length < threshold) continue;
    const medianValue = snapTasteValue(key, median(touched));
    if (medianValue === DEFAULT_EDIT[key]) continue;
    summary.keys[key] = { median: medianValue, count: touched.length };
  }
  return summary;
}

/**
 * The ML Auto Enhance patch: the summary's medians as an EditState patch,
 * or null while the profile lacks evidence (fewer than MIN_TASTE_PHOTOS
 * edited photos in scope, or no key with a consistent habit yet). Pass the
 * target photo's subject tag for the conditional patch (subject scope with
 * global fallback — see summarizeTaste); omit it for the global patch.
 */
export function tasteEnhancePatch(profile: TasteProfile, label?: string | null): Partial<EditState> | null {
  const summary = summarizeTaste(profile, label);
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
 * dropped, out-of-range values snap to the slider range, empty samples
 * are pruned, and subject tags are normalized (bad tags drop, keeping the
 * values as untagged global contributors). Version 1 profiles migrate in
 * place: their untagged samples keep working exactly as before.
 */
export function parseTasteProfile(value: unknown): TasteProfile {
  const empty = createTasteProfile();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const record = value as Record<string, unknown>;
  if (record.version !== TASTE_PROFILE_VERSION && !TASTE_PROFILE_LEGACY_VERSIONS.includes(record.version as number)) {
    return empty;
  }
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
    const tag = normalizeTasteLabel((candidate as { label?: unknown }).label);
    samples[photoId] = tag ? { values: clean, label: tag } : { values: clean };
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

/** Seed shape for the backfill: saved recipes, their action stacks, and per-photo labels for subject tags. */
export interface TasteSeed {
  histories: Record<string, HistoryState>;
  actions: Record<string, ActionStack>;
  labels?: Record<string, readonly PhotoLabel[] | undefined>;
}

/**
 * Build a profile from the library's saved recipes (the first-run
 * bootstrap: existing edits count as taste without re-editing them).
 * Pure-auto recipes are skipped — see isPureAutoStack. Replaces, never
 * merges: the seed is the library's current truth. Seed samples are
 * subject-tagged from the seed labels, so the bootstrap already learns
 * conditionally.
 */
export function tasteProfileFromSeed(seed: TasteSeed, appliedAt: string): TasteProfile {
  let profile = createTasteProfile(appliedAt);
  for (const [photoId, history] of Object.entries(seed.histories)) {
    if (!history || typeof history !== "object") continue;
    const present = (history as HistoryState).present;
    if (!present || typeof present !== "object") continue;
    if (isPureAutoStack(seed.actions[photoId])) continue;
    profile = recordTasteSample(
      profile,
      photoId,
      sampleTasteFromEdit(present as EditState, topTasteLabel(seed.labels?.[photoId])),
      appliedAt,
    );
  }
  return profile;
}
