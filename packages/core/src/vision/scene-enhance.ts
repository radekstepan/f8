// Subject-aware auto-enhance: a tiny ML scene classifier picks per-scene
// enhance parameters instead of one fixed patch.
//
// The classic computeAutoEnhance (enhance.ts) is scene-blind: the same muted
// portrait and the same flat landscape get the same saturation push. This
// module classifies the existing 160px analysis image (see decodeDownsampled
// in image.ts) into portrait / landscape / night / document and maps each
// scene to its own enhance patch — portraits protect skin tones (capped
// saturation/contrast, vibrance instead), landscapes allow stronger contrast.
//
// The classifier is a multinomial logistic regression (softmax over four
// linear heads) over six handcrafted image features. Its 28 weights ship
// embedded in this file: there is no weight download, no weight URL, and no
// separate weight license — the coefficients are source, under the repo's
// own terms. They were set by inspection against the synthetic fixtures in
// scene-enhance.test.ts, not fitted on labeled photos; parseSceneWeights
// validates fitted replacements for future use.
//
// Inputs are never mutated. Pure functions throughout: safe in Node tests,
// workers, and UI.

import type { SceneLabel } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";
import { computeAutoEnhance, computeLightnessAuto, type AutoEnhancePatch } from "./enhance.js";

/** Tiny ML model identity for the scene classifier. */
export const SCENE_MODEL_ID = "scene-logreg";
export const SCENE_MODEL_VERSION = "v1";

/** Scenes the classifier distinguishes, in canonical order. */
export const SCENE_LABELS = ["portrait", "landscape", "night", "document"] as const;

/** Human-readable scene names for the UI badge. */
export const SCENE_DISPLAY_NAMES: Record<SceneLabel, string> = {
  portrait: "Portrait",
  landscape: "Landscape",
  night: "Night",
  document: "Document",
};

/** Luminance below this counts toward the night `dark` feature (0..255). */
export const SCENE_DARK_THRESHOLD = 48;
/** Luminance above this (with low saturation) counts toward `paper` (0..255). */
export const SCENE_PAPER_LUMINANCE = 200;
/** Maximum per-pixel saturation for a pixel to count as document paper. */
export const SCENE_PAPER_SATURATION = 0.15;

/**
 * Per-scene enhance patch: the classic five auto-enhance fields plus the
 * vibrance/highlights/shadows the scenes tune individually.
 */
export interface SceneEnhancePatch extends AutoEnhancePatch {
  vibrance: number;
  highlights: number;
  shadows: number;
}

export const SCENE_ENHANCE_KEYS = [
  "exposure",
  "contrast",
  "temperature",
  "tint",
  "saturation",
  "vibrance",
  "highlights",
  "shadows",
] as const;

/** Portrait saturation ceiling: vivid skin must survive the enhance. */
export const SCENE_PORTRAIT_SATURATION_MAX = 8;
/** Portrait contrast ceiling (the base value is also halved). */
export const SCENE_PORTRAIT_CONTRAST_MAX = 18;
/** Portrait vibrance: favors muted colors, sparing already-vivid skin. */
export const SCENE_PORTRAIT_VIBRANCE = 10;
/** Landscape contrast bonus over the base value. */
export const SCENE_LANDSCAPE_CONTRAST_BONUS = 12;
/** Landscape saturation bonus over the base value. */
export const SCENE_LANDSCAPE_SATURATION_BONUS = 8;
/** Landscape vibrance. */
export const SCENE_LANDSCAPE_VIBRANCE = 8;
/** Night exposure ceiling: lifting too far turns night into gray mush. */
export const SCENE_NIGHT_EXPOSURE_MAX = 0.8;
/** Night contrast ceiling. */
export const SCENE_NIGHT_CONTRAST_MAX = 20;
/** Night saturation ceiling. */
export const SCENE_NIGHT_SATURATION_MAX = 10;
/** Night always protects bright lights by at least this much. */
export const SCENE_NIGHT_HIGHLIGHTS = -10;
/** Night always lifts shadows by at least this much. */
export const SCENE_NIGHT_SHADOWS = 10;
/** Document contrast floor: text must stay crisp. */
export const SCENE_DOCUMENT_CONTRAST_MIN = 30;
/** Document shadow lift floor. */
export const SCENE_DOCUMENT_SHADOWS = 10;

/**
 * True for skin-like pixels (portrait cue). A bounded YCrCb-style rule:
 * red-dominant with a moderate red-minus-green gap — near-white paper
 * (tiny gap) and cherry red (huge gap) both fail it.
 */
export function isSkinPixel(r: number, g: number, b: number): boolean {
  if (r <= 95 || g <= 40 || b <= 20) return false;
  if (r <= g || r <= b) return false;
  const redGreen = r - g;
  return redGreen > 12 && redGreen < 110 && r - b > 12;
}

