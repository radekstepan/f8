// React binding for repair inpainting: owns the Telea/NS method choice,
// subscribes to worker readiness for the inspector status line, and exposes
// the stable worker transport that PhotoCanvas and export inject into core's
// applyInpaintRepair/exportPhoto. Blur stays the automatic fallback: callers
// render blur first and upgrade to inpaint only on success.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  INPAINT_DEFAULT_METHOD,
  type InpaintMethod,
  type PixelImage,
  type RepairMask,
  type RunInpaint,
  type VisionWorkerStatus,
} from "@photomator/core";
import { getVisionWorkerClient } from "./visionClient";

export interface InpaintRepairState {
  method: InpaintMethod;
  status: VisionWorkerStatus;
  /** Stable worker transport for core's applyInpaintRepair/exportPhoto. */
  run: RunInpaint;
  setMethod: (method: InpaintMethod) => void;
}

export function useInpaintRepair(): InpaintRepairState {
  const [client] = useState(getVisionWorkerClient);
  const [method, setMethod] = useState<InpaintMethod>(INPAINT_DEFAULT_METHOD);
  const [status, setStatus] = useState<VisionWorkerStatus>(client.status);

  useEffect(() => client.subscribe(setStatus), [client]);

  const run = useCallback<RunInpaint>(
    (image: PixelImage, mask: RepairMask, radius: number, next: InpaintMethod) =>
      client.inpaint(image, mask, radius, next),
    [client],
  );

  return useMemo(() => ({ method, status, run, setMethod }), [method, status, run]);
}
