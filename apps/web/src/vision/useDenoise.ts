// React binding for lightweight denoise: preview on a ≤512px downsample
// first, then apply at up to 2048px as the canvas/export base.
//
// Denoising runs on the source photo (photo.src), never on an already
// denoised base — the Inspector always receives the original photo, while
// the canvas and export receive the denoised base URL once applied. The
// recipe stores only {strength, auto, source}; the pixels are a session
// artifact, so reopening a photo offers a one-click restore at the stored
// strength instead of silently showing the noisy original.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DENOISE_APPLY_WIDTH,
  DENOISE_PREVIEW_WIDTH,
  decodeDownsampled,
  dismissDenoiseStatus,
  type DenoiseSource,
} from "@f8/core";
import {
  runRemoteDenoise,
  warmupRemoteDenoise,
} from "./remoteDenoise";

export type DenoiseStatus = "idle" | "previewing" | "preview-ready" | "applying" | "applied" | "error";

export interface DenoisePreview {
  /** Object URLs for the before/after pair (revoked on reset/clear). */
  beforeUrl: string;
  afterUrl: string;
  strength: number;
  source: DenoiseSource;
}

export interface DenoiseAppliedBase {
  /** Object URL serving as the canvas/export src while applied. */
  url: string;
  width: number;
  height: number;
  strength: number;
  /** True when the strength is the untouched Auto suggestion (any manual slider move clears it). */
  auto: boolean;
  source: DenoiseSource;
}

export interface DenoiseProgress {
  fraction: number;
  stage: string;
  updatedAt: number;
}

export interface Denoise {
  status: DenoiseStatus;
  /** Downsampled before/after; set when preview-ready (and kept after apply). */
  preview: DenoisePreview | null;
  /** Full-res denoised base; set when applied. */
  appliedBase: DenoiseAppliedBase | null;
  /** Live server progress (warmup + denoise); mirrors ML-heal progress. */
  progress: DenoiseProgress | null;
  /** True while the server run is warming/denoising. */
  busy: boolean;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when status is error. */
  message: string | null;
  previewPhoto: (src: string, strength: number) => void;
  applyPhoto: (src: string, strength: number, auto: boolean) => void;
  /** Drop the applied base (the recipe clear is the caller's job). */
  clearApplied: () => void;
  dismiss: () => void;
}

function pixelsToBlobUrl(pixels: { width: number; height: number; data: Uint8ClampedArray }): string {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  // toDataURL is synchronous: blob URLs would need async plumbing for no
  // gain at these sizes, and PNG keeps the before/after pixel-exact.
  return canvas.toDataURL("image/png");
}

const CLASSIC_NOTE = "Classical denoise — ML weights are still downloading or offline, so this is approximate.";

export function useDenoise(photoId: string): Denoise {
  const [status, setStatus] = useState<DenoiseStatus>("idle");
  const [preview, setPreview] = useState<DenoisePreview | null>(null);
  const [appliedBase, setAppliedBase] = useState<DenoiseAppliedBase | null>(null);
  const [progress, setProgress] = useState<DenoiseProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestRef.current += 1;
    setStatus("idle");
    setPreview(null);
    setAppliedBase(null);
    setProgress(null);
    setBusy(false);
    setNote(null);
    setMessage(null);
  }, []);

  useEffect(() => {
    reset();
  }, [photoId, reset]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestRef.current += 1;
    setProgress(null);
    setBusy(false);
    setMessage(null);
    // Dismissing keeps applied pixels (the canvas still shows them) but
    // drops previews and errors back to the surrounding state.
    setStatus((current) => {
      const next = dismissDenoiseStatus(current, appliedBase !== null);
      if (next === null) return current;
      setPreview(null);
      return next;
    });
  }, [appliedBase]);

  const clearApplied = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestRef.current += 1;
    setAppliedBase(null);
    setPreview(null);
    setProgress(null);
    setBusy(false);
    setNote(null);
    setMessage(null);
    setStatus("idle");
  }, []);

  const report = useCallback((fraction: number, stage: string) => {
    setProgress({ fraction: Math.max(0, Math.min(1, fraction)), stage, updatedAt: Date.now() });
  }, []);

  const run = useCallback(
    (kind: "preview" | "apply", src: string, strength: number, auto: boolean) => {
      const request = requestRef.current + 1;
      requestRef.current = request;
      abortRef.current?.abort();
      const aborter = new AbortController();
      abortRef.current = aborter;
      setProgress(null);
      setNote(null);
      setMessage(null);
      setStatus(kind === "preview" ? "previewing" : "applying");
      setBusy(true);
      void (async () => {
        let pixels;
        try {
          pixels = await decodeDownsampled(src, kind === "preview" ? DENOISE_PREVIEW_WIDTH : DENOISE_APPLY_WIDTH);
        } catch {
          if (requestRef.current !== request) return;
          setStatus("error");
          setBusy(false);
          setMessage("This photo's pixels can't be analyzed here. Imported photos always work.");
          return;
        }
        if (requestRef.current !== request || aborter.signal.aborted) return;
        try {
          await warmupRemoteDenoise({ onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          const remote = await runRemoteDenoise(pixels, strength, kind, { onProgress: report, signal: aborter.signal });
          if (requestRef.current !== request || aborter.signal.aborted) return;
          const afterUrl = pixelsToBlobUrl(remote);
          const sourceNote = remote.source === "onnx" ? null : CLASSIC_NOTE;
          if (kind === "preview") {
            setPreview({ beforeUrl: pixelsToBlobUrl(pixels), afterUrl, strength: remote.strength, source: remote.source });
            setProgress(null);
            setBusy(false);
            setNote(sourceNote);
            setStatus("preview-ready");
          } else {
            // The recipe patch is the caller's job (an effect matching on
            // this base): the hook owns pixels, the app owns the recipe.
            setAppliedBase({ url: afterUrl, width: remote.width, height: remote.height, strength: remote.strength, auto, source: remote.source });
            setProgress(null);
            setBusy(false);
            setNote(sourceNote);
            setStatus("applied");
          }
        } catch (error) {
          if (requestRef.current !== request) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setProgress(null);
          setBusy(false);
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Denoise failed.");
        }
      })();
    },
    [report],
  );

  const previewPhoto = useCallback((src: string, strength: number) => run("preview", src, strength, false), [run]);
  const applyPhoto = useCallback(
    (src: string, strength: number, auto: boolean) => run("apply", src, strength, auto),
    [run],
  );

  return { status, preview, appliedBase, progress, busy, note, message, previewPhoto, applyPhoto, clearApplied, dismiss };
}
