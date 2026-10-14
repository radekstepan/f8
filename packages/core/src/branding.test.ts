import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABOUT_DISCLAIMER,
  APP_DESCRIPTION,
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  EXTENSION_POINTS,
} from "./branding.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Workspaces versioned in lockstep by the changesets `fixed` group. */
const VERSIONED_PACKAGES = [
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/core/package.json",
  "packages/ui/package.json",
];

function packageVersion(relative: string): string {
  return (JSON.parse(readFileSync(join(ROOT, relative), "utf8")) as { version: string }).version;
}

describe("branding", () => {
  it("uses the adopted product name", () => {
    expect(APP_NAME).toBe("f/8");
  });

  it("shows a semver app version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mirrors the workspace package versions (single source of truth)", () => {
    for (const relative of VERSIONED_PACKAGES) {
      expect(packageVersion(relative), relative).toBe(APP_VERSION);
    }
  });

  it("keeps the retired edition label out of user-facing copy", () => {
    const copy = [APP_NAME, APP_VERSION, APP_TAGLINE, APP_DESCRIPTION, ABOUT_DISCLAIMER].join("\n");
    expect(copy).not.toMatch(/edition/i);
  });

  it("keeps retired names out of all user-visible copy", () => {
    const copy = [APP_NAME, APP_VERSION, APP_TAGLINE, APP_DESCRIPTION, ABOUT_DISCLAIMER].join("\n");
    expect(copy).not.toMatch(/safelight/i);
  });

  it("keeps retired demo labels out of user-facing copy", () => {
    const copy = [APP_NAME, APP_VERSION, APP_TAGLINE, APP_DESCRIPTION, ABOUT_DISCLAIMER].join("\n");
    expect(copy).not.toMatch(/kitchen sink/i);
    expect(copy).not.toMatch(/this demo/i);
    expect(copy).not.toMatch(/interface study/i);
  });

  it("disclaims affiliation", () => {
    expect(ABOUT_DISCLAIMER).toMatch(/not affiliated/i);
    expect(ABOUT_DISCLAIMER).toContain("Apple");
    expect(ABOUT_DISCLAIMER).toContain("Pixelmator");
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
