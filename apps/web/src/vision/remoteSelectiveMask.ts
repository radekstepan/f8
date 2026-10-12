// Remote subject segmentation: ML selective (masked) adjustments' segment
// step runs on the photo server, like every neural path.
//
// The hook POSTs a ≤320px downsample to /api/selective-mask/detect and gets
// a soft subject mask back (base64 8-bit at ≤96px long edge, ready to store
// in the recipe); the client composites masked exposure/contrast/saturation
// through the mask or its inverse. The server always serves — u2netp ONNX
// once weights land, the classical proposer until then — so this transport
// mirrors remoteFaceDetect's warmup/health polling and stage copy.

import type { SelectiveMaskSource } from "@f8/core";

export class RemoteSelectiveMaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteSelectiveMaskError";
  }
}

export const REMOTE_SELECTIVE_MASK_TIMEOUT_MS = 120_000;

export interface RemoteSelectiveMask {
  maskB64: string;
  maskWidth: number;
  maskHeight: number;
}

export interface RemoteSelectiveMaskResult {
  /** Null when no usable subject was found (empty or full-frame mask). */
  mask: RemoteSelectiveMask | null;
  /** Subject fraction 0..1 (reported even when the mask is null). */
  coverage: number;
  source: SelectiveMaskSource;
}

export type SelectiveMaskProgress = (fraction: number, stage: string) => void;

function encodeB64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function parseWireMask(value: unknown): RemoteSelectiveMask | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") throw new RemoteSelectiveMaskError("Photo server returned a bad mask.");
  const { maskB64, maskWidth, maskHeight } = value as Record<string, unknown>;
  if (
    typeof maskB64 !== "string" ||
    !Number.isInteger(maskWidth) ||
    !Number.isInteger(maskHeight) ||
    (maskWidth as number) <= 0 ||
    (maskHeight as number) <= 0
  ) {
    throw new RemoteSelectiveMaskError("Photo server returned a bad mask.");
  }
  return { maskB64, maskWidth: maskWidth as number, maskHeight: maskHeight as number };
}

export async function runRemoteSelectiveMask(
  image: { width: number; height: number; data: Uint8ClampedArray },
  options: { onProgress?: SelectiveMaskProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RemoteSelectiveMaskResult> {
  const timeoutMs = options.timeoutMs ?? REMOTE_SELECTIVE_MASK_TIMEOUT_MS;
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    options.onProgress?.(0, "Contacting photo server…");
    let response: Response;
    try {
      options.onProgress?.(0.1, "Segmenting subject…");
      response = await fetch("/api/selective-mask/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: image.width, height: image.height, imageB64: encodeB64(image.data) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && options.signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RemoteSelectiveMaskError(`Photo server timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new RemoteSelectiveMaskError("Photo server unreachable — start it with yarn dev.");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RemoteSelectiveMaskError(
        `Photo server rejected the segmentation (${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}).`,
      );
    }
    const payload = (await response.json()) as { mask?: unknown; coverage?: unknown; source?: unknown };
    if (!("mask" in payload)) {
      throw new RemoteSelectiveMaskError("Photo server returned no mask.");
    }
    const coverage = typeof payload.coverage === "number" && Number.isFinite(payload.coverage) ? payload.coverage : 0;
    options.onProgress?.(1, "Segmentation done");
    return {
      mask: parseWireMask(payload.mask),
      coverage,
      source: payload.source === "onnx" ? "onnx" : "classic",
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

interface SelectiveMaskSnapshot {
  serving?: unknown;
  downloading?: unknown;
  downloadPct?: unknown;
  error?: unknown;
}

/**
 * Warm the selective-mask endpoint: kick provisioning and poll health until
 * it serves, reporting real download %. Resolves quickly when the classical
 * fallback serves (no weights yet); reports download progress while the
 * ~4.6MB u2netp weights fetch.
 */
export async function warmupRemoteSelectiveMask(
  options: { onProgress?: SelectiveMaskProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ serving: boolean }> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const startedAt = Date.now();
  options.onProgress?.(0, "Checking photo server…");
  try {
    await fetch("/api/selective-mask/warmup", { method: "POST", signal: options.signal });
  } catch {
    // Unreachable server surfaces via the poll below.
  }
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let snapshot: SelectiveMaskSnapshot;
    try {
      const response = await fetch("/api/selective-mask/health", { signal: options.signal });
      if (!response.ok) throw new RemoteSelectiveMaskError(`Server replied ${response.status}.`);
      snapshot = (await response.json()) as SelectiveMaskSnapshot;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new RemoteSelectiveMaskError("Photo server unreachable — start it with yarn dev.");
    }
    if (typeof snapshot.error === "string" && snapshot.error) {
      throw new RemoteSelectiveMaskError(snapshot.error.slice(0, 220));
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
      throw new RemoteSelectiveMaskError("Photo server is still preparing models — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
