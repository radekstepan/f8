// Collection matching for the library sidebar, filmstrip, and grid.
//
// A photo's home collection is its album; the three built-in collections
// match by flag or recency. Inside a photo the open photo decides the
// collection (sidebar, toolbar, and filmstrip always agree with what's on
// screen — see libraryUrl.ts), so this predicate is the single source of
// truth for both listing and inference; the album grid itself deep-links
// via ?album=.

import type { Photo } from "./types.js";

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
  return photo.albumId === collection;
}

/** Home collection for a photo: its album. */
export function collectionForPhoto(photo: Photo): string {
  return photo.albumId;
}
