// E2E test hooks: read-only observability for Playwright specs.
//
// The heal pipeline (serial queue, per-group cache, persisted overlays) is
// invisible from canvas pixels alone: a test cannot tell "group 1 reused"
// from "group 1 rehealed to identical pixels". This module records every
// worker/remote inpaint transport call in memory so specs can assert which
// groups actually ran inference, with what method/quality/areas/aggregate.
//
// Runtime only, never persisted. Zero behavior change: recording is a push
// to an array. Unit tests ignore it. The app publishes a read-only view on
// `window.__f8Test` (see PhotoCanvas); specs may also clear it
// between strokes to isolate per-action assertions.

import type { InpaintMethod } from "./inpaint.js";
import type { HealQuality } from "./heal.js";

export interface TestHealCall {
  method: InpaintMethod;
  quality: HealQuality | undefined;
  seamlessLight: boolean | undefined;
  featherPx: number | undefined;
  areas: number | null;
  aggregate: { index: number; total: number } | undefined;
  at: number;
}

const calls: TestHealCall[] = [];

/** Record one transport call (invoked by useInpaintRepair.run). */
export function recordTestHealCall(call: Omit<TestHealCall, "at">): void {
  calls.push({ ...call, at: Date.now() });
  // Cap: long sessions must not grow this without bound.
  if (calls.length > 500) calls.splice(0, calls.length - 500);
}

/** Snapshot of recorded calls, oldest first. */
export function readTestHealCalls(): TestHealCall[] {
  return [...calls];
}

/** Drop all recorded calls; specs call this between strokes. */
export function clearTestHealCalls(): void {
  calls.length = 0;
}
