/** Neighbor preloading for fast album arrowing.
 *
 * Arrowing through an album used to fetch + decode each full-res photo only
 * after it became current, so every step waited on the network (cold HTTP
 * cache) or at least a fresh decode. The editor instead preloads the photos
 * around the selection during idle moments after navigation settles, warming
 * both the browser cache and the in-memory decode cache (`loadImage`) — the
 * next arrow step then finds its bytes (and often its decoded pixels) ready.
 *
 * Order and wrap match the arrow-key handler in `apps/web/src/App.tsx`:
 * forward first (`n+1`), then back (`n-1`), alternating outward, wrapping
 * around the album ends exactly like the keyboard navigation does.
 */

/** How far around the selection to preload (each side). Two covers a fast double-tap without fetching the album. */
export const PHOTO_PRELOAD_RADIUS = 2;

/** Idle delay after navigation settles before preloads fire. Rapid arrowing keeps resetting this timer, so the current photo always wins the connection race. */
export const PHOTO_PRELOAD_DELAY_MS = 80;

/** Full-res srcs to preload around `index`, nearest first (`n+1, n-1, n+2, n-2, …`), wrapping around the album ends.
 *
 * The current photo, empty srcs, and duplicates (the same bytes under two
 * rows, or a radius larger than the album) are skipped. Returns [] for an
 * empty/single-photo album, an out-of-range index, or a radius below 1.
 */
export function preloadNeighborSrcs(
  photos: readonly { src: string }[],
  index: number,
  radius: number = PHOTO_PRELOAD_RADIUS,
): string[] {
  const count = photos.length;
  if (count <= 1 || !Number.isInteger(index) || index < 0 || index >= count) return [];
  const steps = Math.floor(radius);
  if (!(steps >= 1)) return [];
  const current = photos[index];
  const seen = new Set<string>(current ? [current.src] : []);
  const srcs: string[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const forward = photos[(index + step) % count];
    const back = photos[(index - step + count * step) % count];
    for (const candidate of [forward, back]) {
      const src = candidate?.src;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      srcs.push(src);
    }
  }
  return srcs;
}
