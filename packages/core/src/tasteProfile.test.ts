import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import { pushEnhanceAction } from "./actionStack.js";
import type { EditState } from "./types.js";
import {
  MAX_TASTE_SAMPLES,
  MIN_TASTE_KEY_PHOTOS,
  MIN_TASTE_PHOTOS,
  TASTE_KEYS,
  createTasteProfile,
  forgetTasteSample,
  isPureAutoStack,
  parseTasteProfile,
  parseTasteProfileJson,
  recordTasteSample,
  sampleTasteFromEdit,
  serializeTasteProfile,
  snapTasteValue,
  summarizeTaste,
  tasteEnhancePatch,
  tasteKeyThreshold,
  tasteProfileFromSeed,
} from "./tasteProfile.js";

const edit = (patch: Partial<EditState>): EditState => ({ ...DEFAULT_EDIT, ...patch });

const AT = "2026-10-15T10:00:00.000Z";

describe("sampleTasteFromEdit", () => {
  it("extracts only non-default learned keys", () => {
    expect(sampleTasteFromEdit(edit({ exposure: 0.5, contrast: 20 }))).toEqual({
      values: { exposure: 0.5, contrast: 20 },
    });
  });

  it("returns null for a default recipe", () => {
    expect(sampleTasteFromEdit(edit({}))).toBeNull();
  });

  it("ignores geometry, retouching, labels, and structured state", () => {
    const sample = sampleTasteFromEdit(
      edit({
        rotation: 90,
        straighten: 2,
        cropRatio: "1:1",
        retouches: [{ x: 1, y: 1, size: 5, strength: 50, kind: "repair" }],
        preset: "Vivid",
        autoEnhanced: true,
        blackAndWhite: true,
        curvePoints: [{ x: 0.5, y: 0.6 }],
        selectiveColor: [{ range: "reds", hue: 10, saturation: 0, luminance: 0 }],
        denoise: { strength: 40, auto: true, source: "onnx" },
      }),
    );
    expect(sample).toBeNull();
  });

  it("learns every slider in TASTE_KEYS", () => {
    expect(TASTE_KEYS).toHaveLength(17);
    for (const key of TASTE_KEYS) {
      const value = key === "temperature" ? 6000 : key === "exposure" ? 0.25 : 10;
      const sample = sampleTasteFromEdit(edit({ [key]: value } as Partial<EditState>));
      expect(sample?.values[key], key).toBe(value);
    }
  });
});

describe("isPureAutoStack", () => {
  it("flags a pure enhance entry of any mode", () => {
    for (const mode of ["classic", "scene", "taste"] as const) {
      const stack = pushEnhanceAction([], mode, edit({}), AT);
      expect(isPureAutoStack(stack), mode).toBe(true);
    }
  });

  it("passes empty, missing, and hand-tweaked stacks", () => {
    expect(isPureAutoStack([])).toBe(false);
    expect(isPureAutoStack(null)).toBe(false);
    expect(isPureAutoStack(undefined)).toBe(false);
    const stack = pushEnhanceAction([], "classic", edit({}), AT).map((entry) => ({ ...entry, pure: false }));
    expect(isPureAutoStack(stack)).toBe(false);
  });
});

