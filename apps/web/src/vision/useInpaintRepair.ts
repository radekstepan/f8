// React binding for repair inpainting: owns the method choice (ml-heal, heal,
// telea/ns) and the heal quality preset, subscribes to worker readiness for
// status line, records live ML progress (download/inference stages) for the
// inspector, and exposes the stable worker transport that PhotoCanvas and
// export inject into core's applyInpaintRepair/exportPhoto. Blur stays the
// automatic fallback: callers render blur first and upgrade to inpaint only
// on success.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BLEND_FEATHER_PX,
  HEAL_DEFAULT_QUALITY,
  INPAINT_DEFAULT_METHOD,
  ML_HEAL_DIFFUSION_TIMEOUT_MS,
  mlHealEngineForQuality,
  recordTestHealCall,
  type HealQuality,
  type InpaintMethod,
  type MlHealEngine,
  type PixelImage,
  type RepairMask,
  type RunInpaint,
  type RunInpaintOptions,
  type VisionWorkerStatus,
} from "@f8/core";
import { getVisionWorkerClient } from "./visionClient";
import { RemoteHealError, runRemoteHeal, warmupRemoteHeal } from "./remoteMlHeal";
import { readToolPrefsRaw, writeToolPrefsRaw } from "../hooks/useToolPrefs";

export interface MlProgress {
  fraction: number;
  stage: string;
  /** heal job vs warmup prefetch — warmup never masks an active job. */
  job: "heal" | "warmup";
  /** Repair areas covered by the active heal job (stamps/groups). */
  areas: number | null;
  /** Last update timestamp (Date.now()) for still-working inference. */
  updatedAt: number;
}

export interface MlReadyState {
  engine: MlHealEngine;
  cached: boolean;
  /** True when the warmed engine serves real inference (never a fallback). */
  serving: boolean;
  updatedAt: number;
}

export interface InpaintRepairState {
  method: InpaintMethod;
  quality: HealQuality;
  seamlessLight: boolean;
  featherPx: number;
  status: VisionWorkerStatus;
  /** Latest ML progress (warmup or job); null when nothing ran yet. */
  mlProgress: MlProgress | null;
  /** Engine readiness from the last warmup/job (cached = on device). */
  mlReady: MlReadyState | null;
  /** Engine the current ML Heal quality tier resolves to. */
  mlEngine: MlHealEngine;
  /** True while the current tier's weights/sessions are being prefetched. */
  mlWarming: boolean;
  /** True when the last ML attempt found the photo server down (unreachable/timeout). */
  serverDown: boolean;
  /** Stable worker transport for core's applyInpaintRepair/exportPhoto. */
  run: RunInpaint;
  /** Prefetch weights + sessions for the current tier (Repair tool opened). */
  warmup: () => Promise<{ engine: MlHealEngine; cached: boolean }>;
  /** Abort a hung heal/warmup: restarts the worker, clears progress + readiness. */
  cancelHeal: () => void;
  setMethod: (method: InpaintMethod) => void;
  setQuality: (quality: HealQuality) => void;
  setSeamlessLight: (value: boolean) => void;
  setFeatherPx: (value: number) => void;
}

function isErrorStage(stage: string): boolean {
  return stage.startsWith("Model unavailable");
}

/** Only unreachable/timeout failures mean the server is down; a server that
 * answers with an error (failed heal, bad snapshot) is up but unhappy. */
function isServerDownError(error: unknown): boolean {
  return error instanceof RemoteHealError && error.code !== "failed";
}

/** Tool prefs live in one localStorage object (see hooks/useToolPrefs); the
 * repair hook reads its slice lazily and writes back on change. Adjust
 * sliders are excluded by design — those persist per-photo on the server. */
function readPref<K extends "repairMethod" | "repairQuality" | "seamlessLight" | "featherPx", V>(
  key: K,
  fallback: V,
): V {
  const value = readToolPrefsRaw()[key];
  return (value === undefined ? fallback : value) as V;
}

function writePrefs(patch: Record<string, unknown>): void {
  writeToolPrefsRaw(patch);
}

/**
 * Map one group's transport progress onto a serial multi-group job: the bar
 * advances monotonically across groups and only the last group may report
 * terminal "Repair done". Without this, every group flashes "done" and the
 * areas copy flickers while later groups are still healing.
 */
function mapAggregateProgress(
  fraction: number,
  stage: string,
  aggregate: { index: number; total: number } | undefined,
): [fraction: number, stage: string] {
  if (!aggregate || aggregate.total <= 1) return [fraction, stage];
  const { index, total } = aggregate;
  const clamped = Math.max(0, Math.min(1, fraction));
  if (clamped >= 1) {
    if (index >= total - 1) return [1, "Repair done"];
    return [(index + 1) / total, `Repairing ${index + 1} of ${total}…`];
  }
  return [(index + clamped) / total, `Repairing ${index + 1} of ${total}…`];
}

