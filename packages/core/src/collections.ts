// Collection matching for the library sidebar, filmstrip, and grid.
//
// A photo's home collection is its album; the six built-in collections match
// by flag or geometry. The app keeps no collection in the URL: the open
// photo decides the collection (sidebar, toolbar, and filmstrip always agree
// with what's on screen), so this predicate is the single source of truth
// for both listing and inference.

import type { Photo } from "./types.js";

/** True when the photo is listed under the given collection id. */
export function photoInCollection(photo: Photo, collection: string): boolean {
  if (collection === "all") return true;
  if (collection === "favorites") return photo.favorite;
  if (collection === "edited") return Boolean(photo.edited);
  if (collection === "imports") return photo.albumId === "imports";
  if (collection === "raw") return photo.raw;
  if (collection === "landscapes") return photo.width > photo.height;
  return photo.albumId === collection;
}

/** Home collection for a photo: its album. */
export function collectionForPhoto(photo: Photo): string {
  return photo.albumId;
}
