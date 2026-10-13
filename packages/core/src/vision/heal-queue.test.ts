import { describe, expect, it, vi } from "vitest";
import { createHealQueue } from "./heal-queue.js";
import { repairedBaseForHealJob, type CachedHealPatch } from "./heal-cache.js";
import type { PixelImage } from "./analyze.js";
import type { RepairMask } from "./inpaint.js";
import { solidColor } from "./fixtures.js";
import { groupRetouchStrokes } from "../retouch.js";
import type { RetouchPoint } from "../types.js";
import type { RunInpaint } from "../image.js";

function repair(x: number, y: number, stroke: number): RetouchPoint {
  return { x, y, size: 0.1, strength: 100, kind: "repair", stroke };
}

function source(): PixelImage {
  return solidColor(32, 32, 10, 20, 30);
}

function fakePatch(): CachedHealPatch {
  return { signature: "sig", x0: 0, y0: 0, width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4), resampleDeg: 0 };
}

describe("createHealQueue", () => {
  it("reports aggregate progress with a single terminal done for multi-group jobs", async () => {
    const points = [repair(0.2, 0.2, 1), repair(0.7, 0.7, 2), repair(0.5, 0.8, 3)];
    const groups = groupRetouchStrokes(points).filter((g) => g.kind === "repair");
    const seen: { fraction: number; stage: string }[] = [];
    // Simulate a transport that reports per-group done (the old bug).
    const healGroup = vi.fn().mockImplementation(async (_src: unknown, _group: unknown, _m: unknown, run: (img: PixelImage, mask: unknown, r: number, mm: unknown, opts?: { onProgress?: (f: number, s: string) => void; areas?: number }) => Promise<PixelImage>, opts?: { onProgress?: (f: number, s: string) => void; areas?: number }) => {
      opts?.onProgress?.(0, "Contacting photo server…");
      opts?.onProgress?.(0.5, "Repairing…");
      // Per-group terminal the queue must swallow.
      await run(source(), { width: 1, height: 1, data: new Uint8ClampedArray(1) }, 1, "ml-heal", { onProgress: (f, s) => opts?.onProgress?.(f, s) });
      return fakePatch();
    });
    const run = vi.fn().mockImplementation(async (_img: PixelImage, _mask: unknown, _r: number, _m: unknown, opts?: { onProgress?: (f: number, s: string) => void }) => {
      // Transport-level per-group done — must never reach the UI directly.
      opts?.onProgress?.(1, "Repair done");
      return source();
    });
    const queue = createHealQueue(healGroup);
    const doneOrder: number[] = [];
    await queue.enqueue({
      source: source(),
      groups,
      method: "ml-heal",
      runInpaint: run,
      onGroupDone: (_patch, group) => void doneOrder.push(group.id),
      onProgress: (fraction, stage) => void seen.push({ fraction, stage }),
    });
    // One transport call per group, strictly serially.
    expect(healGroup).toHaveBeenCalledTimes(3);
    expect(doneOrder.sort()).toEqual([1, 2, 3]);
    // Exactly one terminal done, at the end.
    const terminals = seen.filter((s) => s.fraction >= 1 || s.stage === "Repair done");
    expect(terminals).toHaveLength(1);
    expect(seen[seen.length - 1]).toEqual({ fraction: 1, stage: "Repair done" });
    // Monotonic, and intermediate stages name the group position.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!.fraction).toBeGreaterThanOrEqual(seen[i - 1]!.fraction);
    }
    expect(seen.some((s) => s.stage === "Repairing 1 of 3…")).toBe(true);
    expect(seen.some((s) => s.stage === "Repairing 3 of 3…")).toBe(true);
  });

  it("processes jobs one at a time in FIFO order without overlap", async () => {
    const running: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const healGroup = vi.fn().mockImplementation(async (_s: unknown, group: { id: number }) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      running.push(`start-${group.id}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running.push(`end-${group.id}`);
      concurrent -= 1;
      return fakePatch();
    });
    const run = vi.fn().mockResolvedValue(source());
    const queue = createHealQueue(healGroup);
    const g = (id: number) => groupRetouchStrokes([repair(0.1 * id, 0.1 * id, id)]).filter((x) => x.kind === "repair");
    const first = queue.enqueue({ source: source(), groups: g(1), method: "ml-heal", runInpaint: run });
    const second = queue.enqueue({ source: source(), groups: g(2), method: "ml-heal", runInpaint: run });
    const third = queue.enqueue({ source: source(), groups: g(3), method: "ml-heal", runInpaint: run });
    expect(queue.pendingJobs).toBe(2);
    await Promise.all([first, second, third]);
    expect(maxConcurrent).toBe(1);
    expect(running).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
  });

  it("continues with remaining groups when one group fails", async () => {    const groups = groupRetouchStrokes([repair(0.2, 0.2, 1), repair(0.7, 0.7, 2)]).filter((g) => g.kind === "repair");
    const healGroup = vi.fn().mockImplementation(async (_s: unknown, group: { id: number }) => {
      if (group.id === 1) throw new Error("boom");
      return fakePatch();
    });
    const run = vi.fn().mockResolvedValue(source());
    const seen: string[] = [];
    const queue = createHealQueue(healGroup);
    await queue.enqueue({
      source: source(),
      groups,
      method: "ml-heal",
      runInpaint: run,
      onGroupDone: (_p, group) => void seen.push(`done-${group.id}`),
      onProgress: (_f, stage) => void seen.push(stage),
    });
    expect(seen).toContain("done-2");
    expect(seen[seen.length - 1]).toBe("Repair done");
  });

  it("plans deferred jobs at start time so follow-ups see finished groups", async () => {
    const healed: number[] = [];
    const healGroup = vi.fn().mockImplementation(async (_s: unknown, group: { id: number }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      healed.push(group.id);
      return fakePatch();
    });
    const run = vi.fn().mockResolvedValue(source());
    const queue = createHealQueue(healGroup);
    const g = (id: number) => groupRetouchStrokes([repair(0.1 * id, 0.1 * id, id)]).filter((x) => x.kind === "repair");
    // First job heals group 1 slowly; the follow-up plans late and sees it
    // done, so it resolves without rehealing anything.
    const first = queue.enqueue({ source: source(), groups: g(1), method: "ml-heal", runInpaint: run });
    const second = queue.enqueue({
      shouldAbort: () => false,
      prepare: () => (healed.includes(1) ? null : { source: source(), groups: g(1), method: "ml-heal", runInpaint: run }),
    });
    await Promise.all([first, second]);
    expect(healed).toEqual([1]);
    expect(healGroup).toHaveBeenCalledTimes(1);
  });

  it("aborted deferred jobs resolve without running", async () => {
    const healGroup = vi.fn().mockResolvedValue(fakePatch());
    const run = vi.fn().mockResolvedValue(source());
    const queue = createHealQueue(healGroup);
    const g = (id: number) => groupRetouchStrokes([repair(0.1 * id, 0.1 * id, id)]).filter((x) => x.kind === "repair");
    await queue.enqueue({ shouldAbort: () => true, prepare: () => ({ source: source(), groups: g(1), method: "ml-heal", runInpaint: run }) });
    expect(healGroup).not.toHaveBeenCalled();
  });

  it("heals each group against the repaired-so-far image within one job", async () => {
    const groups = groupRetouchStrokes([repair(0.2, 0.2, 1), repair(0.7, 0.7, 2)]).filter((g) => g.kind === "repair");
    const seen: PixelImage[] = [];
    const red = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < red.length; i += 4) {
      red[i] = 255;
      red[i + 1] = 0;
      red[i + 2] = 0;
      red[i + 3] = 255;
    }
    const healGroup = vi.fn().mockImplementation(async (src: PixelImage) => {
      seen.push({ width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) });
      return { signature: "sig", x0: 0, y0: 0, width: 2, height: 2, data: red.slice(), resampleDeg: 0 };
    });
    const run = vi.fn().mockResolvedValue(source());
    const queue = createHealQueue(healGroup);
    const jobSource = source();
    await queue.enqueue({ source: jobSource, groups, method: "ml-heal", runInpaint: run });
    expect(healGroup).toHaveBeenCalledTimes(2);
    // First group heals against the pristine base…
    expect([seen[0]!.data[0], seen[0]!.data[1], seen[0]!.data[2]]).toEqual([10, 20, 30]);
    // …the second against the base plus the first group's patch.
    expect([seen[1]!.data[0], seen[1]!.data[1], seen[1]!.data[2]]).toEqual([255, 0, 0]);
    // Accumulation copies: the caller's base is never mutated.
    expect([jobSource.data[0], jobSource.data[1], jobSource.data[2]]).toEqual([10, 20, 30]);
  });

  it("skips failed groups when accumulating the repaired-so-far image", async () => {
    const groups = groupRetouchStrokes([repair(0.2, 0.2, 1), repair(0.7, 0.7, 2)]).filter((g) => g.kind === "repair");
    const seen: PixelImage[] = [];
    const healGroup = vi.fn().mockImplementation(async (src: PixelImage, group: { id: number }) => {
      if (group.id === 1) throw new Error("boom");
      seen.push({ width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) });
      return fakePatch();
    });
    const run = vi.fn().mockResolvedValue(source());
    const queue = createHealQueue(healGroup);
    await queue.enqueue({ source: source(), groups, method: "ml-heal", runInpaint: run });
    // The failed group contributed nothing, so group 2 healed pristine.
    expect(seen).toHaveLength(1);
    expect([seen[0]!.data[0], seen[0]!.data[1], seen[0]!.data[2]]).toEqual([10, 20, 30]);
  });
});

describe("stacked repair sourcing", () => {
  /** White canvas with a black 5x5 blemish centered on (16, 16). */
  function blemishedSource(): PixelImage {
    const image = solidColor(32, 32, 255, 255, 255);
    for (let y = 14; y <= 18; y += 1) {
      for (let x = 14; x <= 18; x += 1) {
        const i = (y * 32 + x) * 4;
        image.data[i] = 0;
        image.data[i + 1] = 0;
        image.data[i + 2] = 0;
      }
    }
    return image;
  }

  function at(image: PixelImage, x: number, y: number): [number, number, number] {
    const i = (y * image.width + x) * 4;
    return [image.data[i] ?? -1, image.data[i + 1] ?? -1, image.data[i + 2] ?? -1];
  }

  /** Stub transport: records each inference input, fills the mask green. */
  function stubFillTransport(inputs: PixelImage[]): RunInpaint {
    return async (image: PixelImage, mask: RepairMask) => {
      inputs.push({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) });
      const out = new Uint8ClampedArray(image.data);
      for (let p = 0; p < mask.data.length; p += 1) {
        if ((mask.data[p] ?? 0) === 0) continue;
        out[p * 4] = 0;
        out[p * 4 + 1] = 255;
        out[p * 4 + 2] = 0;
        out[p * 4 + 3] = 255;
      }
      return { width: image.width, height: image.height, data: out };
    };
  }

  it("touch-up group in the same job sees the earlier group's repair, not the blemish", async () => {
    // Group 2's stroke overlaps group 1's mask edge (the touch-up case).
    const groups = groupRetouchStrokes([repair(0.5, 0.5, 1), repair(0.5625, 0.5, 2)]).filter(
      (g) => g.kind === "repair",
    );
    expect(groups).toHaveLength(2);
    const inputs: PixelImage[] = [];
    const queue = createHealQueue();
    await queue.enqueue({
      source: blemishedSource(),
      groups,
      method: "ml-heal",
      runInpaint: stubFillTransport(inputs),
      options: { featherPx: 0 },
    });
    expect(inputs).toHaveLength(2);
    // Group 1 heals against the original blemish…
    expect(at(inputs[0]!, 16, 16)).toEqual([0, 0, 0]);
    // …the overlapping touch-up heals against group 1's repaired pixels.
    expect(at(inputs[1]!, 16, 16)).toEqual([0, 255, 0]);
  });

  it("touch-up job after a finished repair sources from the repaired image", async () => {
    // The exact user flow: repair once, then later touch up a blemish left
    // inside the already-fixed region. The caller (preview/export) seeds
    // the follow-up job's source with the finished patch.
    const [groupA] = groupRetouchStrokes([repair(0.5, 0.5, 1)]).filter((g) => g.kind === "repair");
    const [groupB] = groupRetouchStrokes([repair(0.5625, 0.5, 2)]).filter((g) => g.kind === "repair");
    const inputs: PixelImage[] = [];
    const run = stubFillTransport(inputs);
    const queue = createHealQueue();
    const clean = blemishedSource();
    let finished: CachedHealPatch | null = null;
    await queue.enqueue({
      source: clean,
      groups: [groupA!],
      method: "ml-heal",
      runInpaint: run,
      options: { featherPx: 0 },
      onGroupDone: (patch) => void (finished = patch),
    });
    expect(finished).not.toBeNull();
    await queue.enqueue({
      source: repairedBaseForHealJob(clean, [finished!]),
      groups: [groupB!],
      method: "ml-heal",
      runInpaint: run,
      options: { featherPx: 0 },
    });
    expect(inputs).toHaveLength(2);
    expect(at(inputs[0]!, 16, 16)).toEqual([0, 0, 0]);
    expect(at(inputs[1]!, 16, 16)).toEqual([0, 255, 0]);
  });
});
