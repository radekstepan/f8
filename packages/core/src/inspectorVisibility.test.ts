import { describe, expect, it } from "vitest";
import { isInspectorVisible } from "./inspectorVisibility.js";

describe("isInspectorVisible", () => {
  it("shows the Inspector in the editor when the panel is open", () => {
    expect(isInspectorVisible("editor", true)).toBe(true);
  });

  it("hides the Inspector in the editor when the panel is closed", () => {
    expect(isInspectorVisible("editor", false)).toBe(false);
  });

  it("hides the Inspector in the library view even when the panel is open", () => {
    expect(isInspectorVisible("library", true)).toBe(false);
  });

  it("hides the Inspector in the library view when the panel is closed", () => {
    expect(isInspectorVisible("library", false)).toBe(false);
  });
});