/** Handcrafted classifier features, all 0..1. */
export interface SceneFeatures {
  /** Fraction of pixels darker than SCENE_DARK_THRESHOLD (night cue). */
  dark: number;
  /** Mean Rec.709 luminance / 255. */
  bright: number;
  /** Fraction of skin-like pixels (portrait cue). */
  skin: number;
  /** Fraction of bright low-saturation pixels (document cue). */
  paper: number;
  /** Mean per-pixel saturation (landscape cue). */
  vivid: number;
  /** Fraction of green- or blue-dominant pixels (landscape cue). */
  greenBlue: number;
}

/** Extract classifier features from the 160px analysis image (single pass). */
export function sceneFeatures(image: PixelImage): SceneFeatures {
  assertValidImage(image);
  const pixels = image.width * image.height;
  const { data } = image;
  let dark = 0;
  let luminanceSum = 0;
  let skin = 0;
  let paper = 0;
  let saturationSum = 0;
  let greenBlue = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminanceSum += luminance;
    if (luminance < SCENE_DARK_THRESHOLD) dark += 1;
    if (isSkinPixel(r, g, b)) skin += 1;
    const max = Math.max(r, g, b);
    const saturation = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
    saturationSum += saturation;
    if (luminance > SCENE_PAPER_LUMINANCE && saturation < SCENE_PAPER_SATURATION) paper += 1;
    if ((g > r && g >= b) || (b > r && b > g)) greenBlue += 1;
  }
  return {
    dark: dark / pixels,
    bright: luminanceSum / pixels / 255,
    skin: skin / pixels,
    paper: paper / pixels,
    vivid: saturationSum / pixels,
    greenBlue: greenBlue / pixels,
  };
}

/** One linear head of the softmax classifier: bias + one weight per feature. */
export interface SceneClassWeights {
  bias: number;
  dark: number;
  bright: number;
  skin: number;
  paper: number;
  vivid: number;
  greenBlue: number;
}

/** Full classifier: one head per scene. */
export type SceneWeights = Record<SceneLabel, SceneClassWeights>;

/**
 * Embedded v1 coefficients. Each head rewards its own cues and penalizes the
 * others': skin votes portrait (penalizing vivid/green), colorfulness and
 * green/blue dominance vote landscape, darkness votes night (penalizing
 * brightness), paper brightness votes document (penalizing saturation).
 * Set by inspection against the synthetic fixtures in scene-enhance.test.ts.
 */
export const SCENE_CLASSIFIER_WEIGHTS: SceneWeights = {
  portrait: { bias: -1.5, dark: -2, bright: 0, skin: 6, paper: -4, vivid: -1, greenBlue: -1 },
  landscape: { bias: -1.5, dark: -1, bright: 0, skin: -3, paper: -4, vivid: 3, greenBlue: 2.5 },
  night: { bias: -1, dark: 6, bright: -2, skin: -1, paper: -3, vivid: -1, greenBlue: 0 },
  document: { bias: -1.5, dark: -2, bright: 2, skin: -2, paper: 6, vivid: -3, greenBlue: -1 },
};

const SCENE_WEIGHT_KEYS = ["bias", "dark", "bright", "skin", "paper", "vivid", "greenBlue"] as const;

/**
 * Validate external classifier weights ({portrait, landscape, night,
 * document}, each with bias + six feature weights). Returns the weights or
 * throws RangeError.
 */
export function parseSceneWeights(raw: unknown): SceneWeights {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RangeError("Scene weights must be an object.");
  }
  const v = raw as Record<string, unknown>;
  const weights = {} as SceneWeights;
  for (const scene of SCENE_LABELS) {
    const head = v[scene];
    if (!head || typeof head !== "object" || Array.isArray(head)) {
      throw new RangeError(`Scene weights for "${scene}" must be an object.`);
    }
    const record = head as Record<string, unknown>;
    const parsed = {} as SceneClassWeights;
    for (const key of SCENE_WEIGHT_KEYS) {
      const value = record[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new RangeError(`Scene weight "${scene}.${key}" must be a finite number.`);
      }
      parsed[key] = value;
    }
    weights[scene] = parsed;
  }
  return weights;
}

/** Softmax probability per scene; sums to 1. */
export type SceneScores = Record<SceneLabel, number>;

/** Softmax over the four linear heads. */
export function sceneScores(
  features: SceneFeatures,
  weights: SceneWeights = SCENE_CLASSIFIER_WEIGHTS,
): SceneScores {
  const logits = SCENE_LABELS.map((scene) => {
    const head = weights[scene];
    return (
      head.bias +
      head.dark * features.dark +
      head.bright * features.bright +
      head.skin * features.skin +
      head.paper * features.paper +
      head.vivid * features.vivid +
      head.greenBlue * features.greenBlue
    );
  });
  // Shift by the max logit so exp() cannot overflow.
  const shift = Math.max(...logits);
  const exps = logits.map((logit) => Math.exp(logit - shift));
  const total = exps.reduce((a, b) => a + b, 0);
  const scores = {} as SceneScores;
  SCENE_LABELS.forEach((scene, index) => {
    scores[scene] = (exps[index] ?? 0) / total;
  });
  return scores;
}

