/** Max album name length, matching the server's album-name validation. */
export const MAX_ALBUM_NAME_LENGTH = 60;

const FALLBACK_ALBUM_NAME = "Imported Photos";

/**
 * Humanize a folder basename into an album title: dash/underscore/space
 * runs become single spaces and each word gains a capital, so
 * "2026-europe-trip" reads "2026 Europe Trip". The rest of each word is
 * preserved as typed (acronyms and mixed case survive); names with no
 * readable word fall back to "Imported Photos".
 */
export function humanizeAlbumName(folderName: string): string {
  const words = folderName
    .split(/[-_\s]+/)
    .map((word) => word.trim())
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const title = words.join(" ").slice(0, MAX_ALBUM_NAME_LENGTH).trimEnd();
  return title || FALLBACK_ALBUM_NAME;
}
