import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import { getPhotoFilter, thumbnailFilterForPhoto } from "./image.js";

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
