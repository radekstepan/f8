// Remote lightweight denoise: the learned DnCNN pass runs on the photo
// server, like every neural path.
//
// The hook POSTs pixels and gets denoised pixels back (raw RGBA base64):
// /api/denoise/preview takes a ≤512px downsample for the Inspector's
// before/after, /api/denoise/apply takes up to 2048px for the canvas base
// and export. Strength blends server-side, so preview and apply match
// exactly. The server always serves — DnCNN ONNX once weights land, the
// classical fallback until then — so this transport mirrors
// remoteSelectiveMask's warmup/health polling and stage copy.

import type { DenoiseSource } from "@f8/core";

export class RemoteDenoiseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteDenoiseError";
  }
}

export const REMOTE_DENOISE_TIMEOUT_MS = 180_000;

export interface RemoteDenoisedPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface RemoteDenoiseResult extends RemoteDenoisedPixels {
  /** Echoed strength 0..100 (blended server-side). */
  strength: number;
  source: DenoiseSource;
}

export type DenoiseProgress = (fraction: number, stage: string) => void;

export type DenoiseRoute = "preview" | "apply";

function encodeB64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function decodeB64(b64: string): Uint8ClampedArray {
  const binary = atob(b64);
  const out = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function runRemoteDenoise(
  image: { width: number; height: number; data: Uint8ClampedArray },
  strength: number,
  route: DenoiseRoute,
  options: { onProgress?: DenoiseProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RemoteDenoiseResult> {
  const timeoutMs = options.timeoutMs ?? REMOTE_DENOISE_TIMEOUT_MS;
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    options.onProgress?.(0, "Contacting photo server…");
    let response: Response;
    try {
      options.onProgress?.(0.1, route === "preview" ? "Denoising preview…" : "Denoising full photo…");
      response = await fetch(`/api/denoise/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: image.width, height: image.height, imageB64: encodeB64(image.data), strength }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && options.signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RemoteDenoiseError(`Photo server timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new RemoteDenoiseError("Photo server unreachable — start it with yarn dev.");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RemoteDenoiseError(
        `Photo server rejected the denoise (${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}).`,
      );
    }
    const payload = (await response.json()) as {
      imageB64?: unknown;
      width?: unknown;
      height?: unknown;
      strength?: unknown;
      source?: unknown;
    };
    if (
      typeof payload.imageB64 !== "string" ||
      !Number.isInteger(payload.width) ||
      !Number.isInteger(payload.height)
    ) {
      throw new RemoteDenoiseError("Photo server returned bad pixels.");
    }
    let data: Uint8ClampedArray;
    try {
      data = decodeB64(payload.imageB64);
    } catch {
      throw new RemoteDenoiseError("Photo server returned bad pixels.");
    }
    if (data.length !== (payload.width as number) * (payload.height as number) * 4) {
      throw new RemoteDenoiseError("Photo server returned bad pixels.");
    }
    options.onProgress?.(1, route === "preview" ? "Preview ready" : "Denoise done");
    return {
      width: payload.width as number,
      height: payload.height as number,
      data,
      strength: typeof payload.strength === "number" ? payload.strength : strength,
      source: payload.source === "onnx" ? "onnx" : "classic",
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

interface DenoiseSnapshot {
  serving?: unknown;
  downloading?: unknown;
  downloadPct?: unknown;
  error?: unknown;
}

/**
 * Warm the denoise endpoint: kick provisioning and poll health until it
 * serves, reporting real download %. Resolves quickly when the classical
 * fallback serves (no weights yet); reports download progress while the
 * ~2.6MB DnCNN weights fetch.
 */
export async function warmupRemoteDenoise(
  options: { onProgress?: DenoiseProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ serving: boolean }> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const startedAt = Date.now();
  options.onProgress?.(0, "Checking photo server…");
  try {
    await fetch("/api/denoise/warmup", { method: "POST", signal: options.signal });
  } catch {
    // Unreachable server surfaces via the poll below.
  }
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let snapshot: DenoiseSnapshot;
    try {
      const response = await fetch("/api/denoise/health", { signal: options.signal });
      if (!response.ok) throw new RemoteDenoiseError(`Server replied ${response.status}.`);
      snapshot = (await response.json()) as DenoiseSnapshot;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new RemoteDenoiseError("Photo server unreachable — start it with yarn dev.");
    }
    if (typeof snapshot.error === "string" && snapshot.error) {
      throw new RemoteDenoiseError(snapshot.error.slice(0, 220));
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
      throw new RemoteDenoiseError("Photo server is still preparing models — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