describe("recordTasteSample", () => {
  it("adds a sample and stamps the time", () => {
    const next = recordTasteSample(createTasteProfile(), "p1", { values: { contrast: 20 } }, AT);
    expect(next.samples.p1).toEqual({ values: { contrast: 20 } });
    expect(next.updatedAt).toBe(AT);
  });

  it("replaces a photo's sample instead of double-counting it", () => {
    let profile = recordTasteSample(createTasteProfile(), "p1", { values: { contrast: 20 } }, AT);
    profile = recordTasteSample(profile, "p1", { values: { contrast: 30 } }, "2026-10-16T10:00:00.000Z");
    expect(Object.keys(profile.samples)).toEqual(["p1"]);
    expect(profile.samples.p1).toEqual({ values: { contrast: 30 } });
  });

  it("drops the sample when the recipe returns to defaults", () => {
    let profile = recordTasteSample(createTasteProfile(), "p1", { values: { contrast: 20 } }, AT);
    profile = recordTasteSample(profile, "p1", null, AT);
    expect(profile.samples).toEqual({});
  });

  it("returns the input untouched when nothing changes", () => {
    const profile = recordTasteSample(createTasteProfile("old"), "p1", { values: { contrast: 20 } }, AT);
    expect(recordTasteSample(profile, "p1", { values: { contrast: 20 } }, "later")).toBe(profile);
    expect(recordTasteSample(profile, "missing", null, "later")).toBe(profile);
  });

  it("caps stored samples, oldest-inserted first", () => {
    let profile = createTasteProfile();
    for (let i = 0; i < MAX_TASTE_SAMPLES + 5; i += 1) {
      profile = recordTasteSample(profile, `p${i}`, { values: { contrast: 1 } }, AT);
    }
    expect(Object.keys(profile.samples)).toHaveLength(MAX_TASTE_SAMPLES);
    expect(profile.samples.p0).toBeUndefined();
    expect(profile.samples[`p${MAX_TASTE_SAMPLES + 4}`]).toBeDefined();
  });

  it("forgetTasteSample removes one photo", () => {
    let profile = recordTasteSample(createTasteProfile(), "p1", { values: { contrast: 20 } }, AT);
    profile = recordTasteSample(profile, "p2", { values: { contrast: 10 } }, AT);
    profile = forgetTasteSample(profile, "p1", AT);
    expect(Object.keys(profile.samples)).toEqual(["p2"]);
  });
});

describe("tasteKeyThreshold", () => {
  it("requires at least half the photos, never below the floor", () => {
    expect(tasteKeyThreshold(1)).toBe(MIN_TASTE_KEY_PHOTOS);
    expect(tasteKeyThreshold(3)).toBe(2);
    expect(tasteKeyThreshold(4)).toBe(2);
    expect(tasteKeyThreshold(5)).toBe(3);
    expect(tasteKeyThreshold(10)).toBe(5);
  });
});

describe("snapTasteValue", () => {
  it("snaps temperature to 50K and exposure to 0.01 EV", () => {
    expect(snapTasteValue("temperature", 5824)).toBe(5800);
    expect(snapTasteValue("exposure", 0.074)).toBe(0.07);
    expect(snapTasteValue("contrast", 12.6)).toBe(13);
  });

  it("clamps to the slider range", () => {
    expect(snapTasteValue("contrast", 500)).toBe(100);
    expect(snapTasteValue("sharpness", -5)).toBe(0);
    expect(snapTasteValue("temperature", 50000)).toBe(10000);
  });
});

function profileFromPhotos(edits: Array<Partial<EditState>>): ReturnType<typeof createTasteProfile> {
  let profile = createTasteProfile();
  edits.forEach((patch, index) => {
    profile = recordTasteSample(profile, `p${index}`, sampleTasteFromEdit(edit(patch)), AT);
  });
  return profile;
}

describe("summarizeTaste", () => {
  it("is empty for an empty profile", () => {
    expect(summarizeTaste(createTasteProfile())).toEqual({ photos: 0, keys: {} });
  });

  it("takes the median over touching photos and counts them", () => {
    const summary = summarizeTaste(profileFromPhotos([{ contrast: 10 }, { contrast: 20 }, { contrast: 30 }]));
    expect(summary.photos).toBe(3);
    expect(summary.keys.contrast).toEqual({ median: 20, count: 3 });
  });

  it("resists outliers: one extreme edit cannot drag the median", () => {
    const summary = summarizeTaste(profileFromPhotos([{ contrast: 12 }, { contrast: 14 }, { contrast: 100 }]));
    expect(summary.keys.contrast?.median).toBe(14);
  });

  it("drops keys touched by fewer than half the photos", () => {
    const summary = summarizeTaste(
      profileFromPhotos([{ contrast: 20 }, { contrast: 20 }, { contrast: 20 }, { saturation: 40 }, { saturation: 40 }]),
    );
    expect(summary.photos).toBe(5);
    expect(summary.keys.contrast).toBeDefined();
    // 2 of 5 is below the majority threshold of 3.
    expect(summary.keys.saturation).toBeUndefined();
  });

  it("drops keys whose median lands back on the default", () => {
    const summary = summarizeTaste(
      profileFromPhotos([
        { tint: -2, contrast: 5 },
        { tint: 2, contrast: 5 },
        { contrast: 5 },
      ]),
    );
    expect(summary.keys.tint).toBeUndefined();
    expect(summary.keys.contrast).toEqual({ median: 5, count: 3 });
  });
});

