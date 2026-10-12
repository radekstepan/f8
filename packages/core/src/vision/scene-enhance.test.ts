import { describe, expect, it } from "vitest";
import {
  SCENE_CLASSIFIER_WEIGHTS,
  SCENE_DISPLAY_NAMES,
  SCENE_ENHANCE_KEYS,
  SCENE_LABELS,
  SCENE_MODEL_ID,
  SCENE_MODEL_VERSION,
  classifyScene,
  classifySceneFeatures,
  computeSceneAwareEnhance,
  isSkinPixel,
  parseSceneWeights,
  sceneEnhancePatch,
  sceneFeatures,
  sceneScores,
  type SceneEnhancePatch,
  type SceneFeatures,
  type SceneWeights,
} from "./scene-enhance.js";
import { goldenPhoto, horizontalGradient, solidColor } from "./fixtures.js";

// Scene prototypes: solid colors chosen so each classifier cue fires alone.
const PORTRAIT = () => solidColor(32, 32, 210, 150, 120);
const LANDSCAPE = () => solidColor(32, 32, 60, 140, 70);
const NIGHT = () => solidColor(32, 32, 12, 14, 20);
const DOCUMENT = () => solidColor(32, 32, 245, 244, 240);

const vividBase: SceneEnhancePatch = {
  exposure: 1.5,
  contrast: 40,
  temperature: 6200,
  tint: 12,
  saturation: 25,
  vibrance: 0,
  highlights: -30,
  shadows: 20,
};

describe("isSkinPixel", () => {
  it("accepts typical skin tones", () => {
    expect(isSkinPixel(210, 150, 120)).toBe(true);
    expect(isSkinPixel(180, 120, 80)).toBe(true);
    expect(isSkinPixel(150, 100, 75)).toBe(true);
  });

  it("rejects near-white paper, foliage, night, and pure red", () => {
    expect(isSkinPixel(245, 244, 240)).toBe(false);
    expect(isSkinPixel(60, 140, 70)).toBe(false);
    expect(isSkinPixel(12, 14, 20)).toBe(false);
    expect(isSkinPixel(230, 40, 40)).toBe(false);
  });
});

