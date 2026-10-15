// Connectivity recovery: while the library is offline the app pings the
// server and reloads the moment it answers; a burst of broken images (or
// the browser's offline event) triggers a verification ping first, so one
// corrupt photo never takes down the whole app.

/** Cadence of the GET /api/health ping while the library is offline. */
export const OFFLINE_PING_INTERVAL_MS = 5000;

/** Image load failures inside the window below that trigger a server ping. */
export const OFFLINE_IMAGE_ERROR_BURST = 3;

/** Window in which image load failures count toward a burst. */
export const OFFLINE_IMAGE_ERROR_WINDOW_MS = 10_000;

export interface ImageFailureBurst {
  /** Failure timestamps still inside the window (oldest first). */
  recent: number[];
  /** True once the burst threshold is reached. */
  burst: boolean;
}

// Record one image load failure at `now` (epoch ms): prune failures older
// than the window, append, and report whether the burst threshold tripped.
// Pure so the hook stays a thin subscriber (tested behaviorally here).
export function noteImageFailure(recentFailures: readonly number[], now: number): ImageFailureBurst {
  const recent = [...recentFailures.filter((at) => now - at < OFFLINE_IMAGE_ERROR_WINDOW_MS), now];
  return { recent, burst: recent.length >= OFFLINE_IMAGE_ERROR_BURST };
}
