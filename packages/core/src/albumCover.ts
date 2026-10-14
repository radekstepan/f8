import type { Photo } from "./types.js";

// A photo record usable for cover selection: the shared Photo shape plus the
// server-only `missing` flag (absent on demo/legacy records), which excludes
// originals that are no longer on disk.
export type AlbumCoverCandidate = Pick<
  Photo,
  "thumbnail" | "src" | "favorite" | "rating" | "name"
> & { missing?: boolean };

export interface PickAlbumCoverOptions {
  /**
   * Cover URL to avoid re-picking (the album's current cover): when other
   * usable photos exist, the pick comes from outside this URL so repeated
   * Generate clicks move to a different photo instead of returning the
   * same one. Ignored when falsy or when every usable photo resolves to
   * the same URL.
   */
  exclude?: string | null;
  /**
   * Random source returning [0, 1), injected for deterministic tests.
   * Defaults to Math.random.
   */
  random?: () => number;
}

function coverUrl(photo: AlbumCoverCandidate): string {
  return photo.thumbnail || photo.src;
}

/**
 * Usable candidates in "most interesting" order: favorites first, then by
 * rating descending, then by filename ascending — skipping missing
 * originals and records with no image at all.
 */
export function rankAlbumCoverCandidates(
  photos: AlbumCoverCandidate[],
): AlbumCoverCandidate[] {
  return photos
    .filter((photo) => !photo.missing && (photo.thumbnail || photo.src))
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        b.rating - a.rating ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Representative sidebar thumbnail for an album's photos: a random pick
 * from the most interesting tier (favorites first, else the highest
 * rating), so Generate varies instead of always returning the same
 * photo. The current cover passes as `exclude` to force a different
 * photo while an alternative exists. Returns the thumbnail URL
 * (falling back to the full-size src), or null when nothing qualifies.
 */
export function pickAlbumCover(
  photos: AlbumCoverCandidate[],
  options: PickAlbumCoverOptions = {},
): string | null {
  const ranked = rankAlbumCoverCandidates(photos);
  if (!ranked.length) return null;
  const exclude = options.exclude || "";
  const pool =
    exclude && ranked.some((photo) => coverUrl(photo) !== exclude)
      ? ranked.filter((photo) => coverUrl(photo) !== exclude)
      : ranked;
  const head = pool[0];
  if (!head) return null;
  // Top tier shares the head's favorite flag and rating; filename order
  // within the tier keeps an injected `random` mapping stable.
  const tier = pool.filter(
    (photo) => photo.favorite === head.favorite && photo.rating === head.rating,
  );
  const random = options.random ?? Math.random;
  const index = Math.min(
    Math.max(Math.floor(random() * tier.length), 0),
    tier.length - 1,
  );
  const winner = tier[index];
  if (!winner) return null;
  return coverUrl(winner);
}
