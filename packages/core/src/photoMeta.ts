// Optimistic photo-meta updates (star / rating / title / album).
//
// Starring used to wait for the PATCH round-trip before the UI flipped:
// while a repair saturated the photo server, the click visibly did
// nothing until the repair finished. Meta changes now apply to local
// state immediately and the PATCH only reconciles; the tracker below
// keeps the optimistic values consistent while the request is in flight:
//
// - serverPhoto() re-applies the pending patch over every incoming server
//   record, so a concurrent repair save (PUT /edit returns the full row)
//   cannot clobber the star with pre-PATCH state.
// - Each begin() takes a sequence number; only the latest PATCH for a
//   photo settles authoritatively, so out-of-order responses can never
//   resurrect a state the user already toggled past.
// - A failed latest PATCH rolls back to the pre-optimistic values; a
//   failed superseded one leaves the newer optimistic state standing.

import type { PhotoPatch } from "./library.js";
import type { Photo } from "./types.js";

/** Merge a meta patch onto a photo without mutating it. */
export function applyPhotoMetaPatch<T extends Photo>(photo: T, patch: PhotoPatch): T {
  let next = photo;
  if (patch.favorite !== undefined && photo.favorite !== patch.favorite) {
    next = { ...next, favorite: patch.favorite };
  }
  if (patch.rating !== undefined && photo.rating !== patch.rating) {
    next = { ...next, rating: patch.rating };
  }
  if (patch.title !== undefined && photo.title !== patch.title) {
    next = { ...next, title: patch.title };
  }
  if (patch.albumId !== undefined && photo.albumId !== patch.albumId) {
    next = { ...next, albumId: patch.albumId };
  }
  return next;
}

interface PendingMeta {
  seq: number;
  patch: PhotoPatch;
  prev: PhotoPatch;
}

export interface PendingPhotoMeta {
  /** Record an optimistic patch; returns its sequence number. Overlapping
   * keys keep the first patch's prev, so a rollback unwinds every pending
   * toggle instead of landing between them. */
  begin(id: string, current: Photo, patch: PhotoPatch): number;
  /** Overlay the pending patch (if any) over an incoming server record. Pure. */
  serverPhoto<T extends Photo>(id: string, photo: T): T;
  /** Settle a PATCH response. True when seq is the latest for this photo
   * (caller applies the response authoritatively); stale responses are
   * dropped and pending state is left untouched. */
  resolve(id: string, seq: number): boolean;
  /** Settle a PATCH failure. Returns the pre-optimistic values when seq is
   * the latest (caller rolls back); stale failures leave the newer
   * optimistic state standing and return null. */
  reject(id: string, seq: number): PhotoPatch | null;
  /** The currently pending patch for a photo, if any. */
  pending(id: string): PhotoPatch | null;
}

export function createPendingPhotoMeta(): PendingPhotoMeta {
  const entries = new Map<string, PendingMeta>();
  let seqCounter = 0;

  return {
    begin(id: string, current: Photo, patch: PhotoPatch): number {
      const existing = entries.get(id);
      const seq = ++seqCounter;
      // Prev is captured only for newly pending keys: overlapping keys
      // keep the first patch's prev (pre-optimistic by construction).
      const prev: PhotoPatch = { ...(existing?.prev ?? {}) };
      if (patch.favorite !== undefined && existing?.patch.favorite === undefined) prev.favorite = current.favorite;
      if (patch.rating !== undefined && existing?.patch.rating === undefined) prev.rating = current.rating;
      if (patch.title !== undefined && existing?.patch.title === undefined) prev.title = current.title;
      if (patch.albumId !== undefined && existing?.patch.albumId === undefined) prev.albumId = current.albumId;
      entries.set(id, { seq, patch: { ...(existing?.patch ?? {}), ...patch }, prev });
      return seq;
    },
    serverPhoto<T extends Photo>(id: string, photo: T): T {
      const entry = entries.get(id);
      return entry ? applyPhotoMetaPatch(photo, entry.patch) : photo;
    },
    resolve(id: string, seq: number): boolean {
      const entry = entries.get(id);
      if (!entry || entry.seq !== seq) return false;
      entries.delete(id);
      return true;
    },
    reject(id: string, seq: number): PhotoPatch | null {
      const entry = entries.get(id);
      if (!entry || entry.seq !== seq) return null;
      entries.delete(id);
      return entry.prev;
    },
    pending(id: string): PhotoPatch | null {
      return entries.get(id)?.patch ?? null;
    },
  };
}
