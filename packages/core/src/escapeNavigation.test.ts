import { describe, expect, it } from "vitest";
import { shouldEscapeToLibrary } from "./escapeNavigation.js";

describe("shouldEscapeToLibrary", () => {
  it("navigates back to the album when on an open photo", () => {
    expect(shouldEscapeToLibrary("editor")).toBe(true);
  });

  it("is a no-op in the library view — already on the album", () => {
    expect(shouldEscapeToLibrary("library")).toBe(false);
  });
});
