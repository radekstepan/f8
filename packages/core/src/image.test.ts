import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import { frameAspectForPhoto, getPhotoFilter, isPortraitPhoto, liveEditsForSession, thumbnailFilterForPhoto } from "./image.js";
import type { EditState, HistoryState } from "./types.js";

describe("thumbnailFilterForPhoto", () => {
  it("returns undefined when the photo has no stored edit", () => {
    expect(thumbnailFilterForPhoto({})).toBeUndefined();
    expect(thumbnailFilterForPhoto({ edit: null })).toBeUndefined();
    expect(thumbnailFilterForPhoto({}, null)).toBeUndefined();
  });

  it("returns undefined for the default recipe (thumbnail matches the original)", () => {
    expect(thumbnailFilterForPhoto({ edit: { ...DEFAULT_EDIT } })).toBeUndefined();
  });

  it("returns undefined for geometry-only edits, which have no CSS equivalent", () => {
    const geometryOnly = { ...DEFAULT_EDIT, rotation: 90, flipH: true, straighten: 2, cropRatio: "1:1" };
    expect(thumbnailFilterForPhoto({ edit: geometryOnly })).toBeUndefined();
  });

  it("reflects black-and-white edits", () => {
    const filter = thumbnailFilterForPhoto({ edit: { ...DEFAULT_EDIT, blackAndWhite: true } });
    expect(filter).toContain("grayscale(1)");
    expect(filter).not.toBe(getPhotoFilter(DEFAULT_EDIT));
  });

  it("reflects exposure and color edits", () => {
    expect(thumbnailFilterForPhoto({ edit: { ...DEFAULT_EDIT, exposure: 1 } })).not.toBe(getPhotoFilter(DEFAULT_EDIT));
    expect(thumbnailFilterForPhoto({ edit: { ...DEFAULT_EDIT, saturation: 50 } })).not.toBe(getPhotoFilter(DEFAULT_EDIT));
    expect(thumbnailFilterForPhoto({ edit: { ...DEFAULT_EDIT, temperature: 7000 } })).not.toBe(getPhotoFilter(DEFAULT_EDIT));
  });

  it("prefers the live session edit over the persisted recipe", () => {
    const saved = { ...DEFAULT_EDIT };
    const live = { ...DEFAULT_EDIT, blackAndWhite: true };
    expect(thumbnailFilterForPhoto({ edit: saved }, live)).toBe(getPhotoFilter(live));
  });

  it("clears a stale persisted look when the live edit is reset to default", () => {
    const saved = { ...DEFAULT_EDIT, blackAndWhite: true };
    expect(thumbnailFilterForPhoto({ edit: saved }, { ...DEFAULT_EDIT })).toBeUndefined();
  });
});

describe("liveEditsForSession", () => {
  const present = (overrides: Partial<EditState> = {}): EditState => ({ ...DEFAULT_EDIT, ...overrides });
  const history = (present: EditState, past: EditState[] = [], future: EditState[] = []): HistoryState => ({ past, present, future });

  it("omits pristine seeded entries so thumbnails read the persisted recipe", () => {
    // Every photo seeds with empty past/future: none of them may shadow
    // photo.edit, or a background refresh could never show through.
    const histories = {
      p1: history(present()),
      p2: history(present({ exposure: 1.26, preset: "Apple" })),
    };
    expect(liveEditsForSession(histories)).toEqual({});
  });

  it("includes photos with an undo past (the save-debounce override)", () => {
    // Applying a preset pushes an undo step: the grid must match the
    // canvas immediately, ahead of the persisted recipe.
    const vivid = present({ saturation: 30, preset: "Vivid" });
    const histories = { p1: history(vivid, [present()]) };
    expect(liveEditsForSession(histories)).toEqual({ p1: vivid });
  });

  it("includes photos with only a redo future (undo-all keeps canvas parity)", () => {
    // Undo-all empties the past but the session still owns the recipe:
    // keep overriding so the grid matches the canvas, not the server.
    const original = present();
    const histories = { p1: history(original, [], [present({ saturation: 30 })]) };
    expect(liveEditsForSession(histories)).toEqual({ p1: original });
  });

  it("passes the session present through by identity", () => {
    const vivid = present({ saturation: 30 });
    const histories = { p1: history(vivid, [present()]) };
    expect(liveEditsForSession(histories).p1).toBe(vivid);
  });

  it("mixes dirty and pristine photos independently", () => {
    const vivid = present({ saturation: 30, preset: "Vivid" });
    const histories = {
      edited: history(vivid, [present()]),
      untouched: history(present()),
    };
    expect(liveEditsForSession(histories)).toEqual({ edited: vivid });
  });

  it("returns an empty map for empty histories", () => {
    expect(liveEditsForSession({})).toEqual({});
  });
});

