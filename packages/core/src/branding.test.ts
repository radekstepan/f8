import { describe, expect, it } from "vitest";
import {
  ABOUT_DISCLAIMER,
  APP_DESCRIPTION,
  APP_EDITION,
  APP_EDITION_SHORT,
  APP_NAME,
  APP_TAGLINE,
  EXTENSION_POINTS,
} from "./branding.js";

describe("branding", () => {
  it("uses the adopted product name", () => {
    expect(APP_NAME).toBe("f/8");
    expect(APP_NAME).not.toContain("Photomator");
  });

  it("keeps the retired product name out of all user-visible copy", () => {
    const copy = [APP_NAME, APP_EDITION, APP_EDITION_SHORT, APP_TAGLINE, APP_DESCRIPTION, ABOUT_DISCLAIMER].join("\n");
    expect(copy).not.toMatch(/photomator/i);
    expect(copy).not.toMatch(/safelight/i);
  });

  it("keeps retired demo labels out of user-facing copy", () => {
    const copy = [APP_NAME, APP_EDITION, APP_EDITION_SHORT, APP_TAGLINE, APP_DESCRIPTION, ABOUT_DISCLAIMER].join("\n");
    expect(copy).not.toMatch(/kitchen sink/i);
    expect(copy).not.toMatch(/this demo/i);
    expect(copy).not.toMatch(/interface study/i);
  });

  it("disclaims affiliation without naming the retired product", () => {
    expect(ABOUT_DISCLAIMER).toMatch(/not affiliated/i);
    expect(ABOUT_DISCLAIMER).toContain("Apple");
    expect(ABOUT_DISCLAIMER).toContain("Pixelmator");
    expect(ABOUT_DISCLAIMER).not.toMatch(/photomator/i);
  });

  it("describes local-first processing accurately", () => {
    // Library + originals: referenced files, server-side SQLite catalog.
    expect(ABOUT_DISCLAIMER).toMatch(/this computer/);
    expect(ABOUT_DISCLAIMER).toMatch(/never modified/);
    // RAW (LibRaw, full sensor resolution) and on-device repair models exist,
    // so the copy must not deny them; auto-enhance stays histogram-based.
    expect(ABOUT_DISCLAIMER).toMatch(/RAW files are developed locally/);
    expect(ABOUT_DISCLAIMER).toMatch(/on this device/);
    expect(ABOUT_DISCLAIMER).toMatch(/histogram-based/);
    expect(ABOUT_DISCLAIMER).not.toMatch(/not included/);
  });

  it("points extension entries at real workspace paths", () => {
    expect(EXTENSION_POINTS.length).toBeGreaterThan(0);
    for (const entry of EXTENSION_POINTS) {
      expect(entry.path).toMatch(/^packages\//);
      expect(entry.path).not.toMatch(/^editor\//);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});
