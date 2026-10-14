import { describe, expect, it } from "vitest";
import {
  healWaitSettled,
  healWaitStarted,
  type HealWaitSnapshot,
} from "./test-hooks.js";

const IDLE_QUEUE = { active: false, pendingJobs: 0 };

function snapshot(overrides: Partial<HealWaitSnapshot> = {}): HealWaitSnapshot {
  return { pendingIds: [], queue: { ...IDLE_QUEUE }, healCallCount: 0, ...overrides };
}

describe("healWaitStarted", () => {
  it("is idle on a fully observed quiet pipeline", () => {
    expect(healWaitStarted(snapshot({ healCallCount: 2 }), 2)).toBe(false);
  });

  it("starts on a pending group", () => {
    expect(healWaitStarted(snapshot({ pendingIds: [1] }), 0)).toBe(true);
  });

  it("starts on an active queue", () => {
    expect(healWaitStarted(snapshot({ queue: { active: true, pendingJobs: 0 } }), 0)).toBe(true);
  });

  it("starts on queued jobs behind an idle flag", () => {
    expect(healWaitStarted(snapshot({ queue: { active: false, pendingJobs: 2 } }), 0)).toBe(true);
  });

  it("starts only on a NEW transport call past the snapshot", () => {
    expect(healWaitStarted(snapshot({ healCallCount: 3 }), 2)).toBe(true);
    expect(healWaitStarted(snapshot({ healCallCount: 2 }), 2)).toBe(false);
  });

  it("reads a missing hook as not started yet, never throwing", () => {
    const missing: HealWaitSnapshot = { pendingIds: null, queue: null, healCallCount: null };
    expect(healWaitStarted(missing, 0)).toBe(false);
  });

  it("still starts when only some fields are missing", () => {
    expect(healWaitStarted(snapshot({ pendingIds: null, queue: null, healCallCount: 1 }), 0)).toBe(true);
    expect(healWaitStarted(snapshot({ pendingIds: [4], queue: null, healCallCount: null }), 0)).toBe(true);
  });
});

describe("healWaitSettled", () => {
  it("settles on a fully observed quiet pipeline", () => {
    expect(healWaitSettled(snapshot())).toBe(true);
  });

  it("works while a group is pending", () => {
    expect(healWaitSettled(snapshot({ pendingIds: [1] }))).toBe(false);
  });

  it("works while the queue is active", () => {
    expect(healWaitSettled(snapshot({ queue: { active: true, pendingJobs: 0 } }))).toBe(false);
  });

  it("works while jobs are queued", () => {
    expect(healWaitSettled(snapshot({ queue: { active: false, pendingJobs: 1 } }))).toBe(false);
  });

  it("reads a missing hook as still working, never settled and never throwing", () => {
    const missing: HealWaitSnapshot = { pendingIds: null, queue: null, healCallCount: null };
    expect(healWaitSettled(missing)).toBe(false);
    // Partial observations must not pass vacuously either.
    expect(healWaitSettled(snapshot({ pendingIds: null }))).toBe(false);
    expect(healWaitSettled(snapshot({ queue: null }))).toBe(false);
  });
});
