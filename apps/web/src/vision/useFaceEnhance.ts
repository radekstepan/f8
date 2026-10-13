// React binding for ML face-aware exposure: detect faces on the photo
// server, anchor white balance on the skin tones inside the faces, lift
// underexposed faces through a masked exposure recipe, and suppress
// red-eye pupils around the eye landmarks.
//
// Detection runs on the source photo (photo.src), so boxes align with
// unrotated, uncropped framing; rotation/crop remapping is a follow-up.
// The WB anchor, lift amount, and red-eye discs all derive from the same
// ≤640px decode the detect request sends — no second decode. Suggestions
// never carry across photos. Apply is all-or-nothing (no per-face toggles):
// the white balance is global from all faces' skin, and the masked lift is
// gentle enough to review as one result.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FACE_DETECT_WORKING_WIDTH,
  computeFaceWhiteBalance,
  computeWhiteBalanceAuto,
  decodeDownsampled,
  faceAdjustForFaces,
  type DetectedFace,
  type FaceAdjustState,
  type FaceDetectSource,
  type WhiteBalanceAutoPatch,
} from "@f8/core";
import { runRemoteFaceDetect, warmupRemoteFaceDetect } from "./remoteFaceDetect";

export type FaceEnhanceState = "idle" | "detecting" | "ready" | "error";

export interface FaceEnhanceResult {
  faces: DetectedFace[];
  /** "onnx" when YuNet served, "classic" for the skin-tone fallback. */
  source: FaceDetectSource;
  /** Skin-anchored WB; null when too few skin pixels (caller uses classicWhiteBalance). */
  skinWhiteBalance: WhiteBalanceAutoPatch | null;
  /** Whole-image WB on the same pixels (the honest fallback). */
  classicWhiteBalance: WhiteBalanceAutoPatch;
  /** Masked lift + red-eye discs; null when neither changes a pixel. */
  faceAdjust: FaceAdjustState | null;
}

export interface FaceEnhanceProgress {
  fraction: number;
  stage: string;
  updatedAt: number;
}

export interface FaceEnhance {
  state: FaceEnhanceState;
  /** Detection + corrections; set when state is ready. */
  result: FaceEnhanceResult | null;
  /** Live server progress (warmup + detect); mirrors ML-heal progress. */
  progress: FaceEnhanceProgress | null;
  /** True while the server run is warming/detecting. */
  detecting: boolean;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  detect: (src: string) => void;
  dismiss: () => void;
}

export function useFaceEnhance(photoId: string): FaceEnhance {
  const [state, setState] = useState<FaceEnhanceState>("idle");
  const [result, setResult] = useState<FaceEnhanceResult | null>(null);
  const [progress, setProgress] = useState<FaceEnhanceProgress | null>(null);
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
      // Seed a progress stage synchronously so the bar appears the instant
      // the button is clicked — the local decode below reports nothing, and
      // without this the control shows only a Cancel button until the first
      // server report lands.
      setProgress({ fraction: 0, stage: "Preparing photo…", updatedAt: Date.now() });
      setNote(null);
      setMessage(null);
      setState("detecting");
      setDetecting(true);
      void (async () => {
        let pixels;
        try {
          pixels = await decodeDownsampled(src, FACE_DETECT_WORKING_WIDTH);
        } catch {
          if (requestRef.current !== request) return;
          setState("error");
          setDetecting(false);
          setMessage("This photo's pixels can't be analyzed here. Imported photos always work.");
          return;
        }
        if (requestRef.current !== request || aborter.signal.aborted) return;
        try {
          await warmupRemoteFaceDetect({ onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          const remote = await runRemoteFaceDetect(pixels, { onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          setResult({
            faces: remote.faces,
            source: remote.source,
            skinWhiteBalance: computeFaceWhiteBalance(pixels, remote.faces),
            classicWhiteBalance: computeWhiteBalanceAuto(pixels),
            faceAdjust: faceAdjustForFaces(pixels, remote.faces, remote.source),
          });
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
          setMessage(error instanceof Error ? error.message : "Detection failed.");
        }
      })();
    },
    [report],
  );

  return { state, result, progress, detecting, note, message, detect, dismiss };
}
