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
  mlHealEngineForQuality,
  type HealQuality,
  type InpaintMethod,
  type MlHealEngine,
  type PixelImage,
  type RepairMask,
  type RunInpaint,
  type RunInpaintOptions,
  type VisionWorkerStatus,
} from "@photomator/core";
import { getVisionWorkerClient } from "./visionClient";

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
  /** Stable worker transport for core's applyInpaintRepair/exportPhoto. */
  run: RunInpaint;
  /** Prefetch weights + sessions for the current tier (Repair tool opened). */
  warmup: () => Promise<{ engine: MlHealEngine; cached: boolean }>;
  setMethod: (method: InpaintMethod) => void;
  setQuality: (quality: HealQuality) => void;
  setSeamlessLight: (value: boolean) => void;
  setFeatherPx: (value: number) => void;
}

function isErrorStage(stage: string): boolean {
  return stage.startsWith("Model unavailable");
}

export function useInpaintRepair(): InpaintRepairState {
  const [client] = useState(getVisionWorkerClient);
  const [method, setMethod] = useState<InpaintMethod>(INPAINT_DEFAULT_METHOD);
  const [quality, setQuality] = useState<HealQuality>(HEAL_DEFAULT_QUALITY);
  const [seamlessLight, setSeamlessLight] = useState(false);
  const [featherPx, setFeatherPx] = useState(BLEND_FEATHER_PX);
  const [status, setStatus] = useState<VisionWorkerStatus>(client.status);
  const [mlProgress, setMlProgress] = useState<MlProgress | null>(null);
  const [mlReady, setMlReady] = useState<MlReadyState | null>(null);
  const [mlWarming, setMlWarming] = useState(false);
  const progressRef = useRef(mlProgress);
  progressRef.current = mlProgress;

  useEffect(() => client.subscribe(setStatus), [client]);

  const record = useCallback(
    (fraction: number, stage: string, job: "heal" | "warmup", areas: number | null) => {
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
      // Terminal success marks the engine ready on device (drives the
      // transient "ready" note + hides the download suffix).
      if (clamped >= 1 && !isErrorStage(stage)) {
        const engine = mlHealEngineForQuality(quality);
        setMlReady({ engine, cached: true, updatedAt: Date.now() });
      }
    },
    [quality],
  );

  const run = useCallback<RunInpaint>(
    (image: PixelImage, mask: RepairMask, radius: number, next: InpaintMethod, options?: RunInpaintOptions) => {
      const callerProgress = options?.onProgress;
      const areas = typeof options?.areas === "number" ? options.areas : null;
      return client.inpaint(image, mask, radius, next, {
        ...options,
        quality: options?.quality ?? quality,
        seamlessLight: options?.seamlessLight ?? seamlessLight,
        onProgress: (fraction, stage) => {
          if (next === "ml-heal" || next === "heal") record(fraction, stage, "heal", areas);
          callerProgress?.(fraction, stage);
        },
      });
    },
    [client, quality, seamlessLight, record],
  );

  const warmup = useCallback(() => {
    const engine = mlHealEngineForQuality(quality);
    if (engine === "classic") return Promise.resolve({ engine, cached: true });
    setMlWarming(true);
    return client
      .warmupMl(engine, { onProgress: (fraction, stage) => record(fraction, stage, "warmup", null) })
      .then((ready) => {
        setMlReady({ engine: ready.engine, cached: ready.cached, updatedAt: Date.now() });
        setMlWarming(false);
        return ready;
      })
      .catch((error: unknown) => {
        // A failed warmup must not leave a stale "ready on this device" line
        // next to the error (see Inspector): drop readiness for this engine.
        setMlReady((prev) => (prev?.engine === engine ? null : prev));
        setMlWarming(false);
        record(0, error instanceof Error ? `Model unavailable: ${error.message}` : "Model unavailable", "warmup", null);
        throw error;
      });
  }, [client, quality, record]);

  const mlEngine = mlHealEngineForQuality(quality);

  // Switching tiers discards the previous tier's warmup error so a Moebius
  // failure never lingers under Balanced/Fast.
  const setQualityAndClearStale = useCallback(
    (next: HealQuality) => {
      const prevEngine = mlHealEngineForQuality(quality);
      const nextEngine = mlHealEngineForQuality(next);
      if (prevEngine !== nextEngine) {
        const cur = progressRef.current;
        if (cur && (isErrorStage(cur.stage) || cur.job === "warmup")) setMlProgress(null);
        setMlWarming(false);
      }
      setQuality(next);
    },
    [quality],
  );

  return useMemo(
    () => ({ method, quality, seamlessLight, featherPx, status, mlProgress, mlReady, mlEngine, mlWarming, run, warmup, setMethod, setQuality: setQualityAndClearStale, setSeamlessLight, setFeatherPx }),
    [method, quality, seamlessLight, featherPx, status, mlProgress, mlReady, mlEngine, mlWarming, run, warmup, setQualityAndClearStale],
  );
}
