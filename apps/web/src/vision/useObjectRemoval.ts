// React binding for ML one-click object removal: detect people on the photo
// server, let the user confirm which ones to remove, then apply them as
// repair strokes (one stroke id per person) that the existing ROI→inpaint
// pipeline heals — overlays, undo, and per-person delete come free.
//
// Detection runs on the source photo (photo.src), so boxes align with
// unrotated, uncropped framing; rotation/crop remapping is a follow-up.
// Suggestions never carry across photos.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OBJECT_DETECT_WORKING_WIDTH,
  decodeDownsampled,
  detectionsToRepairPoints,
  nextRetouchStrokeId,
  type DetectedObject,
  type ObjectDetectSource,
  type RetouchPoint,
} from "@f8/core";
import { runRemoteObjectDetect, warmupRemoteObjectDetect } from "./remoteObjectDetect";

export type ObjectRemovalState = "idle" | "detecting" | "ready" | "error";

/** One detection plus the user's confirm checkbox. */
export interface RemovableDetection extends DetectedObject {
  checked: boolean;
}

export interface ObjectRemovalProgress {
  fraction: number;
  stage: string;
  updatedAt: number;
}

export interface ObjectRemovalResult {
  state: ObjectRemovalState;
  /** Detections with confirm flags; set when state is ready. */
  detections: RemovableDetection[];
  /** "onnx" when YOLO served, "classic" for the skin-tone fallback. */
  source: ObjectDetectSource | null;
  /** Live server progress (warmup + detect); mirrors ML-heal progress. */
  progress: ObjectRemovalProgress | null;
  /** True while the server run is warming/detecting. */
  detecting: boolean;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  detect: (src: string) => void;
  toggle: (index: number) => void;
  /** Repair strokes for the checked detections (empty when none checked). */
  apply: (existing: readonly RetouchPoint[], aspect: number) => RetouchPoint[];
  dismiss: () => void;
}

export function useObjectRemoval(photoId: string): ObjectRemovalResult {
  const [state, setState] = useState<ObjectRemovalState>("idle");
  const [detections, setDetections] = useState<RemovableDetection[]>([]);
  const [source, setSource] = useState<ObjectDetectSource | null>(null);
  const [progress, setProgress] = useState<ObjectRemovalProgress | null>(null);
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
    setDetections([]);
    setSource(null);
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

  const toggle = useCallback((index: number) => {
    setDetections((current) =>
      current.map((detection, i) => (i === index ? { ...detection, checked: !detection.checked } : detection)),
    );
  }, []);

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
      setDetections([]);
      setSource(null);
      setProgress(null);
      setNote(null);
      setMessage(null);
      setState("detecting");
      setDetecting(true);
      void (async () => {
        let pixels;
        try {
          pixels = await decodeDownsampled(src, OBJECT_DETECT_WORKING_WIDTH);
        } catch {
          if (requestRef.current !== request) return;
          setState("error");
          setDetecting(false);
          setMessage("This photo's pixels can't be analyzed here. Imported photos always work.");
          return;
        }
        if (requestRef.current !== request || aborter.signal.aborted) return;
        try {
          await warmupRemoteObjectDetect({ onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          const remote = await runRemoteObjectDetect(pixels, { onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          setDetections(remote.detections.map((detection) => ({ ...detection, checked: true })));
          setSource(remote.source);
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

  const apply = useCallback(
    (existing: readonly RetouchPoint[], aspect: number): RetouchPoint[] => {
      const checked = detections.filter((detection) => detection.checked);
      if (checked.length === 0) return [];
      return detectionsToRepairPoints(checked, aspect, { stroke: nextRetouchStrokeId(existing) });
    },
    [detections],
  );

  return { state, detections, source, progress, detecting, note, message, detect, toggle, apply, dismiss };
}
