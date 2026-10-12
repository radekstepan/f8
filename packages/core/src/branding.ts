/** User-visible product identity for menus, the About dialog, and the page shell.
 *
 * Internal identifiers (`@photomator/*` packages, `photomator-demo-*`
 * localStorage keys, `~/Pictures/Photomator`) intentionally keep the old
 * prefix: package renames break installs and key renames orphan migrated
 * user state. Only human-facing copy lives here.
 */
export const APP_NAME = "Safelight";

export const APP_EDITION = "THE LOCAL-FIRST EDITION";

/** Short edition label for the menu-bar indicator. */
export const APP_EDITION_SHORT = "LOCAL-FIRST EDITION";

export const APP_TAGLINE = "A little darkroom. A lot of possibilities.";

export const APP_DESCRIPTION =
  "An independent, local-first photo editor. Import your photos, find your look, and make this workspace your own.";

/** Real workspace paths behind the "built to be extended" list. */
export const EXTENSION_POINTS = [
  { path: "packages/core/src/data.ts", label: "Sample library & presets" },
  { path: "packages/core/src/image.ts", label: "Preview & export pipeline" },
  { path: "packages/ui/src/components/", label: "Reusable editor controls" },
] as const;

export const ABOUT_DISCLAIMER =
  "An independent project — not affiliated with Apple, Pixelmator, or the makers of Photomator. " +
  "Your library lives in a database on this computer; originals stay in your folders and are never modified. " +
  "RAW files are developed locally at full resolution, optional repair models run on this device, " +
  "and automatic adjustments are histogram-based rather than machine learning.";
