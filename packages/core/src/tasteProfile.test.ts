import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import { pushEnhanceAction } from "./actionStack.js";
import type { EditState } from "./types.js";
import {
  MAX_TASTE_SAMPLES,
  MIN_TASTE_KEY_PHOTOS,
  MIN_TASTE_PHOTOS,
  TASTE_KEYS,
  TASTE_PROFILE_VERSION,
  createTasteProfile,
  forgetTasteSample,
  isPureAutoStack,
  normalizeTasteLabel,
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
  topTasteLabel,
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

  it("tags the sample with the subject label, normalized", () => {
    expect(sampleTasteFromEdit(edit({ contrast: 20 }), "Grapes")?.label).toBe("grapes");
    expect(sampleTasteFromEdit(edit({ contrast: 20 }), "  GRAPES  ")?.label).toBe("grapes");
  });

  it("leaves the sample untagged for a blank or missing label", () => {
    expect(sampleTasteFromEdit(edit({ contrast: 20 }), null)).toEqual({ values: { contrast: 20 } });
    expect(sampleTasteFromEdit(edit({ contrast: 20 }), "   ")).toEqual({ values: { contrast: 20 } });
  });
});

describe("topTasteLabel", () => {
  it("picks the highest-scoring ML label", () => {
    expect(
      topTasteLabel([
        { label: "fruit", score: 0.2, source: "ml" },
        { label: "grapes", score: 0.31, source: "ml" },
      ]),
    ).toBe("grapes");
  });

  it("ignores hand-added labels even though they score 1", () => {
    expect(
      topTasteLabel([
        { label: "wedding", score: 1, source: "user" },
        { label: "portrait", score: 0.28, source: "ml" },
      ]),
    ).toBe("portrait");
    expect(topTasteLabel([{ label: "wedding", score: 1, source: "user" }])).toBeNull();
  });

  it("returns null without usable ML labels", () => {
    expect(topTasteLabel(null)).toBeNull();
    expect(topTasteLabel(undefined)).toBeNull();
    expect(topTasteLabel([])).toBeNull();
    expect(topTasteLabel([{ label: "   ", score: 0.5, source: "ml" }])).toBeNull();
  });

  it("normalizes the winning tag", () => {
    expect(normalizeTasteLabel("  Grapes ")).toBe("grapes");
    expect(normalizeTasteLabel("")).toBeNull();
    expect(normalizeTasteLabel(42)).toBeNull();
    expect(topTasteLabel([{ label: "Grapes", score: 0.3, source: "ml" }])).toBe("grapes");
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

  it("canonicalizes the stored subject tag", () => {
    const profile = recordTasteSample(createTasteProfile(), "p1", { values: { contrast: 20 }, label: "  Grapes " }, AT);
    expect(profile.samples.p1).toEqual({ values: { contrast: 20 }, label: "grapes" });
  });

  it("treats a subject retag as a real change", () => {
    const profile = recordTasteSample(createTasteProfile(), "p1", { values: { contrast: 20 }, label: "grapes" }, AT);
    expect(recordTasteSample(profile, "p1", { values: { contrast: 20 }, label: "Grapes" }, "later")).toBe(profile);
    const relabeled = recordTasteSample(profile, "p1", { values: { contrast: 20 }, label: "fruit" }, "later");
    expect(relabeled).not.toBe(profile);
    expect(relabeled.samples.p1?.label).toBe("fruit");
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

function profileFromPhotos(
  edits: Array<Partial<EditState>>,
  labels?: Array<string | null>,
): ReturnType<typeof createTasteProfile> {
  let profile = createTasteProfile();
  edits.forEach((patch, index) => {
    profile = recordTasteSample(profile, `p${index}`, sampleTasteFromEdit(edit(patch), labels?.[index] ?? null), AT);
  });
  return profile;
}

describe("summarizeTaste", () => {
  it("is empty for an empty profile", () => {
    expect(summarizeTaste(createTasteProfile())).toEqual({ photos: 0, keys: {}, scope: "global", label: null });
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

describe("summarizeTaste conditional scope", () => {
  // Three grape photos warmed and lifted, three portraits cooled: two
  // subjects, two styles, one profile.
  const GRAPES = [{ temperature: 6200 }, { temperature: 6300 }, { temperature: 6250 }];
  const PORTRAITS = [{ temperature: 5000 }, { temperature: 5100 }, { temperature: 5050 }];

  function twoSubjectProfile() {
    return profileFromPhotos(
      [...GRAPES, ...PORTRAITS],
      ["grapes", "grapes", "grapes", "portrait", "portrait", "portrait"],
    );
  }

  it("summarizes the matching subject alone once it has three photos", () => {
    const summary = summarizeTaste(twoSubjectProfile(), "grapes");
    expect(summary.scope).toBe("label");
    expect(summary.label).toBe("grapes");
    expect(summary.photos).toBe(3);
    expect(summary.keys.temperature).toEqual({ median: 6250, count: 3 });
  });

  it("gives each subject its own medians", () => {
    const profile = twoSubjectProfile();
    expect(summarizeTaste(profile, "portrait").keys.temperature?.median).toBe(5050);
    expect(summarizeTaste(profile, "grapes").keys.temperature?.median).toBe(6250);
    // The global medians sit between the two subjects — neither's style.
    expect(summarizeTaste(profile).keys.temperature?.median).toBe(5650);
  });

  it("normalizes the requested tag before matching", () => {
    const summary = summarizeTaste(twoSubjectProfile(), "  GRAPES ");
    expect(summary.scope).toBe("label");
    expect(summary.label).toBe("grapes");
    expect(summary.photos).toBe(3);
  });

  it("falls back to global while the subject has fewer than three photos", () => {
    const profile = profileFromPhotos([{ contrast: 20 }, { contrast: 20 }, { contrast: 20 }], [
      "grapes",
      "grapes",
      "portrait",
    ]);
    const summary = summarizeTaste(profile, "grapes");
    expect(summary.scope).toBe("global");
    expect(summary.photos).toBe(3);
    expect(summary.keys.contrast).toEqual({ median: 20, count: 3 });
  });

  it("falls back to global for an unknown subject or no tag", () => {
    const profile = twoSubjectProfile();
    for (const label of ["mountain", "", "   ", null, undefined]) {
      const summary = summarizeTaste(profile, label);
      expect(summary.scope, String(label)).toBe("global");
      expect(summary.photos, String(label)).toBe(6);
    }
  });

  it("excludes untagged samples from the subject scope, keeps them global", () => {
    const profile = profileFromPhotos(
      [{ contrast: 10 }, { contrast: 20 }, { contrast: 30 }, { contrast: 100 }],
      ["grapes", "grapes", "grapes", null],
    );
    const subject = summarizeTaste(profile, "grapes");
    expect(subject.scope).toBe("label");
    expect(subject.photos).toBe(3);
    expect(subject.keys.contrast).toEqual({ median: 20, count: 3 });
    expect(summarizeTaste(profile).keys.contrast?.median).toBe(25);
  });

  it("stays keyless in subject scope instead of borrowing the global style", () => {
    // Three grape photos with no shared habit, three portraits with one:
    // the grape summary must not borrow the portrait contrast.
    const profile = profileFromPhotos(
      [{ saturation: 10 }, { vibrance: 10 }, { clarity: 10 }, { contrast: 40 }, { contrast: 40 }, { contrast: 40 }],
      ["grapes", "grapes", "grapes", "portrait", "portrait", "portrait"],
    );
    const subject = summarizeTaste(profile, "grapes");
    expect(subject.scope).toBe("label");
    expect(subject.photos).toBe(3);
    expect(subject.keys).toEqual({});
  });

  it("applies the majority rule within the subject, not the library", () => {
    // Saturation touched on 2 of 3 grape photos but only 2 of 6 overall:
    // a subject habit even though it is a global minority.
    const profile = profileFromPhotos(
      [
        { saturation: 30 },
        { saturation: 40 },
        { contrast: 10 },
        { contrast: 10 },
        { contrast: 10 },
        { contrast: 10 },
      ],
      ["grapes", "grapes", "grapes", "portrait", "portrait", "portrait"],
    );
    expect(summarizeTaste(profile, "grapes").keys.saturation).toEqual({ median: 35, count: 2 });
    expect(summarizeTaste(profile).keys.saturation).toBeUndefined();
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

  it("generalizes one style across similar photos, another across the rest", () => {
    const profile = profileFromPhotos(
      [
        { temperature: 6200, contrast: 30 },
        { temperature: 6300, contrast: 30 },
        { temperature: 6250, contrast: 30 },
        { temperature: 5000, contrast: -10 },
        { temperature: 5100, contrast: -10 },
        { temperature: 5050, contrast: -10 },
      ],
      ["grapes", "grapes", "grapes", "portrait", "portrait", "portrait"],
    );
    expect(tasteEnhancePatch(profile, "grapes")).toEqual({ temperature: 6250, contrast: 30 });
    expect(tasteEnhancePatch(profile, "portrait")).toEqual({ temperature: 5050, contrast: -10 });
  });

  it("falls back to the global patch for a subject with too little evidence", () => {
    const profile = profileFromPhotos([{ contrast: 20 }, { contrast: 20 }, { contrast: 20 }], [
      "grapes",
      "grapes",
      "portrait",
    ]);
    expect(tasteEnhancePatch(profile, "grapes")).toEqual({ contrast: 20 });
    expect(tasteEnhancePatch(profile, "mountain")).toEqual({ contrast: 20 });
  });

  it("stays null in a keyless subject scope instead of borrowing globally", () => {
    const profile = profileFromPhotos(
      [{ saturation: 10 }, { vibrance: 10 }, { clarity: 10 }, { contrast: 40 }, { contrast: 40 }, { contrast: 40 }],
      ["grapes", "grapes", "grapes", "portrait", "portrait", "portrait"],
    );
    expect(tasteEnhancePatch(profile, "grapes")).toBeNull();
    expect(tasteEnhancePatch(profile, "portrait")).toEqual({ contrast: 40 });
    expect(tasteEnhancePatch(profile)).toEqual({ contrast: 40 });
  });
});

describe("taste profile persistence", () => {
  it("round-trips through JSON", () => {
    const profile = profileFromPhotos([{ contrast: 20 }, { contrast: 30 }]);
    expect(parseTasteProfileJson(serializeTasteProfile(profile))).toEqual(profile);
  });

  it("round-trips subject tags through JSON", () => {
    const profile = profileFromPhotos([{ contrast: 20 }, { contrast: 30 }], ["grapes", null]);
    const parsed = parseTasteProfileJson(serializeTasteProfile(profile));
    expect(parsed).toEqual(profile);
    expect(parsed.version).toBe(TASTE_PROFILE_VERSION);
    expect(parsed.samples.p0?.label).toBe("grapes");
    expect(parsed.samples.p1?.label).toBeUndefined();
  });

  it("never throws: garbage in, empty profile out", () => {
    for (const raw of [null, undefined, "", "not json", "[]", '"x"', "42"]) {
      expect(parseTasteProfileJson(raw)).toEqual(createTasteProfile());
    }
    for (const value of [
      null,
      42,
      "x",
      [],
      { version: 3, samples: {} },
      { version: 1 },
      { version: 1, samples: [] },
      { version: 2, samples: [] },
    ]) {
      expect(parseTasteProfile(value)).toEqual(createTasteProfile());
    }
  });

  it("migrates version 1 profiles in place: untagged samples keep working", () => {
    const profile = parseTasteProfile({
      version: 1,
      updatedAt: AT,
      samples: {
        p1: { values: { contrast: 20 } },
        p2: { values: { contrast: 20 } },
        p3: { values: { contrast: 20 } },
      },
    });
    expect(profile.version).toBe(TASTE_PROFILE_VERSION);
    expect(profile.updatedAt).toBe(AT);
    expect(profile.samples.p1).toEqual({ values: { contrast: 20 } });
    expect(tasteEnhancePatch(profile)).toEqual({ contrast: 20 });
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

  it("normalizes subject tags and drops bad ones, keeping the values", () => {
    const profile = parseTasteProfile({
      version: 2,
      samples: {
        p1: { values: { contrast: 20 }, label: "  Grapes " },
        p2: { values: { contrast: 20 }, label: "   " },
        p3: { values: { contrast: 20 }, label: 42 },
      },
    });
    expect(profile.samples.p1).toEqual({ values: { contrast: 20 }, label: "grapes" });
    expect(profile.samples.p2).toEqual({ values: { contrast: 20 } });
    expect(profile.samples.p3).toEqual({ values: { contrast: 20 } });
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

  it("tags backfilled samples from the seed labels", () => {
    const human = { past: [], present: edit({ contrast: 20 }), future: [] };
    const seed = {
      histories: { p1: human, p2: human, p3: human },
      actions: {},
      labels: {
        p1: [{ label: "grapes", score: 0.3, source: "ml" as const }],
        p2: [{ label: "party", score: 1, source: "user" as const }],
      },
    };
    const profile = tasteProfileFromSeed(seed, AT);
    expect(profile.samples.p1).toEqual({ values: { contrast: 20 }, label: "grapes" });
    // User-only labels tag nothing (see topTasteLabel); missing labels tag nothing.
    expect(profile.samples.p2).toEqual({ values: { contrast: 20 } });
    expect(profile.samples.p3).toEqual({ values: { contrast: 20 } });
  });
});