export interface ScenePrediction {
  /** Winning scene: the argmax of the softmax scores. */
  scene: SceneLabel;
  /** Softmax probability of the winning scene (0..1). */
  confidence: number;
  scores: SceneScores;
}

/** Classify precomputed features (the classifier contract, decoupled from pixels). */
export function classifySceneFeatures(
  features: SceneFeatures,
  weights: SceneWeights = SCENE_CLASSIFIER_WEIGHTS,
): ScenePrediction {
  const scores = sceneScores(features, weights);
  let scene: SceneLabel = SCENE_LABELS[0]!;
  for (const candidate of SCENE_LABELS) {
    if ((scores[candidate] ?? 0) > (scores[scene] ?? 0)) scene = candidate;
  }
  return { scene, confidence: scores[scene] ?? 0, scores };
}

/** Classify an analysis image: features → softmax → argmax scene. */
export function classifyScene(
  image: PixelImage,
  weights: SceneWeights = SCENE_CLASSIFIER_WEIGHTS,
): ScenePrediction {
  return classifySceneFeatures(sceneFeatures(image), weights);
}

/**
 * Map a base enhance patch to per-scene parameters:
 * - portrait protects skin tones: saturation and contrast are capped low and
 *   vibrance (which spares already-vivid colors) carries the color instead;
 * - landscape allows stronger contrast and saturation;
 * - night caps the lift (exposure/contrast/saturation) so night stays night,
 *   while protecting bright lights and lifting shadows;
 * - document neutralizes color (zero saturation/vibrance, neutral white
 *   balance) and guarantees crisp contrast.
 */
export function sceneEnhancePatch(scene: SceneLabel, base: SceneEnhancePatch): SceneEnhancePatch {
  switch (scene) {
    case "portrait":
      return {
        ...base,
        contrast: Math.min(SCENE_PORTRAIT_CONTRAST_MAX, Math.max(0, Math.round(base.contrast * 0.5))),
        saturation: Math.min(SCENE_PORTRAIT_SATURATION_MAX, Math.max(0, base.saturation)),
        vibrance: SCENE_PORTRAIT_VIBRANCE,
      };
    case "landscape":
      return {
        ...base,
        contrast: Math.min(100, base.contrast + SCENE_LANDSCAPE_CONTRAST_BONUS),
        saturation: Math.min(100, base.saturation + SCENE_LANDSCAPE_SATURATION_BONUS),
        vibrance: SCENE_LANDSCAPE_VIBRANCE,
      };
    case "night":
      return {
        ...base,
        exposure: Math.round(Math.min(SCENE_NIGHT_EXPOSURE_MAX, Math.max(-3, base.exposure)) * 100) / 100,
        contrast: Math.min(SCENE_NIGHT_CONTRAST_MAX, Math.max(0, base.contrast)),
        saturation: Math.min(SCENE_NIGHT_SATURATION_MAX, Math.max(0, base.saturation)),
        vibrance: 0,
        highlights: Math.min(base.highlights, SCENE_NIGHT_HIGHLIGHTS),
        shadows: Math.max(base.shadows, SCENE_NIGHT_SHADOWS),
      };
    case "document":
      return {
        ...base,
        exposure: Math.round(Math.max(0, Math.min(3, base.exposure)) * 100) / 100,
        contrast: Math.max(SCENE_DOCUMENT_CONTRAST_MIN, Math.min(100, base.contrast)),
        temperature: 5500,
        tint: 0,
        saturation: 0,
        vibrance: 0,
        highlights: 0,
        shadows: Math.max(base.shadows, SCENE_DOCUMENT_SHADOWS),
      };
  }
}

export interface SceneAwareEnhance {
  scene: SceneLabel;
  confidence: number;
  scores: SceneScores;
  patch: SceneEnhancePatch;
}

/**
 * Classify the analysis image and derive its per-scene enhance patch. The
 * base patch reuses the classic estimators (computeAutoEnhance for the five
 * tonal fields, computeLightnessAuto for highlights/shadows); the scene
 * mapping then reshapes it. Carries only the eight patch fields, never
 * geometry or retouch state.
 */
export function computeSceneAwareEnhance(
  image: PixelImage,
  weights: SceneWeights = SCENE_CLASSIFIER_WEIGHTS,
): SceneAwareEnhance {
  assertValidImage(image);
  const { scene, confidence, scores } = classifyScene(image, weights);
  const base = computeAutoEnhance(image);
  const { highlights, shadows } = computeLightnessAuto(image);
  const patch = sceneEnhancePatch(scene, { ...base, vibrance: 0, highlights, shadows });
  return { scene, confidence, scores, patch };
}
