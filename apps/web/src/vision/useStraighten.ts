// React binding for auto-straighten detection: downsamples the current photo,
// runs Hough-based horizon detection in the vision worker, and holds the
// suggestion until the user applies or dismisses it. Suggestions never
// carry across photos and are never applied silently.

import { useCallback, useEffect, useRef, useState } from "react";
import { STRAIGHTEN_WORKING_WIDTH, decodeDownsampled } from "@photomator/core";
import { getVisionWorkerClient } from "./visionClient";

export type StraightenAssistState = "idle" | "loading" | "detecting" | "ready" | "error";

export interface StraightenAssistResult {
  state: StraightenAssistState;
  /** Suggested straighten value in degrees; set only when state is ready. */
  angle: number | null;
  /** Confidence 0..1; set only when state is ready. */
  confidence: number | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  detect: (src: string) => void;
  dismiss: () => void;
}

export function useStraighten(photoId: string): StraightenAssistResult {
  const [client] = useState(getVisionWorkerClient);
  const [state, setState] = useState<StraightenAssistState>("idle");
  const [angle, setAngle] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setState("idle");
    setAngle(null);
    setConfidence(null);
    setMessage(null);
  }, [photoId]);

  const dismiss = useCallback(() => {
    requestRef.current += 1;
    setState("idle");
    setAngle(null);
    setConfidence(null);
    setMessage(null);
  }, []);

  const detect = useCallback(
    (src: string) => {
      const request = requestRef.current + 1;
      requestRef.current = request;
      setAngle(null);
      setConfidence(null);
      setMessage(null);
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
        if (requestRef.current !== request) return;
        setState("detecting");
        try {
          const result = await client.straighten(pixels);
          if (requestRef.current !== request) return;
          setAngle(result.angle);
          setConfidence(result.confidence);
          setState("ready");
        } catch (error) {
          if (requestRef.current !== request) return;
          const detail = error instanceof Error ? error.message : String(error);
          setState("error");
          setMessage(
            /timed out/i.test(detail)
              ? "Detection timed out. Check your connection and try again."
              : `Auto-straighten couldn't run (${detail}).`,
          );
        }
      })();
    },
    [client],
  );

  return { state, angle, confidence, message, detect, dismiss };
}
