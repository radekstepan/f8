import { describe, expect, it } from "vitest";
import { filmstripArrowIndex } from "./filmstripScroll.js";
import { photoEndTargetId, shouldNavigateToPhotoEnd } from "./photoEndNavigation.js";

const photos = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];

describe("shouldNavigateToPhotoEnd", () => {
  it("claims Home and End while on an open photo", () => {
    expect(shouldNavigateToPhotoEnd("Home", "editor")).toBe(true);
    expect(shouldNavigateToPhotoEnd("End", "editor")).toBe(true);
  });

  it("leaves Home and End native in the library so the grid keeps scrolling", () => {
    expect(shouldNavigateToPhotoEnd("Home", "library")).toBe(false);
    expect(shouldNavigateToPhotoEnd("End", "library")).toBe(false);
  });

  it("ignores other keys in every view", () => {
    for (const view of ["editor", "library"] as const) {
      expect(shouldNavigateToPhotoEnd("ArrowRight", view)).toBe(false);
      expect(shouldNavigateToPhotoEnd("Enter", view)).toBe(false);
      expect(shouldNavigateToPhotoEnd("home", view)).toBe(false);
    }
  });
});

describe("photoEndTargetId", () => {
  it("jumps to the first and last photo", () => {
    expect(photoEndTargetId("Home", photos, "p2")).toBe("p1");
    expect(photoEndTargetId("End", photos, "p2")).toBe("p3");
  });

  it("is a no-op on the end already open", () => {
    expect(photoEndTargetId("Home", photos, "p1")).toBeNull();
    expect(photoEndTargetId("End", photos, "p3")).toBeNull();
  });

  it("is a no-op for other keys and empty collections", () => {
    expect(photoEndTargetId("ArrowRight", photos, "p2")).toBeNull();
    expect(photoEndTargetId("Home", [], "p2")).toBeNull();
    expect(photoEndTargetId("End", [], "p2")).toBeNull();
  });

  it("lands the selection on the same photo the filmstrip focus moves to", () => {
    // The strip handler moves focus via filmstripArrowIndex while App moves
    // the selection via photoEndTargetId; keyed on the same event.key, the
    // two must agree or focus and selection would split apart.
    for (const key of ["Home", "End"] as const) {
      const focusIndex = filmstripArrowIndex(key, 1, photos.length);
      expect(focusIndex).toBeGreaterThanOrEqual(0);
      expect(photoEndTargetId(key, photos, "p2")).toBe(photos[focusIndex]!.id);
    }
  });
});
