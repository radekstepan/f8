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
}

export interface InpaintRepairState {
  method: InpaintMethod;
  quality: HealQuality;
  seamlessLight: boolean;
  featherPx: number;
  status: VisionWorkerStatus;
  /** Latest ML progress (warmup or job); null when nothing ran yet. */
  mlProgress: MlProgress | null;
  /** Engine the current ML Heal quality tier resolves to. */
  mlEngine: MlHealEngine;
  /** Stable worker transport for core's applyInpaintRepair/exportPhoto. */
  run: RunInpaint;
  /** Prefetch weights + sessions for the current tier (Repair tool opened). */
  warmup: () => Promise<{ engine: MlHealEngine; cached: boolean }>;
  setMethod: (method: InpaintMethod) => void;
  setQuality: (quality: HealQuality) => void;
  setSeamlessLight: (value: boolean) => void;
  setFeatherPx: (value: number) => void;
}

export function useInpaintRepair(): InpaintRepairState {
  const [client] = useState(getVisionWorkerClient);
  const [method, setMethod] = useState<InpaintMethod>(INPAINT_DEFAULT_METHOD);
  const [quality, setQuality] = useState<HealQuality>(HEAL_DEFAULT_QUALITY);
  const [seamlessLight, setSeamlessLight] = useState(false);
  const [featherPx, setFeatherPx] = useState(BLEND_FEATHER_PX);
  const [status, setStatus] = useState<VisionWorkerStatus>(client.status);
  const [mlProgress, setMlProgress] = useState<MlProgress | null>(null);
  const progressRef = useRef(mlProgress);
  progressRef.current = mlProgress;

  useEffect(() => client.subscribe(setStatus), [client]);

  const record = useCallback((fraction: number, stage: string) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    const prev = progressRef.current;
    if (prev && prev.stage === stage && Math.abs(prev.fraction - clamped) < 0.005) return;
    setMlProgress({ fraction: clamped, stage });
  }, []);

  const run = useCallback<RunInpaint>(
    (image: PixelImage, mask: RepairMask, radius: number, next: InpaintMethod, options?: RunInpaintOptions) => {
      const callerProgress = options?.onProgress;
      return client.inpaint(image, mask, radius, next, {
        ...options,
        quality: options?.quality ?? quality,
        seamlessLight: options?.seamlessLight ?? seamlessLight,
        onProgress: (fraction, stage) => {
          if (next === "ml-heal" || next === "heal") record(fraction, stage);
          callerProgress?.(fraction, stage);
        },
      });
    },
    [client, quality, seamlessLight, record],
  );

  const warmup = useCallback(() => {
    const engine = mlHealEngineForQuality(quality);
    if (engine === "classic") return Promise.resolve({ engine, cached: true });
    return client.warmupMl(engine, { onProgress: record }).catch((error: unknown) => {
      record(0, error instanceof Error ? `Model unavailable: ${error.message}` : "Model unavailable");
      throw error;
    });
  }, [client, quality, record]);

  const mlEngine = mlHealEngineForQuality(quality);

  return useMemo(
    () => ({ method, quality, seamlessLight, featherPx, status, mlProgress, mlEngine, run, warmup, setMethod, setQuality, setSeamlessLight, setFeatherPx }),
    [method, quality, seamlessLight, featherPx, status, mlProgress, mlEngine, run, warmup],
  );
}
