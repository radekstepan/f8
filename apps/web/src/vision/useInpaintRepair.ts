// React binding for repair inpainting: owns the Telea/NS method choice and the
// heal quality preset, subscribes to worker readiness for the inspector
// status line, and exposes the stable worker transport that PhotoCanvas and
// export inject into core's applyInpaintRepair/exportPhoto. Blur stays the
// automatic fallback: callers render blur first and upgrade to inpaint only
// on success.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HEAL_DEFAULT_QUALITY,
  INPAINT_DEFAULT_METHOD,
  type HealQuality,
  type InpaintMethod,
  type PixelImage,
  type RepairMask,
  type RunInpaint,
  type RunInpaintOptions,
  type VisionWorkerStatus,
} from "@photomator/core";
import { getVisionWorkerClient } from "./visionClient";

export interface InpaintRepairState {
  method: InpaintMethod;
  quality: HealQuality;
  status: VisionWorkerStatus;
  /** Stable worker transport for core's applyInpaintRepair/exportPhoto. */
  run: RunInpaint;
  setMethod: (method: InpaintMethod) => void;
  setQuality: (quality: HealQuality) => void;
}

export function useInpaintRepair(): InpaintRepairState {
  const [client] = useState(getVisionWorkerClient);
  const [method, setMethod] = useState<InpaintMethod>(INPAINT_DEFAULT_METHOD);
  const [quality, setQuality] = useState<HealQuality>(HEAL_DEFAULT_QUALITY);
  const [status, setStatus] = useState<VisionWorkerStatus>(client.status);

  useEffect(() => client.subscribe(setStatus), [client]);

  const run = useCallback<RunInpaint>(
    (image: PixelImage, mask: RepairMask, radius: number, next: InpaintMethod, options?: RunInpaintOptions) =>
      client.inpaint(image, mask, radius, next, { ...options, quality: options?.quality ?? quality }),
    [client, quality],
  );

  return useMemo(
    () => ({ method, quality, status, run, setMethod, setQuality }),
    [method, quality, status, run],
  );
}
