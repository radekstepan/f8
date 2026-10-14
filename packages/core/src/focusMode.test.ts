import { describe, expect, it } from "vitest";
import { isFilmstripVisible, resolveFocusView } from "./focusMode.js";

describe("resolveFocusView", () => {
  it("renders the open photo while focus mode is on, whatever the view state says", () => {
    expect(resolveFocusView("editor", true)).toBe("editor");
    expect(resolveFocusView("library", true)).toBe("editor");
  });

  it("follows the view state when focus mode is off", () => {
    expect(resolveFocusView("editor", false)).toBe("editor");
    expect(resolveFocusView("library", false)).toBe("library");
  });
});

describe("isFilmstripVisible", () => {
  it("forces the filmstrip on in focus mode even when the user keeps it closed", () => {
    expect(isFilmstripVisible(false, true)).toBe(true);
    expect(isFilmstripVisible(true, true)).toBe(true);
  });

  it("follows the preference when focus mode is off", () => {
    expect(isFilmstripVisible(true, false)).toBe(true);
    expect(isFilmstripVisible(false, false)).toBe(false);
  });
});
