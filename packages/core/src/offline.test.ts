import { describe, expect, it } from "vitest";
import {
  OFFLINE_IMAGE_ERROR_BURST,
  OFFLINE_IMAGE_ERROR_WINDOW_MS,
  OFFLINE_PING_INTERVAL_MS,
  noteImageFailure,
} from "./offline.js";

// The album grid reports every broken thumbnail to the library hook, which
// verifies a suspected outage with a health ping only once failures burst —
// a lone corrupt photo must never flip the offline takeover.

describe("offline image-failure burst", () => {
  it("needs more than one failure to trip", () => {
    expect(OFFLINE_IMAGE_ERROR_BURST).toBeGreaterThanOrEqual(2);
    const first = noteImageFailure([], 1000);
    expect(first).toEqual({ recent: [1000], burst: false });
    const second = noteImageFailure(first.recent, 2000);
    expect(second.burst).toBe(false);
  });

  it("trips on a burst inside the window", () => {
    let state = noteImageFailure([], 1000);
    state = noteImageFailure(state.recent, 2000);
    state = noteImageFailure(state.recent, 3000);
    expect(state.recent).toEqual([1000, 2000, 3000]);
    expect(state.burst).toBe(true);
  });

  it("forgets failures older than the window", () => {
    const state = noteImageFailure(
      [-2, -1, OFFLINE_IMAGE_ERROR_WINDOW_MS - 1],
      OFFLINE_IMAGE_ERROR_WINDOW_MS,
    );
    expect(state.recent).toEqual([OFFLINE_IMAGE_ERROR_WINDOW_MS - 1, OFFLINE_IMAGE_ERROR_WINDOW_MS]);
    expect(state.burst).toBe(false);
  });

  it("prunes a failure exactly a window old", () => {
    const state = noteImageFailure([0], OFFLINE_IMAGE_ERROR_WINDOW_MS);
    expect(state.recent).toEqual([OFFLINE_IMAGE_ERROR_WINDOW_MS]);
  });

  it("keeps the offline ping on a short fixed cadence", () => {
    expect(OFFLINE_PING_INTERVAL_MS).toBeGreaterThan(0);
    expect(OFFLINE_PING_INTERVAL_MS).toBeLessThanOrEqual(10_000);
  });
});
