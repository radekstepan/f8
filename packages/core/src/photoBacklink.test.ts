import { describe, expect, it } from "vitest";
import { shouldShowPhotoBacklink } from "./photoBacklink.js";

describe("shouldShowPhotoBacklink", () => {
  it("shows the backlink on an open photo (editor view)", () => {
    expect(shouldShowPhotoBacklink("editor")).toBe(true);
  });

  it("hides the backlink in the library view — the grid is already home", () => {
    expect(shouldShowPhotoBacklink("library")).toBe(false);
  });
});