export function useInpaintRepair(): InpaintRepairState {
  const [client] = useState(getVisionWorkerClient);
  const [method, setMethod] = useState<InpaintMethod>(() => readPref("repairMethod", INPAINT_DEFAULT_METHOD));
  const [quality, setQuality] = useState<HealQuality>(() => readPref("repairQuality", HEAL_DEFAULT_QUALITY));
  const [seamlessLight, setSeamlessLight] = useState(() => readPref("seamlessLight", false));
  const [featherPx, setFeatherPx] = useState(() => readPref("featherPx", BLEND_FEATHER_PX));
  const [status, setStatus] = useState<VisionWorkerStatus>(client.status);
  const [mlProgress, setMlProgress] = useState<MlProgress | null>(null);
  const [mlReady, setMlReady] = useState<MlReadyState | null>(null);
  const [mlWarming, setMlWarming] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const progressRef = useRef(mlProgress);
  progressRef.current = mlProgress;
  /** Set before an intentional cancel so the rejection isn't recorded as a stall. */
  const cancelledRef = useRef(false);

  useEffect(() => client.subscribe(setStatus), [client]);

  useEffect(() => {
    writePrefs({ repairMethod: method, repairQuality: quality, seamlessLight, featherPx });
  }, [method, quality, seamlessLight, featherPx]);

  const record = useCallback(
    (fraction: number, stage: string, job: "heal" | "warmup", areas: number | null, qualityOverride?: HealQuality) => {
      const clamped = Math.max(0, Math.min(1, fraction));
      const prev = progressRef.current;
      // Warmup must never clobber an active heal job's stage/areas; errors
      // always win so failures stay visible.
      if (job === "warmup" && prev?.job === "heal" && !isErrorStage(stage)) {
        const lastUpdate = prev.updatedAt;
        if (Date.now() - lastUpdate < 30_000 && prev.fraction < 1) return;
      }
      if (
        prev &&
        prev.stage === stage &&
        prev.job === job &&
        prev.areas === areas &&
        Math.abs(prev.fraction - clamped) < 0.005
      ) {
        return;
      }
      const next: MlProgress = { fraction: clamped, stage, job, areas, updatedAt: Date.now() };
      setMlProgress(next);
      // Terminal success marks the engine serving (drives the "server
      // ready" note). Serving is only ever true after real readiness —
      // warmup sets it explicitly from the server poll.
      if (clamped >= 1 && !isErrorStage(stage)) {
        const engine = mlHealEngineForQuality(qualityOverride ?? quality);
        setMlReady({ engine, cached: true, serving: true, updatedAt: Date.now() });
        // A neural success proves the server is back.
        if (engine !== "classic") setServerDown(false);
      }
    },
    [quality],
  );

  const run = useCallback<RunInpaint>(
    (image: PixelImage, mask: RepairMask, radius: number, next: InpaintMethod, options?: RunInpaintOptions) => {
      const callerProgress = options?.onProgress;
      const areas = typeof options?.areas === "number" ? options.areas : null;
      const requestedQuality = options?.quality ?? quality;
      // Fast is classic-heal only: an ml-heal call asking for it (legacy
      // session) heals at Balanced instead of silently dropping to exemplar.
      const effectiveQuality = next === "ml-heal" && requestedQuality === "fast" ? "balanced" : requestedQuality;
      // E2E observability: record the transport call before dispatch so specs
      // can assert per-group method/quality/areas/aggregate without pixels.
      recordTestHealCall({ method: next, quality: effectiveQuality, seamlessLight: options?.seamlessLight, featherPx: options?.featherPx, areas, aggregate: options?.aggregate });
      // All ML tiers run on the photo server, never in the browser: the
      // in-browser paths hung multi-area jobs. Server-required, always up.
      if (next === "ml-heal" && mlHealEngineForQuality(effectiveQuality) !== "classic") {
        const engine = mlHealEngineForQuality(effectiveQuality);
        const timeoutMs = options?.timeoutMs ?? (engine === "lama" ? undefined : ML_HEAL_DIFFUSION_TIMEOUT_MS);
        const aggregate = options?.aggregate;
        return runRemoteHeal(engine, image, mask, {
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          onProgress: (fraction, stage) => {
            const [mappedFraction, mappedStage] = mapAggregateProgress(fraction, stage, aggregate);
            if (next === "ml-heal" || next === "heal") record(mappedFraction, mappedStage, "heal", areas, effectiveQuality);
            callerProgress?.(mappedFraction, mappedStage);
          },
        }).catch((error: unknown) => {
          if (cancelledRef.current) {
            cancelledRef.current = false;
            throw error;
          }
          if (isServerDownError(error)) setServerDown(true);
          const detail = error instanceof Error ? error.message : String(error);
          record(0, `Model unavailable: ${detail}`, "heal", areas);
          throw error;
        });
      }
      // Diffusion heals need a long ceiling; progress re-arms it per message.
      const timeoutMs = options?.timeoutMs;
      const aggregate = options?.aggregate;
      return client
        .inpaint(image, mask, radius, next, {
          ...options,
          quality: effectiveQuality,
          seamlessLight: options?.seamlessLight ?? seamlessLight,
          timeoutMs,
          onProgress: (fraction, stage) => {
            const [mappedFraction, mappedStage] = mapAggregateProgress(fraction, stage, aggregate);
            if (next === "ml-heal" || next === "heal") record(mappedFraction, mappedStage, "heal", areas, effectiveQuality);
            callerProgress?.(mappedFraction, mappedStage);
          },
        })
        .catch((error: unknown) => {
          if (cancelledRef.current) {
            cancelledRef.current = false;
            throw error;
          }
          // A hung/failed heal must surface instead of freezing the bar at
          // the last step forever (blur fallback stays underneath).
          if (next === "ml-heal") {
            const detail = error instanceof Error ? error.message : String(error);
            record(0, `Model unavailable: Repair stalled — ${detail}`, "heal", areas);
          }
          throw error;
        });
    },
    [client, quality, seamlessLight, record],
  );

  const warmup = useCallback(() => {
    // Warmup only runs for ML Heal (the app gates on method): Fast has no ML
    // tier, so a legacy fast quality warms Balanced instead of no-op'ing.
    const warmedQuality = quality === "fast" ? "balanced" : quality;
    const engine = mlHealEngineForQuality(warmedQuality);
    if (engine === "classic") return Promise.resolve({ engine, cached: true, serving: true });
    // Every ML tier warms the photo server, never the browser worker: kick
    // provisioning and poll until it serves, with real download %.
    setMlWarming(true);
    setServerDown(false);
    return warmupRemoteHeal(engine, {
      onProgress: (fraction, stage) => record(fraction, stage, "warmup", null, warmedQuality),
    })
      .then((result) => {
        const ready = { engine, cached: true, serving: result.serving, updatedAt: Date.now() };
        setMlReady(ready);
        setMlWarming(false);
        return ready;
      })
      .catch((error: unknown) => {
        // Keep a not-serving marker so painting stays gated; the Inspector
        // shows one offline line (server down) or the error below.
        setMlReady({ engine, cached: false, serving: false, updatedAt: Date.now() });
        setMlWarming(false);
        if (isServerDownError(error)) setServerDown(true);
        record(0, error instanceof Error ? `Model unavailable: ${error.message}` : "Model unavailable", "warmup", null);
        throw error;
      });
  }, [quality, record]);

  // Fast has no ML tier: the exposed quality/engine always coerce fast to
  // balanced under ml-heal so callers never see the legacy combination.
  const exposedQuality: HealQuality = method === "ml-heal" && quality === "fast" ? "balanced" : quality;
  const mlEngine = mlHealEngineForQuality(exposedQuality);

  const cancelHeal = useCallback(() => {
    cancelledRef.current = true;
    // Restart the worker: a hung diffusion loop can't poison later strokes.
    // Sessions are rebuilt on the next warmup (weights stay cached).
    client.terminate();
    setMlProgress(null);
    setMlWarming(false);
    setServerDown(false);
    setMlReady((prev) => (prev?.engine === mlEngine ? null : prev));
  }, [client, mlEngine]);

  // Switching tiers discards the previous tier's warmup error so a Moebius
  // failure never lingers under Balanced. Fast is classic-heal only and is
  // never offered under ML Heal: requests for it coerce to Balanced.
  const setQualityAndClearStale = useCallback(
    (next: HealQuality) => {
      const coerced = method === "ml-heal" && next === "fast" ? "balanced" : next;
      const prevEngine = mlHealEngineForQuality(quality);
      const nextEngine = mlHealEngineForQuality(coerced);
      if (prevEngine !== nextEngine) {
        const cur = progressRef.current;
        if (cur && (isErrorStage(cur.stage) || cur.job === "warmup")) setMlProgress(null);
        setMlWarming(false);
        setServerDown(false);
      }
      setQuality(coerced);
    },
    [quality, method],
  );

  // Entering ML Heal from classic Fast has no Fast tier: migrate to Balanced
  // so the new method always resolves to a neural engine.
  const setMethodAndMigrate = useCallback(
    (next: InpaintMethod) => {
      if (next === "ml-heal") {
        setQuality((prev) => (prev === "fast" ? "balanced" : prev));
        const cur = progressRef.current;
        if (cur && (isErrorStage(cur.stage) || cur.job === "warmup")) setMlProgress(null);
        setMlWarming(false);
      }
      setServerDown(false);
      setMethod(next);
    },
    [],
  );

  return useMemo(
    () => ({ method, quality: exposedQuality, seamlessLight, featherPx, status, mlProgress, mlReady, mlEngine, mlWarming, serverDown, run, warmup, cancelHeal, setMethod: setMethodAndMigrate, setQuality: setQualityAndClearStale, setSeamlessLight, setFeatherPx }),
    [method, exposedQuality, seamlessLight, featherPx, status, mlProgress, mlReady, mlEngine, mlWarming, serverDown, run, warmup, cancelHeal, setQualityAndClearStale, setMethodAndMigrate],
  );
}