describe("isPortraitPhoto", () => {
  it("reads portrait from the stored upright dimensions", () => {
    expect(isPortraitPhoto({ width: 4024, height: 6024 })).toBe(true);
    expect(isPortraitPhoto({ width: 6024, height: 4024 })).toBe(false);
  });

  it("treats square and unknown dimensions as landscape", () => {
    expect(isPortraitPhoto({ width: 100, height: 100 })).toBe(false);
    expect(isPortraitPhoto({ width: 0, height: 0 })).toBe(false);
  });
});

describe("frameAspectForPhoto", () => {
  it("reads the stored upright aspect for unedited photos", () => {
    expect(frameAspectForPhoto({ width: 3000, height: 2000 }, DEFAULT_EDIT)).toBeCloseTo(1.5, 10);
    expect(frameAspectForPhoto({ width: 2000, height: 3000 }, DEFAULT_EDIT)).toBeCloseTo(2 / 3, 10);
    expect(frameAspectForPhoto({ width: 100, height: 100 }, DEFAULT_EDIT)).toBeCloseTo(1, 10);
  });

  it("swaps dimensions on quarter turns, keeps them on half turns", () => {
    const portrait = { width: 2000, height: 3000 };
    expect(frameAspectForPhoto(portrait, { ...DEFAULT_EDIT, rotation: 90 })).toBeCloseTo(1.5, 10);
    expect(frameAspectForPhoto(portrait, { ...DEFAULT_EDIT, rotation: -90 })).toBeCloseTo(1.5, 10);
    expect(frameAspectForPhoto(portrait, { ...DEFAULT_EDIT, rotation: 270 })).toBeCloseTo(1.5, 10);
    expect(frameAspectForPhoto(portrait, { ...DEFAULT_EDIT, rotation: 180 })).toBeCloseTo(2 / 3, 10);
    expect(frameAspectForPhoto(portrait, { ...DEFAULT_EDIT, rotation: 0 })).toBeCloseTo(2 / 3, 10);
  });

  it("fits the crop ratio inside the frame", () => {
    expect(frameAspectForPhoto({ width: 3000, height: 2000 }, { ...DEFAULT_EDIT, cropRatio: "1:1" })).toBeCloseTo(1, 10);
    expect(frameAspectForPhoto({ width: 2000, height: 3000 }, { ...DEFAULT_EDIT, cropRatio: "16:9" })).toBeCloseTo(16 / 9, 10);
    expect(frameAspectForPhoto({ width: 3000, height: 2000 }, { ...DEFAULT_EDIT, cropRatio: "9:16" })).toBeCloseTo(9 / 16, 10);
    expect(frameAspectForPhoto({ width: 3000, height: 2000 }, { ...DEFAULT_EDIT, cropRatio: "Original" })).toBeCloseTo(1.5, 10);
  });

  it("combines rotation with crop the way the pipeline paints", () => {
    // Portrait turned landscape, then cropped square: square either way.
    expect(frameAspectForPhoto({ width: 2000, height: 3000 }, { ...DEFAULT_EDIT, rotation: 90, cropRatio: "1:1" })).toBeCloseTo(1, 10);
    // Portrait turned landscape, cropped 4:3: the ratio wins over the source.
    expect(frameAspectForPhoto({ width: 2000, height: 3000 }, { ...DEFAULT_EDIT, rotation: 90, cropRatio: "4:3" })).toBeCloseTo(4 / 3, 10);
  });

  it("ignores unknown crop keys, matching geometryCanvas output size", () => {
    // Straighten needs no test: the Pick<rotation | cropRatio> signature cannot receive it.
    expect(frameAspectForPhoto({ width: 3000, height: 2000 }, { rotation: 0, cropRatio: "nope" })).toBeCloseTo(1.5, 10);
  });

  it("falls back when the stored dimensions are unusable", () => {
    expect(frameAspectForPhoto({ width: 0, height: 0 }, DEFAULT_EDIT)).toBeCloseTo(1200 / 627, 10);
    expect(frameAspectForPhoto({ width: -5, height: 2000 }, DEFAULT_EDIT)).toBeCloseTo(1200 / 627, 10);
    expect(frameAspectForPhoto({ width: Number.NaN, height: 2000 }, DEFAULT_EDIT)).toBeCloseTo(1200 / 627, 10);
    expect(frameAspectForPhoto({ width: 3000, height: Number.POSITIVE_INFINITY }, DEFAULT_EDIT)).toBeCloseTo(1200 / 627, 10);
  });

  it("honors a caller-supplied fallback", () => {
    expect(frameAspectForPhoto({ width: 0, height: 0 }, DEFAULT_EDIT, 4 / 3)).toBeCloseTo(4 / 3, 10);
  });
});
