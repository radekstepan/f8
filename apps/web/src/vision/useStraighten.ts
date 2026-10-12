// React binding for auto-straighten detection: downsamples the current photo,
// runs Hough-based horizon detection in the vision worker, and — when its
// confidence is low — automatically falls back to the server ML estimate
// (gradient vote today, tilt-regressor ONNX once weights land), reporting
// the same progress stages as ML heal. Estimates are auto-applied by the
// Inspector (one undo step each); the pre-Auto value is snapshotted there
// for one-click Revert. Suggestions never carry across photos.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD,
  STRAIGHTEN_WORKING_WIDTH,
  decodeDownsampled,
} from "@photomator/core";
import { getVisionWorkerClient } from "./visionClient";
import { runRemoteStraighten, warmupRemoteStraighten } from "./remoteStraighten";

export type StraightenAssistState = "idle" | "loading" | "detecting" | "ready" | "error";

export interface StraightenMlProgress {
  fraction: number;
  stage: string;
  updatedAt: number;
}

export interface StraightenAssistResult {
  state: StraightenAssistState;
  /** Suggested straighten value in degrees; set only when state is ready. */
  angle: number | null;
  /** Confidence 0..1; set only when state is ready. */
  confidence: number | null;
  /** "ml" when the suggestion came from the photo server, else "classic". */
  source: "classic" | "ml" | null;
  /** Per-run id, bumped on every detect() and reset to 0 on dismiss/photo switch. */
  runId: number;
  /** Live server progress (warmup + estimate); mirrors ML-heal progress. */
  mlProgress: StraightenMlProgress | null;
  /** True while the server fallback is warming/estimating. */
  mlWarming: boolean;
  /** Note when the server run failed but the classic result is kept. */
  mlNote: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  detect: (src: string) => void;
  dismiss: () => void;
  cancelMl: () => void;
}

export function useStraighten(photoId: string): StraightenAssistResult {
  const [client] = useState(getVisionWorkerClient);
  const [state, setState] = useState<StraightenAssistState>("idle");
  const [angle, setAngle] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [source, setSource] = useState<"classic" | "ml" | null>(null);
  const [runId, setRunId] = useState(0);
  const [mlProgress, setMlProgress] = useState<StraightenMlProgress | null>(null);
  const [mlWarming, setMlWarming] = useState(false);
  const [mlNote, setMlNote] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestRef.current += 1;
    setState("idle");
    setRunId(0);
    setAngle(null);
    setConfidence(null);
    setSource(null);
    setMlProgress(null);
    setMlWarming(false);
    setMlNote(null);
    setMessage(null);
  }, []);

  useEffect(() => {
    reset();
  }, [photoId, reset]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const dismiss = useCallback(() => reset(), [reset]);

  const cancelMl = useCallback(() => {
    // Cancel the server run but keep the classic suggestion: the user asked
    // for auto-straighten and the on-device vote already answered.
    const request = requestRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    setMlProgress(null);
    setMlWarming(false);
    setMlNote("Server estimate cancelled — showing the on-device result.");
    // If we were mid-fallback the state is still detecting; the classic
    // values (if any) were already set below before the fallback started.
    if (requestRef.current === request) {
      setState((prev) => (prev === "detecting" && angle !== null ? "ready" : prev));
    }
  }, [angle]);

  const reportMl = useCallback((fraction: number, stage: string) => {
    setMlProgress({ fraction: Math.max(0, Math.min(1, fraction)), stage, updatedAt: Date.now() });
  }, []);

  const detect = useCallback(
    (src: string) => {
      const request = requestRef.current + 1;
      requestRef.current = request;
      abortRef.current?.abort();
      const aborter = new AbortController();
      abortRef.current = aborter;
      setAngle(null);
      setConfidence(null);
      setSource(null);
      setMlProgress(null);
      setMlWarming(false);
      setMlNote(null);
      setMessage(null);
      setRunId(request);
      setState(client.status === "ready" ? "detecting" : "loading");
      void (async () => {
        let pixels;
        try {
          pixels = await decodeDownsampled(src, STRAIGHTEN_WORKING_WIDTH);
        } catch {
          if (requestRef.current !== request) return;
          setState("error");
          setMessage("This photo's pixels can't be analyzed here. Imported photos always work.");
          return;
        }
        if (requestRef.current !== request || aborter.signal.aborted) return;
        setState("detecting");
        let classic: { angle: number; confidence: number };
        try {
          classic = await client.straighten(pixels);
        } catch (error) {
          if (requestRef.current !== request) return;
          const detail = error instanceof Error ? error.message : String(error);
          setState("error");
          setMessage(
            /timed out/i.test(detail)
              ? "Detection timed out. Check your connection and try again."
              : `Auto-straighten couldn't run (${detail}).`,
          );
          return;
        }
        if (requestRef.current !== request || aborter.signal.aborted) return;
        if (classic.confidence >= STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD) {
          setAngle(classic.angle);
          setConfidence(classic.confidence);
          setSource("classic");
          setState("ready");
          return;
        }
        // Low confidence: keep the classic answer visible, then try the
        // server automatically (same progress UI as ML heal).
        setAngle(classic.angle);
        setConfidence(classic.confidence);
        setSource("classic");
        setMlWarming(true);
        try {
          await warmupRemoteStraighten({ onProgress: reportMl, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          const remote = await runRemoteStraighten(pixels, { onProgress: reportMl, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          setAngle(remote.angle);
          setConfidence(remote.confidence);
          setSource("ml");
          setMlProgress(null);
          setMlWarming(false);
          setMlNote(
            remote.source === "onnx"
              ? null
              : "On-device confidence was low — refined on the photo server.",
          );
          setState("ready");
        } catch (error) {
          if (requestRef.current !== request) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          // Server unreachable: the classic suggestion stays; note why.
          setMlProgress(null);
          setMlWarming(false);
          setMlNote("Server estimate unavailable — showing the on-device result.");
          setState("ready");
        }
      })();
    },
    [client, reportMl],
  );

  return { state, angle, confidence, source, runId, mlProgress, mlWarming, mlNote, message, detect, dismiss, cancelMl };
}
