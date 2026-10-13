import { describe, expect, it } from "vitest";
import { shouldShowPhotoTools } from "./photoTools.js";

describe("shouldShowPhotoTools", () => {
  it("shows the photo-only controls on an open photo", () => {
    expect(shouldShowPhotoTools("editor")).toBe(true);
  });

  it("hides the photo-only controls in the library grid", () => {
    expect(shouldShowPhotoTools("library")).toBe(false);
  });
});
