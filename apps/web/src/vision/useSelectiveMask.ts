// React binding for ML selective (masked) adjustments: segment the subject
// on the photo server, then composite masked exposure/contrast/saturation
// through the subject mask or its inverse ("brighten subject only").
//
// Segmentation runs on the source photo (photo.src), so the mask aligns
// with unrotated, uncropped framing; rotation/crop remapping is a follow-up.
// Suggestions never carry across photos. The recipe stores the mask plus the
// target and params, so undo, persistence, and preview/export all ride the
// existing recipe machinery.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SELECTIVE_MASK_WORKING_WIDTH,
  decodeDownsampled,
  type SelectiveMaskSource,
} from "@f8/core";
import {
  runRemoteSelectiveMask,
  warmupRemoteSelectiveMask,
  type RemoteSelectiveMask,
} from "./remoteSelectiveMask";

export type SelectiveMaskState = "idle" | "detecting" | "ready" | "error";

export interface SelectiveMaskResult {
  /** Null when no usable subject was found (empty or full-frame mask). */
  mask: RemoteSelectiveMask | null;
  /** Subject fraction 0..1 (reported even when the mask is null). */
  coverage: number;
  /** "onnx" when u2netp served, "classic" for the fallback proposer. */
  source: SelectiveMaskSource;
}

export interface SelectiveMaskProgress {
  fraction: number;
  stage: string;
  updatedAt: number;
}

export interface SelectiveMask {
  state: SelectiveMaskState;
  /** Segmentation result; set when state is ready. */
  result: SelectiveMaskResult | null;
  /** Live server progress (warmup + segment); mirrors ML-heal progress. */
  progress: SelectiveMaskProgress | null;
  /** True while the server run is warming/segmenting. */
  detecting: boolean;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  detect: (src: string) => void;
  dismiss: () => void;
}

export function useSelectiveMask(photoId: string): SelectiveMask {
  const [state, setState] = useState<SelectiveMaskState>("idle");
  const [result, setResult] = useState<SelectiveMaskResult | null>(null);
  const [progress, setProgress] = useState<SelectiveMaskProgress | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestRef.current += 1;
    setState("idle");
    setResult(null);
    setProgress(null);
    setDetecting(false);
    setNote(null);
    setMessage(null);
  }, []);

  useEffect(() => {
    reset();
  }, [photoId, reset]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const dismiss = useCallback(() => reset(), [reset]);

  const report = useCallback((fraction: number, stage: string) => {
    setProgress({ fraction: Math.max(0, Math.min(1, fraction)), stage, updatedAt: Date.now() });
  }, []);

  const detect = useCallback(
    (src: string) => {
      const request = requestRef.current + 1;
      requestRef.current = request;
      abortRef.current?.abort();
      const aborter = new AbortController();
      abortRef.current = aborter;
      setResult(null);
      setProgress(null);
      setNote(null);
      setMessage(null);
      setState("detecting");
      setDetecting(true);
      void (async () => {
        let pixels;
        try {
          pixels = await decodeDownsampled(src, SELECTIVE_MASK_WORKING_WIDTH);
        } catch {
          if (requestRef.current !== request) return;
          setState("error");
          setDetecting(false);
          setMessage("This photo's pixels can't be analyzed here. Imported photos always work.");
          return;
        }
        if (requestRef.current !== request || aborter.signal.aborted) return;
        try {
          await warmupRemoteSelectiveMask({ onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          const remote = await runRemoteSelectiveMask(pixels, { onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          setResult(remote);
          setProgress(null);
          setDetecting(false);
          setNote(
            remote.source === "onnx"
              ? null
              : "Classical scan — ML weights are still downloading or offline, so this is approximate.",
          );
          setState("ready");
        } catch (error) {
          if (requestRef.current !== request) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setProgress(null);
          setDetecting(false);
          setState("error");
          setMessage(error instanceof Error ? error.message : "Segmentation failed.");
        }
      })();
    },
    [report],
  );

  return { state, result, progress, detecting, note, message, detect, dismiss };
}
