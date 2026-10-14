// Collection matching for the library sidebar, filmstrip, and grid.
//
// A photo's home collection is its album; the built-in collections match
// by flag, recency, or star rating. Inside a photo the open photo decides the
// collection (sidebar, toolbar, and filmstrip always agree with what's on
// screen — see libraryUrl.ts), so this predicate is the single source of
// truth for both listing and inference; the album grid itself deep-links
// via /album/<id>.

import type { Photo, ViewMode } from "./types.js";

/** "Recently" for the Recently Edited view: edits from the last 7 days. */
export const RECENTLY_EDITED_DAYS = 7;

const RECENTLY_EDITED_MS = RECENTLY_EDITED_DAYS * 24 * 60 * 60 * 1000;

/**
 * True when the photo has a saved edit from within the recent window. An
 * edited photo with no (or an unparseable) timestamp counts as recent: the
 * server always stamps editedAt, so a missing stamp means predating data,
 * not an old edit — hiding it would look like data loss.
 */
export function isRecentlyEdited(photo: Photo, now: number = Date.now()): boolean {
  if (photo.edited !== true) return false;
  if (photo.editedAt == null) return true;
  const at = Date.parse(photo.editedAt);
  if (Number.isNaN(at)) return true;
  return now - at <= RECENTLY_EDITED_MS;
}

/** True when the photo is listed under the given collection id. */
export function photoInCollection(photo: Photo, collection: string, now: number = Date.now()): boolean {
  if (collection === "all") return true;
  if (collection === "favorites") return photo.favorite;
  if (collection === "edited") return isRecentlyEdited(photo, now);
  const rating = ratingForCollection(collection);
  if (rating !== null) return photo.rating === rating;
  return photo.albumId === collection;
}

/** Home collection for a photo: its album. */
export function collectionForPhoto(photo: Photo): string {
  return photo.albumId;
}

/** Sidebar collections computed from flags/recency — never stored, never deletable. */
export const BUILT_IN_COLLECTIONS = ["all", "favorites", "edited"] as const;

export type BuiltInCollection = (typeof BUILT_IN_COLLECTIONS)[number];

/**
 * Star-rating smart albums: one computed collection per saved rating
 * (`rating-5`, `rating-1`, ...), shown in the sidebar Library group only
 * for ratings at least one photo has. Like the built-ins they are never
 * stored and never deletable; the URL form is /album/rating-<n>.
 */
export const RATING_COLLECTION_PREFIX = "rating-";

/** Lowest/highest star rating with a smart album (0 means unrated — no album). */
export const MIN_STAR_RATING = 1;
export const MAX_STAR_RATING = 5;

/** Collection id for a star rating's smart album. */
export function ratingCollectionId(rating: number): string {
  return `${RATING_COLLECTION_PREFIX}${rating}`;
}

/**
 * Star rating a collection id names, or null when it names no smart
 * album. Strict: only integers 1..5 parse, so `rating-0`, `rating-6`,
 * and `rating-x` all fall through to album matching.
 */
export function ratingForCollection(collection: string): number | null {
  if (!collection.startsWith(RATING_COLLECTION_PREFIX)) return null;
  const rating = Number(collection.slice(RATING_COLLECTION_PREFIX.length));
  if (!Number.isInteger(rating) || rating < MIN_STAR_RATING || rating > MAX_STAR_RATING) return null;
  return rating;
}

/** Sidebar/grid title for a star rating's smart album: that many ★ glyphs ("★★★★★", "★"). */
export function ratingCollectionLabel(rating: number): string {
  return "★".repeat(rating);
}

/**
 * Distinct star ratings present in the photos, highest first. Ratings
 * outside 1..5 (unrated, legacy strays) never earn a smart album.
 */
export function savedRatings(photos: Photo[]): number[] {
  const found = new Set<number>();
  for (const photo of photos) {
    if (Number.isInteger(photo.rating) && photo.rating >= MIN_STAR_RATING && photo.rating <= MAX_STAR_RATING) {
      found.add(photo.rating);
    }
  }
  return [...found].sort((a, b) => b - a);
}

/** True for the built-in collections (All Photos, Favorites, Recently Edited) and the star-rating smart albums. */
export function isBuiltInCollection(collection: string): boolean {
  return (BUILT_IN_COLLECTIONS as readonly string[]).includes(collection) || ratingForCollection(collection) !== null;
}

/** True when the collection is a user album that may be deleted. */
export function isDeletableCollection(collection: string): boolean {
  return !isBuiltInCollection(collection);
}

/**
 * Resolve a sidebar collection click into the collection to show.
 *
 * Clicking the already-selected collection deselects it back to All
 * Photos — but only from the grid (library view), where the selection is
 * the user's. Inside a photo (editor view) the open photo infers the
 * highlighted collection, so clicking it navigates to that collection's
 * grid instead of toggling away. Clicking All Photos while selected is a
 * no-op: it already is the deselected state.
 */
export function resolveCollectionClick(current: string, clicked: string, view: ViewMode): string {
  if (view === "library" && clicked === current && current !== "all") return "all";
  return clicked;
}
