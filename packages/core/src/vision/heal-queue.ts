// Serial heal job queue: one group at a time, FIFO, never parallel.
//
// Clicking repeatedly used to spawn one async loop per edit, each driving
// its own per-group `runInpaint` — overlapping server inferences plus a
// premature per-group "Repair done". Every enqueue here becomes a job with
// a fixed group list; the processor runs jobs strictly sequentially and
// reports aggregate progress ("Repairing i of N…") with a single terminal
// "Repair done" after the job's last group. New strokes schedule a later
// job — the running group is never cancelled.

import type { PixelImage } from "./analyze.js";
import type { HealProgress } from "./heal.js";
import { healSingleGroup, type CachedHealPatch } from "./heal-cache.js";
import type { RetouchStrokeGroup } from "../retouch.js";
import type { InpaintMethod } from "./inpaint.js";
import type { RunInpaint, RunInpaintOptions } from "../image.js";

export interface HealQueueJob {
  /** Clean (repair-free) base the groups heal against. */
  source: PixelImage;
  /** Fixed group list for this job; later strokes form later jobs. */
  groups: RetouchStrokeGroup[];
  method: InpaintMethod;
  /** Base options (quality/feather); areas + onProgress are managed here. */
  options?: RunInpaintOptions;
  runInpaint: RunInpaint;
  /** Abort between groups (photo change/unmount). The running group finishes. */
  shouldAbort?: () => boolean;
  /** Called after each healed group, in order — cache it, then persist it. */
  onGroupDone?: (patch: CachedHealPatch, group: RetouchStrokeGroup) => Promise<void> | void;
  onProgress?: HealProgress;
}

export interface HealQueue {
  /** Jobs waiting (excluding the running job's remaining groups). */
  readonly pendingJobs: number;
  /** True while a job's groups are healing. */
  readonly active: boolean;
  enqueue(job: HealQueueJob | HealQueueDeferredJob): Promise<void>;
  /** Drop waiting jobs; the running group still finishes. */
  clear(): void;
}

/**
 * A job planned at start time, not enqueue time: the processor calls
 * prepare when the job reaches the front, so rapid follow-up clicks
 * partition against the latest cache (already-finished groups are valid,
 * never rehealed) instead of a stale enqueue-time snapshot.
 */
export interface HealQueueDeferredJob {
  prepare: () => Promise<HealQueueJob | null> | HealQueueJob | null;
  /** Abort before starting (photo change/unmount). The running job keeps going. */
  shouldAbort?: () => boolean;
}

/**
 * Create a serial queue. `healSingleGroup` is injected for tests; the
 * default is the real implementation.
 */
export function createHealQueue(
  healGroup: typeof healSingleGroup = healSingleGroup,
): HealQueue {
  const waiting: { job: HealQueueJob | HealQueueDeferredJob; resolve: () => void; reject: (error: unknown) => void }[] = [];
  let active = false;

  async function pump(): Promise<void> {
    if (active) return;
    const next = waiting.shift();
    if (!next) return;
    active = true;
    try {
      if ("prepare" in next.job) {
        if (next.job.shouldAbort?.()) {
          next.resolve();
        } else {
          const planned = await next.job.prepare();
          if (planned) await runJob(planned);
          next.resolve();
        }
      } else {
        await runJob(next.job);
        next.resolve();
      }
    } catch (error) {
      next.reject(error);
    } finally {
      active = false;
      // A rejection must not stall later jobs; keep draining.
      void pump();
    }
  }

  async function runJob(job: HealQueueJob): Promise<void> {
    const total = job.groups.length;
    if (total === 0) {
      job.onProgress?.(1, "Repair done");
      return;
    }
    const base = job.options ?? {};
    for (let index = 0; index < job.groups.length; index += 1) {
      if (job.shouldAbort?.()) return;
      const group = job.groups[index]!;
      const doneBase = index / total;
      const step = 1 / total;
      // Areas stays constant for the whole job so the copy never flickers.
      const areas = total;
      const options: RunInpaintOptions = {
        ...base,
        areas,
        // Aggregate position for aggregate-aware transports (the app's
        // remote heal maps per-group fractions before recording, so only
        // the last group can flash "done"). The wrapper below covers
        // transports that report progress only via onProgress.
        aggregate: { index, total },
        onProgress: (fraction, _stage) => {
          const clamped = Math.max(0, Math.min(1, fraction));
          // Suppress the transport's per-group terminal: only the queue
          // emits "Repair done", after the job's last group.
          if (clamped >= 1) return;
          job.onProgress?.(
            doneBase + clamped * step,
            total > 1 ? `Repairing ${index + 1} of ${total}…` : "Repairing…",
          );
        },
      };
      let patch: CachedHealPatch | null;
      try {
        patch = await healGroup(job.source, group, job.method, job.runInpaint, options);
      } catch {
        // Keep the blur fallback for this group; others still upgrade.
        // Progress still advances so the bar never stalls on one group.
        job.onProgress?.(
          (index + 1) / total,
          total > 1 ? `Repairing ${index + 1} of ${total}…` : "Repairing…",
        );
        continue;
      }
      if (job.shouldAbort?.()) return;
      if (patch) {
        try {
          await job.onGroupDone?.(patch, group);
        } catch {
          // A failed cache/persist/render hook must not abandon the
          // remaining groups; the blur fallback stays under this one.
        }
      }
      const last = index === total - 1;
      job.onProgress?.(
        last ? 1 : (index + 1) / total,
        last ? "Repair done" : `Repairing ${index + 1} of ${total}…`,
      );
    }
  }

  return {
    get pendingJobs() {
      return waiting.length;
    },
    get active() {
      return active;
    },
    enqueue(job: HealQueueJob | HealQueueDeferredJob) {
      return new Promise<void>((resolve, reject) => {
        waiting.push({ job, resolve, reject });
        void pump();
      });
    },
    clear() {
      // Rejecting would surface as unhandled in fire-and-forget callers;
      // resolve instead — dropped jobs simply never ran.
      while (waiting.length) waiting.shift()!.resolve();
    },
  };
}
