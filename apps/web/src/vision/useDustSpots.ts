// React binding for ML auto dust/spot detection: scan the photo server for
// dust spots, let the user accept each spot, then apply the checked ones as
// repair strokes (one stroke id per spot) that the existing ROI→inpaint
// pipeline heals — overlays, undo, and per-spot delete come free.
//
// Detection runs on the source photo (photo.src), so spots align with
// unrotated, uncropped framing; rotation/crop remapping is a follow-up.
// Suggestions never carry across photos.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DUST_SPOTS_WORKING_WIDTH,
  decodeDownsampled,
  nextRetouchStrokeId,
  spotsToRepairPoints,
  type DustSpot,
  type DustSpotsSource,
  type RetouchPoint,
} from "@f8/core";
import { runRemoteDustSpots, warmupRemoteDustSpots } from "./remoteDustSpots";

export type DustSpotsState = "idle" | "detecting" | "ready" | "error";

/** One spot plus the user's accept checkbox. */
export interface AcceptableSpot extends DustSpot {
  checked: boolean;
}

export interface DustSpotsProgress {
  fraction: number;
  stage: string;
  updatedAt: number;
}

export interface DustSpotsResult {
  state: DustSpotsState;
  /** Spots with accept flags; set when state is ready. */
  spots: AcceptableSpot[];
  /** "ml" when the classifier filtered, "classic" for the unfiltered scan. */
  source: DustSpotsSource | null;
  /** Live server progress (warmup + scan); mirrors ML-heal progress. */
  progress: DustSpotsProgress | null;
  /** True while the server run is warming/scanning. */
  detecting: boolean;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  detect: (src: string) => void;
  toggle: (index: number) => void;
  /** Repair strokes for the checked spots (empty when none checked). */
  apply: (existing: readonly RetouchPoint[]) => RetouchPoint[];
  dismiss: () => void;
}

export function useDustSpots(photoId: string): DustSpotsResult {
  const [state, setState] = useState<DustSpotsState>("idle");
  const [spots, setSpots] = useState<AcceptableSpot[]>([]);
  const [source, setSource] = useState<DustSpotsSource | null>(null);
  const [progress, setProgress] = useState<DustSpotsProgress | null>(null);
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
    setSpots([]);
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
    setSpots((current) =>
      current.map((spot, i) => (i === index ? { ...spot, checked: !spot.checked } : spot)),
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
      setSpots([]);
      setSource(null);
      setProgress(null);
      setNote(null);
      setMessage(null);
      setState("detecting");
      setDetecting(true);
      void (async () => {
        let pixels;
        try {
          pixels = await decodeDownsampled(src, DUST_SPOTS_WORKING_WIDTH);
        } catch {
          if (requestRef.current !== request) return;
          setState("error");
          setDetecting(false);
          setMessage("This photo's pixels can't be analyzed here. Imported photos always work.");
          return;
        }
        if (requestRef.current !== request || aborter.signal.aborted) return;
        try {
          await warmupRemoteDustSpots({ onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          const remote = await runRemoteDustSpots(pixels, { onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          setSpots(remote.spots.map((spot) => ({ ...spot, checked: true })));
          setSource(remote.source);
          setProgress(null);
          setDetecting(false);
          setNote(
            remote.source === "ml"
              ? null
              : "Classical scan — the ML filter is disabled or its custom weights are unreadable, so this is approximate.",
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
    (existing: readonly RetouchPoint[]): RetouchPoint[] => {
      const checked = spots.filter((spot) => spot.checked);
      if (checked.length === 0) return [];
      return spotsToRepairPoints(checked, { stroke: nextRetouchStrokeId(existing) });
    },
    [spots],
  );

  return { state, spots, source, progress, detecting, note, message, detect, toggle, apply, dismiss };
}
