import type { Photo } from "./types.js";

// Album sort keys: filename (A-Z), import time (`importedAt`, the server
// `created_at` stamp), and capture time (`date`, EXIF DateTimeOriginal with a
// file-mtime fallback baked in at import). One global choice — it lives in
// the shared tool prefs next to the panel toggles, not per album.
export type AlbumSortKey = "filename" | "imported" | "captured";
export type AlbumSortDir = "asc" | "desc";

export const ALBUM_SORT_KEYS: AlbumSortKey[] = ["filename", "imported", "captured"];
export const ALBUM_SORT_DIRS: AlbumSortDir[] = ["asc", "desc"];
export const DEFAULT_ALBUM_SORT_KEY: AlbumSortKey = "captured";
export const DEFAULT_ALBUM_SORT_DIR: AlbumSortDir = "asc";

export const ALBUM_SORT_LABELS: Record<AlbumSortKey, string> = {
  filename: "Filename",
  imported: "Date imported",
  captured: "Date captured",
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

// Primary timestamp for the key, with cross-fallback: a photo whose EXIF
// capture date is missing/unparseable falls back to its import time (and
// vice versa), so mixed libraries still order sensibly. Null only when both
// stamps are missing — the filename tiebreak below then decides.
function sortTime(photo: Photo, key: AlbumSortKey): number | null {
  const captured = parseTime(photo.date);
  const imported = parseTime(photo.importedAt);
  if (key === "captured") return captured ?? imported;
  if (key === "imported") return imported ?? captured;
  return null;
}

function compareNames(a: Photo, b: Photo): number {
  // Numeric-aware so DSC9 sorts before DSC10, not after DSC89.
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

// Ascending comparison for one key; total (timestamps, then filename, then
// id), so the order is deterministic even for seed photos sharing a stamp.
// Descending is the exact reverse — the caller flips the final result.
function compareIds(a: Photo, b: Photo): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function compareAlbumPhotos(a: Photo, b: Photo, key: AlbumSortKey): number {
  if (key === "filename") return compareNames(a, b) || compareIds(a, b);
  // Fully undated photos sink below every dated one in ascending order
  // (and rise to the top in descending — desc is the exact reverse of
  // asc). Branched, not subtracted: Infinity - Infinity is NaN, which
  // sort() would read as "equal" and skip the filename tiebreak.
  const ta = sortTime(a, key);
  const tb = sortTime(b, key);
  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  if (ta === null && tb !== null) return 1;
  if (ta !== null && tb === null) return -1;
  return compareNames(a, b) || compareIds(a, b);
}

// Non-mutating client sort; every input it needs already ships on Photo.
export function sortAlbumPhotos<T extends Photo>(photos: T[], key: AlbumSortKey, dir: AlbumSortDir): T[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...photos].sort((a, b) => sign * compareAlbumPhotos(a, b, key));
}
