import type { Photo } from "./types.js";

// A photo record usable for cover selection: the shared Photo shape plus the
// server-only `missing` flag (absent on demo/legacy records), which excludes
// originals that are no longer on disk.
export type AlbumCoverCandidate = Pick<
  Photo,
  "thumbnail" | "src" | "favorite" | "rating" | "name"
> & { missing?: boolean };

/**
 * Representative sidebar thumbnail for an album's photos: the first favorite,
 * else the highest-rated, else the first by filename — skipping missing
 * originals and records with no image at all. Returns the thumbnail URL
 * (falling back to the full-size src), or null when nothing qualifies.
 */
export function pickAlbumCover(photos: AlbumCoverCandidate[]): string | null {
  const usable = photos.filter(
    (photo) => !photo.missing && (photo.thumbnail || photo.src),
  );
  if (!usable.length) return null;
  const ranked = [...usable].sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      b.rating - a.rating ||
      a.name.localeCompare(b.name),
  );
  const winner = ranked[0];
  if (!winner) return null;
  return winner.thumbnail || winner.src;
}
