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

/**
 * One e2e poll tick's view of the heal pipeline. A null field means the
 * `window.__f8Test` hook was unreachable that tick (the document reloaded
 * or PhotoCanvas has not published yet) — never a settled pipeline, so
 * waits keep polling instead of throwing. This matters because
 * `expect.poll` does not retry a throwing callback: one missing-hook tick
 * fails the spec immediately with a `TypeError`, not a timeout.
 */
export interface HealWaitSnapshot {
  pendingIds: number[] | null;
  queue: { active: boolean; pendingJobs: number } | null;
  healCallCount: number | null;
}

/**
 * True once a stroke's work is observable: a pending group, an active or
 * non-empty queue, or a NEW transport call past the snapshot count.
 * Missing fields read as "not started yet" so the wait survives a tick
 * where the hook is unreachable.
 */
export function healWaitStarted(snapshot: HealWaitSnapshot, callsBefore: number): boolean {
  return (
    (snapshot.pendingIds?.length ?? 0) > 0 ||
    snapshot.queue?.active === true ||
    (snapshot.queue?.pendingJobs ?? 0) > 0 ||
    (snapshot.healCallCount !== null && snapshot.healCallCount > callsBefore)
  );
}

/**
 * True once every heal settled: no pending groups and an idle, empty
 * queue — all three observed. Any missing field reads as "still working",
 * so the wait keeps polling across a reload/remount instead of either
 * throwing (strict read) or passing vacuously (treating missing as done).
 */
export function healWaitSettled(snapshot: HealWaitSnapshot): boolean {
  return (
    snapshot.pendingIds !== null &&
    snapshot.pendingIds.length === 0 &&
    snapshot.queue !== null &&
    !snapshot.queue.active &&
    snapshot.queue.pendingJobs === 0
  );
}
