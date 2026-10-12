/** User-visible product identity for menus, the About dialog, and the page shell.
 *
 * Display name is `f/8`; identifier-safe contexts (npm scopes `@f8/*`,
 * `F8_*` env vars, `f8.*` storage keys) use `f8`. Only human-facing copy
 * lives here — legacy `Photomator`-era paths and keys survive solely as
 * read fallbacks so upgrades never orphan user data (see docs/tasks/01-rename-f8.md).
 */
export const APP_NAME = "f/8";

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
  "An independent project — not affiliated with Apple or Pixelmator. " +
  "Your library lives in a database on this computer; originals stay in your folders and are never modified. " +
  "RAW files are developed locally at full resolution, optional repair models run on this device, " +
  "and automatic adjustments are histogram-based rather than machine learning.";