describe("sceneFeatures", () => {
  it("reports skin on the portrait prototype only", () => {
    expect(sceneFeatures(PORTRAIT()).skin).toBe(1);
    expect(sceneFeatures(LANDSCAPE()).skin).toBe(0);
    expect(sceneFeatures(DOCUMENT()).skin).toBe(0);
  });

  it("reports paper on the document prototype only", () => {
    expect(sceneFeatures(DOCUMENT()).paper).toBe(1);
    expect(sceneFeatures(PORTRAIT()).paper).toBe(0);
    expect(sceneFeatures(NIGHT()).paper).toBe(0);
  });

  it("reports dark on the night prototype only", () => {
    expect(sceneFeatures(NIGHT()).dark).toBe(1);
    expect(sceneFeatures(PORTRAIT()).dark).toBe(0);
    expect(sceneFeatures(DOCUMENT()).dark).toBe(0);
  });

  it("reports green/blue dominance and colorfulness on the landscape prototype", () => {
    const landscape = sceneFeatures(LANDSCAPE());
    expect(landscape.greenBlue).toBe(1);
    expect(landscape.vivid).toBeGreaterThan(0.5);
    expect(sceneFeatures(PORTRAIT()).greenBlue).toBe(0);
    expect(sceneFeatures(DOCUMENT()).vivid).toBeLessThan(0.05);
  });

  it("keeps every feature in 0..1", () => {
    for (const image of [PORTRAIT(), LANDSCAPE(), NIGHT(), DOCUMENT(), horizontalGradient(64, 8)]) {
      for (const value of Object.values(sceneFeatures(image))) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("sceneScores / classifySceneFeatures (classifier contract)", () => {
  const neutral: SceneFeatures = { dark: 0, bright: 0.5, skin: 0, paper: 0, vivid: 0, greenBlue: 0 };

  it("sums to 1 with every score in 0..1", () => {
    const scores = sceneScores(neutral);
    expect(Object.keys(scores).sort()).toEqual([...SCENE_LABELS].sort());
    for (const value of Object.values(scores)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
    expect(Object.values(scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("picks the argmax scene with matching confidence", () => {
    const prediction = classifySceneFeatures({ ...neutral, skin: 1, vivid: 0.43, bright: 0.63 });
    expect(prediction.scene).toBe("portrait");
    expect(prediction.confidence).toBe(prediction.scores.portrait);
    expect(prediction.confidence).toBeGreaterThan(0.9);
  });

  it("classifies each cue combination without touching pixels", () => {
    expect(classifySceneFeatures({ ...neutral, greenBlue: 1, vivid: 0.57 }).scene).toBe("landscape");
    expect(classifySceneFeatures({ ...neutral, dark: 1, bright: 0.05, vivid: 0.4 }).scene).toBe("night");
    expect(classifySceneFeatures({ ...neutral, paper: 1, bright: 0.96, vivid: 0.02 }).scene).toBe("document");
  });

  it("honors injected weights (fitted-replacement contract)", () => {
    const flipped: SceneWeights = {
      ...SCENE_CLASSIFIER_WEIGHTS,
      portrait: { ...SCENE_CLASSIFIER_WEIGHTS.portrait, skin: -6 },
      landscape: { ...SCENE_CLASSIFIER_WEIGHTS.landscape, bias: 10 },
    };
    expect(classifySceneFeatures({ ...neutral, skin: 1 }, flipped).scene).not.toBe("portrait");
    expect(classifySceneFeatures(neutral, flipped).scene).toBe("landscape");
  });
});

describe("classifyScene", () => {
  it("classifies each pixel prototype to its scene, confidently", () => {
    expect(classifyScene(PORTRAIT()).scene).toBe("portrait");
    expect(classifyScene(LANDSCAPE()).scene).toBe("landscape");
    expect(classifyScene(NIGHT()).scene).toBe("night");
    expect(classifyScene(DOCUMENT()).scene).toBe("document");
    for (const image of [PORTRAIT(), LANDSCAPE(), NIGHT(), DOCUMENT()]) {
      expect(classifyScene(image).confidence).toBeGreaterThan(0.9);
    }
  });

  it("exposes the model identity", () => {
    expect(SCENE_MODEL_ID).toBe("scene-logreg");
    expect(SCENE_MODEL_VERSION).toBe("v1");
    expect(SCENE_LABELS).toEqual(["portrait", "landscape", "night", "document"]);
    expect(SCENE_DISPLAY_NAMES.portrait).toBe("Portrait");
  });
});

describe("parseSceneWeights", () => {
  it("accepts the embedded weights round-tripped through JSON", () => {
    expect(parseSceneWeights(JSON.parse(JSON.stringify(SCENE_CLASSIFIER_WEIGHTS)))).toEqual(
      SCENE_CLASSIFIER_WEIGHTS,
    );
  });

  it("rejects non-objects, missing scenes, and non-finite weights", () => {
    expect(() => parseSceneWeights(null)).toThrow(RangeError);
    expect(() => parseSceneWeights({})).toThrow(RangeError);
    const missing = { ...SCENE_CLASSIFIER_WEIGHTS } as Record<string, unknown>;
    delete missing.night;
    expect(() => parseSceneWeights(missing)).toThrow(RangeError);
    expect(() =>
      parseSceneWeights({
        ...SCENE_CLASSIFIER_WEIGHTS,
        night: { ...SCENE_CLASSIFIER_WEIGHTS.night, dark: Number.NaN },
      }),
    ).toThrow(RangeError);
  });
});

describe("sceneEnhancePatch (scene to params mapping)", () => {
  it("protects skin tones on portraits: capped saturation/contrast, vibrance instead", () => {
    const patch = sceneEnhancePatch("portrait", vividBase);
    expect(patch.saturation).toBeLessThanOrEqual(8);
    expect(patch.saturation).toBeLessThan(vividBase.saturation);
    expect(patch.contrast).toBeLessThanOrEqual(18);
    expect(patch.contrast).toBeLessThan(vividBase.contrast);
    // Vibrance favors muted colors and spares vivid skin (see adjustments.ts),
    // so portraits get color from vibrance, not saturation.
    expect(patch.vibrance).toBe(10);
    expect(patch.vibrance).toBeGreaterThan(patch.saturation);
  });

  it("allows stronger contrast and saturation on landscapes", () => {
    const patch = sceneEnhancePatch("landscape", vividBase);
    expect(patch.contrast).toBe(vividBase.contrast + 12);
    expect(patch.saturation).toBe(vividBase.saturation + 8);
    expect(patch.contrast).toBeGreaterThan(sceneEnhancePatch("portrait", vividBase).contrast);
    expect(patch.saturation).toBeGreaterThan(sceneEnhancePatch("portrait", vividBase).saturation);
  });

  it("caps the night lift so night stays night, guarding lights and shadows", () => {
    const patch = sceneEnhancePatch("night", vividBase);
    expect(patch.exposure).toBeLessThanOrEqual(0.8);
    expect(patch.contrast).toBeLessThanOrEqual(20);
    expect(patch.saturation).toBeLessThanOrEqual(10);
    expect(patch.vibrance).toBe(0);
    expect(patch.highlights).toBeLessThanOrEqual(-10);
    expect(patch.shadows).toBeGreaterThanOrEqual(10);
  });

  it("neutralizes documents: no color, neutral white balance, crisp contrast", () => {
    const patch = sceneEnhancePatch("document", vividBase);
    expect(patch.saturation).toBe(0);
    expect(patch.vibrance).toBe(0);
    expect(patch.temperature).toBe(5500);
    expect(patch.tint).toBe(0);
    expect(patch.contrast).toBeGreaterThanOrEqual(30);
    expect(patch.exposure).toBeGreaterThanOrEqual(0);
    expect(patch.highlights).toBe(0);
  });

  it("stays mute on neutral input: portrait never invents color, night never darkens lift-free bases", () => {
    const gray: SceneEnhancePatch = {
      exposure: 0,
      contrast: 0,
      temperature: 5500,
      tint: 0,
      saturation: 0,
      vibrance: 0,
      highlights: 0,
      shadows: 0,
    };
    expect(sceneEnhancePatch("portrait", gray).saturation).toBe(0);
    expect(sceneEnhancePatch("night", { ...gray, exposure: 0 }).exposure).toBe(0);
    expect(sceneEnhancePatch("document", gray).contrast).toBe(30);
  });
});

describe("computeSceneAwareEnhance", () => {
  it("carries only the eight patch fields, never geometry or retouch state", () => {
    const result = computeSceneAwareEnhance(PORTRAIT());
    expect(Object.keys(result.patch).sort()).toEqual([...SCENE_ENHANCE_KEYS].sort());
  });

  it("pairs each prototype with its scene and scene-shaped params", () => {
    const portrait = computeSceneAwareEnhance(PORTRAIT());
    expect(portrait.scene).toBe("portrait");
    expect(portrait.patch.saturation).toBeLessThanOrEqual(8);
    const landscape = computeSceneAwareEnhance(LANDSCAPE());
    expect(landscape.scene).toBe("landscape");
    expect(landscape.patch.contrast).toBeGreaterThan(portrait.patch.contrast);
    const night = computeSceneAwareEnhance(NIGHT());
    expect(night.scene).toBe("night");
    expect(night.patch.exposure).toBeLessThanOrEqual(0.8);
    const document = computeSceneAwareEnhance(DOCUMENT());
    expect(document.scene).toBe("document");
    expect(document.patch.saturation).toBe(0);
  });

  it("matches the recorded scene and patch for the fixture photo", () => {
    const result = computeSceneAwareEnhance(goldenPhoto());
    // Warm cast + mid luminance reads as a portrait at good (not certain)
    // confidence; the patch keeps the classic exposure/WB and reshapes the
    // rest through the portrait mapping (halved contrast, vibrance for color).
    expect(result.scene).toBe("portrait");
    expect(result.confidence).toBeCloseTo(0.861, 3);
    expect(result.confidence).toBe(result.scores[result.scene]);
    expect(result.patch.exposure).toBeCloseTo(0.55, 2);
    expect(result.patch.contrast).toBe(8);
    expect(result.patch.saturation).toBe(0);
    expect(result.patch.vibrance).toBe(10);
  });
});