describe("tasteEnhancePatch", () => {
  it("needs at least three edited photos", () => {
    expect(MIN_TASTE_PHOTOS).toBe(3);
    expect(tasteEnhancePatch(profileFromPhotos([{ contrast: 20 }, { contrast: 20 }]))).toBeNull();
    expect(tasteEnhancePatch(profileFromPhotos([{ contrast: 20 }, { contrast: 20 }, { contrast: 20 }]))).toEqual({
      contrast: 20,
    });
  });

  it("stays null when no key shows a consistent habit", () => {
    // Three photos, three different single-key edits: nothing reaches the threshold of 2.
    const patch = tasteEnhancePatch(profileFromPhotos([{ contrast: 20 }, { saturation: 20 }, { exposure: 0.5 }]));
    expect(patch).toBeNull();
  });

  it("carries every qualifying key, snapped to slider steps", () => {
    const patch = tasteEnhancePatch(
      profileFromPhotos([
        { temperature: 5800, exposure: 0.2, contrast: 10 },
        { temperature: 5900, exposure: 0.3, contrast: 20 },
        { temperature: 5850, exposure: 0.25, contrast: 30 },
      ]),
    );
    expect(patch).toEqual({ temperature: 5850, exposure: 0.25, contrast: 20 });
  });
});

describe("taste profile persistence", () => {
  it("round-trips through JSON", () => {
    const profile = profileFromPhotos([{ contrast: 20 }, { contrast: 30 }]);
    expect(parseTasteProfileJson(serializeTasteProfile(profile))).toEqual(profile);
  });

  it("never throws: garbage in, empty profile out", () => {
    for (const raw of [null, undefined, "", "not json", "[]", '"x"', "42"]) {
      expect(parseTasteProfileJson(raw)).toEqual(createTasteProfile());
    }
    for (const value of [null, 42, "x", [], { version: 2, samples: {} }, { version: 1 }, { version: 1, samples: [] }]) {
      expect(parseTasteProfile(value)).toEqual(createTasteProfile());
    }
  });

  it("drops unknown keys, non-numeric values, and empty samples", () => {
    const profile = parseTasteProfile({
      version: 1,
      updatedAt: AT,
      samples: {
        p1: { values: { contrast: 20, bogus: 5, exposure: "hot" } },
        p2: { values: {} },
        p3: null,
        "": { values: { contrast: 1 } },
      },
    });
    expect(profile.samples).toEqual({ p1: { values: { contrast: 20 } } });
    expect(profile.updatedAt).toBe(AT);
  });

  it("clamps out-of-range stored values to the slider range", () => {
    const profile = parseTasteProfile({ version: 1, samples: { p1: { values: { contrast: 500, temperature: 5833 } } } });
    expect(profile.samples.p1).toEqual({ values: { contrast: 100, temperature: 5850 } });
  });
});

describe("tasteProfileFromSeed", () => {
  it("learns from saved human recipes and skips pure-auto ones", () => {
    const human = { past: [], present: edit({ contrast: 20 }), future: [] };
    const auto = { past: [], present: edit({ exposure: 0.22, clarity: 12 }), future: [] };
    const seed = {
      histories: { p1: human, p2: human, p3: human, p4: auto },
      actions: { p4: pushEnhanceAction([], "classic", edit({}), AT) },
    };
    const profile = tasteProfileFromSeed(seed, AT);
    expect(Object.keys(profile.samples).sort()).toEqual(["p1", "p2", "p3"]);
    expect(profile.updatedAt).toBe(AT);
  });

  it("skips default recipes and tolerates malformed seed entries", () => {
    const seed = {
      histories: { p1: { past: [], present: edit({}), future: [] }, p2: null, p3: { past: [] } },
      actions: {},
    };
    expect(tasteProfileFromSeed(seed as never, AT).samples).toEqual({});
  });
});
