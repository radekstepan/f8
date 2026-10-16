import { describe, expect, it } from "vitest";
import { COMPARE_CLICK_WINDOW_MS, createCompareHold } from "./compareHold.js";

/** Controllable scheduler: tests close the click window exactly when wanted. */
function manualScheduler() {
  let pending: (() => void) | null = null;
  let lastDelay = -1;
  return {
    schedule: (callback: () => void, ms: number): unknown => {
      pending = callback;
      lastDelay = ms;
      return callback;
    },
    cancel: (id: unknown): void => {
      if (pending === id) pending = null;
    },
    fire: (): void => {
      const callback = pending;
      pending = null;
      callback?.();
    },
    get armed(): boolean {
      return pending !== null;
    },
    get delay(): number {
      return lastDelay;
    },
  };
}

function setup() {
  const scheduler = manualScheduler();
  const holds: boolean[] = [];
  const hold = createCompareHold({
    onHoldChange: (holding) => holds.push(holding),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  return { scheduler, holds, hold };
}

describe("compare hold", () => {
  it("shows the original synchronously on press — no delay, no timer wait", () => {
    const { scheduler, holds, hold } = setup();
    hold.press();
    expect(holds).toEqual([true]);
    expect(scheduler.armed).toBe(true);
    expect(scheduler.delay).toBe(COMPARE_CLICK_WINDOW_MS);
  });

  it("hides the original on release after the click window closes", () => {
    const { scheduler, holds, hold } = setup();
    hold.press();
    scheduler.fire();
    expect(holds).toEqual([true]);
    hold.release();
    expect(holds).toEqual([true, false]);
  });

  it("suppresses the release click after a hold so the split does not toggle", () => {
    const { scheduler, hold } = setup();
    hold.press();
    scheduler.fire();
    hold.release();
    expect(hold.click()).toBe(false);
  });

  it("lets a quick press-and-release click through to the split toggle", () => {
    const { holds, hold } = setup();
    hold.press();
    hold.release();
    expect(holds).toEqual([true, false]);
    expect(hold.click()).toBe(true);
  });

  it("consumes the suppression once — later clicks toggle again", () => {
    const { scheduler, hold } = setup();
    hold.press();
    scheduler.fire();
    hold.release();
    expect(hold.click()).toBe(false);
    expect(hold.click()).toBe(true);
  });

  it("cancels the pending window on release so a quick press never becomes a hold", () => {
    const { scheduler, holds, hold } = setup();
    hold.press();
    hold.release();
    scheduler.fire();
    expect(holds).toEqual([true, false]);
    expect(hold.click()).toBe(true);
  });

  it("ignores a release with no press and a click with no press", () => {
    const { holds, hold } = setup();
    hold.release();
    expect(holds).toEqual([]);
    expect(hold.click()).toBe(true);
  });

  it("ignores a second press while showing — the first press wins", () => {
    const { scheduler, holds, hold } = setup();
    hold.press();
    hold.press();
    expect(holds).toEqual([true]);
    hold.release();
    scheduler.fire();
    expect(holds).toEqual([true, false]);
    expect(hold.click()).toBe(true);
  });

  it("ignores a second press past the window (multi-touch)", () => {
    const { scheduler, holds, hold } = setup();
    hold.press();
    scheduler.fire();
    hold.press();
    hold.release();
    expect(holds).toEqual([true, false]);
    expect(hold.click()).toBe(false);
  });

  it("arms fresh after a full hold cycle", () => {
    const { scheduler, holds, hold } = setup();
    hold.press();
    scheduler.fire();
    hold.release();
    expect(hold.click()).toBe(false);
    hold.press();
    scheduler.fire();
    hold.release();
    expect(holds).toEqual([true, false, true, false]);
  });
});
