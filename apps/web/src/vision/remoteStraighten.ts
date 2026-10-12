// Remote straighten: server ML fallback for low-confidence on-device votes.
//
// The worker's Hough vote runs first; when its confidence is below
// STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD the hook calls here. The server always
// serves (gradient vote today, tilt-regressor ONNX once weights land), so
// this transport mirrors remoteMlHeal's warmup/health polling and stage copy
// — the Inspector reuses the same MlProgressView.

import { STRAIGHTEN_MAX_ANGLE, type PixelImage } from "@f8/core";

export class RemoteStraightenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteStraightenError";
  }
}

export const REMOTE_STRAIGHTEN_TIMEOUT_MS = 90_000;

export interface RemoteStraightenResult {
  angle: number;
  confidence: number;
  source: "onnx" | "gradient";
}

export type StraightenProgress = (fraction: number, stage: string) => void;

function encodeB64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function runRemoteStraighten(
  image: PixelImage,
  options: { onProgress?: StraightenProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RemoteStraightenResult> {
  const timeoutMs = options.timeoutMs ?? REMOTE_STRAIGHTEN_TIMEOUT_MS;
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    options.onProgress?.(0, "Contacting photo server…");
    let response: Response;
    try {
      options.onProgress?.(0.1, "Estimating on server…");
      response = await fetch("/api/straighten/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: image.width, height: image.height, imageB64: encodeB64(image.data) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && options.signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RemoteStraightenError(`Photo server timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new RemoteStraightenError("Photo server unreachable — start it with yarn dev.");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RemoteStraightenError(
        `Photo server rejected the estimate (${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}).`,
      );
    }
    const payload = (await response.json()) as { angle?: unknown; confidence?: unknown; source?: unknown };
    if (typeof payload.angle !== "number" || typeof payload.confidence !== "number") {
      throw new RemoteStraightenError("Photo server returned no estimate.");
    }
    const angle = Math.min(STRAIGHTEN_MAX_ANGLE, Math.max(-STRAIGHTEN_MAX_ANGLE, payload.angle));
    const confidence = Math.min(1, Math.max(0, payload.confidence));
    options.onProgress?.(1, "Server estimate done");
    return { angle, confidence, source: payload.source === "onnx" ? "onnx" : "gradient" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

interface StraightenSnapshot {
  serving?: unknown;
  downloading?: unknown;
  downloadPct?: unknown;
  error?: unknown;
}

/**
 * Warm the straighten endpoint: kick provisioning and poll health until it
 * serves, reporting real download %. Resolves quickly when the gradient
 * fallback serves (no weights yet); reports download progress once a weight
 * URL is configured.
 */
export async function warmupRemoteStraighten(
  options: { onProgress?: StraightenProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ serving: boolean }> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const startedAt = Date.now();
  options.onProgress?.(0, "Checking photo server…");
  try {
    await fetch("/api/straighten/warmup", { method: "POST", signal: options.signal });
  } catch {
    // Unreachable server surfaces via the poll below.
  }
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let snapshot: StraightenSnapshot;
    try {
      const response = await fetch("/api/straighten/health", { signal: options.signal });
      if (!response.ok) throw new RemoteStraightenError(`Server replied ${response.status}.`);
      snapshot = (await response.json()) as StraightenSnapshot;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new RemoteStraightenError("Photo server unreachable — start it with yarn dev.");
    }
    if (typeof snapshot.error === "string" && snapshot.error) {
      throw new RemoteStraightenError(snapshot.error.slice(0, 220));
    }
    if (snapshot.serving === true) {
      options.onProgress?.(1, "Server ready.");
      return { serving: true };
    }
    if (snapshot.downloading === true) {
      const pct =
        typeof snapshot.downloadPct === "number" && Number.isFinite(snapshot.downloadPct)
          ? Math.max(0, Math.min(0.99, snapshot.downloadPct))
          : 0;
      options.onProgress?.(pct, `Downloading models… ${Math.round(pct * 100)}%`);
    } else {
      options.onProgress?.(0, "Preparing models…");
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new RemoteStraightenError("Photo server is still preparing models — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
