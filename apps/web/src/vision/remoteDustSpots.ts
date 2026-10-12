// Remote dust/spot detection: the Repair tool's auto dust-spot assist runs on
// the photo server, like every neural path.
//
// The hook POSTs a ≤1280px downsample to /api/dust-spots/detect and gets
// scored dust spots back; it turns accepted spots into repair strokes (one
// stroke id per spot) that the existing ROI→inpaint pipeline heals. The
// server always serves — ML-filtered candidates by default, classical-only
// when the filter is disabled — so this transport mirrors
// remoteObjectDetect's warmup/health polling and stage copy.

import type { DustSpot, DustSpotsSource } from "@f8/core";

export class RemoteDustSpotsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteDustSpotsError";
  }
}

export const REMOTE_DUST_SPOTS_TIMEOUT_MS = 90_000;

export interface RemoteDustSpotsResult {
  spots: DustSpot[];
  source: DustSpotsSource;
}

export type DustSpotsProgress = (fraction: number, stage: string) => void;

function encodeB64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function runRemoteDustSpots(
  image: { width: number; height: number; data: Uint8ClampedArray },
  options: { onProgress?: DustSpotsProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RemoteDustSpotsResult> {
  const timeoutMs = options.timeoutMs ?? REMOTE_DUST_SPOTS_TIMEOUT_MS;
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    options.onProgress?.(0, "Contacting photo server…");
    let response: Response;
    try {
      options.onProgress?.(0.1, "Scanning for dust spots…");
      response = await fetch("/api/dust-spots/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: image.width, height: image.height, imageB64: encodeB64(image.data) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && options.signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RemoteDustSpotsError(`Photo server timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new RemoteDustSpotsError("Photo server unreachable — start it with yarn dev.");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RemoteDustSpotsError(
        `Photo server rejected the dust scan (${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}).`,
      );
    }
    const payload = (await response.json()) as { spots?: unknown; source?: unknown };
    if (!Array.isArray(payload.spots)) {
      throw new RemoteDustSpotsError("Photo server returned no spots.");
    }
    options.onProgress?.(1, "Dust scan done");
    return {
      spots: payload.spots as DustSpot[],
      source: payload.source === "ml" ? "ml" : "classic",
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

interface DustSpotsSnapshot {
  serving?: unknown;
  mlEnabled?: unknown;
  error?: unknown;
}

/**
 * Warm the dust-spots endpoint: the tiny classifier ships embedded, so one
 * health read is enough — no download polling. A configured-but-unreadable
 * custom weights file surfaces here as the classical fallback (the scan
 * still runs; the response names its source).
 */
export async function warmupRemoteDustSpots(
  options: { onProgress?: DustSpotsProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ serving: boolean }> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const startedAt = Date.now();
  options.onProgress?.(0, "Checking photo server…");
  try {
    await fetch("/api/dust-spots/warmup", { method: "POST", signal: options.signal });
  } catch {
    // Unreachable server surfaces via the poll below.
  }
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let snapshot: DustSpotsSnapshot;
    try {
      const response = await fetch("/api/dust-spots/health", { signal: options.signal });
      if (!response.ok) throw new RemoteDustSpotsError(`Server replied ${response.status}.`);
      snapshot = (await response.json()) as DustSpotsSnapshot;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new RemoteDustSpotsError("Photo server unreachable — start it with yarn dev.");
    }
    if (snapshot.serving === true) {
      options.onProgress?.(1, "Server ready.");
      return { serving: true };
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new RemoteDustSpotsError("Photo server is still preparing models — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
