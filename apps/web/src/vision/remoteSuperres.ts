// Remote export-time super-resolution: the Real-ESRGAN 2x pass runs on the
// photo server, like every neural path.
//
// The export dialog POSTs the rendered canvas and gets doubled pixels back
// (raw RGBA base64). Large frames run tiled server-side, so this transport
// polls GET /api/superres/progress while the POST is in flight and maps
// tile counts to real 0..1 progress — multi-minute 2048px exports stay
// visibly alive, and the dialog's Cancel aborts the client side (the server
// finishes its tiles harmlessly; single-user local server). 2x is ML-only:
// the server 503s with the real cause when weights are missing instead of
// serving a silent fallback, so this transport mirrors remoteDenoise's
// warmup/health polling and surfaces those errors verbatim.

import { superresTileProgress } from "@f8/core";
import type { SuperresHealthSnapshot, SuperresRunResult } from "@f8/core";

export class RemoteSuperresError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteSuperresError";
  }
}

/** Tiled 2048px ML exports take minutes on CPU; the POST outlives them all. */
export const REMOTE_SUPERRES_TIMEOUT_MS = 600_000;

export type SuperresProgress = (fraction: number, stage: string) => void;

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

interface JobSnapshot {
  active?: unknown;
  stage?: unknown;
  tile?: unknown;
  totalTiles?: unknown;
}

/**
 * Poll live tile progress while `running` stays true, mapping tile counts
 * into the 0.15..0.95 band. Single tiles report no server progress, so the
 * bar holds at "Upscaling…" instead of stalling.
 */
async function pollJobProgress(
  running: () => boolean,
  onProgress: SuperresProgress | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!onProgress) return;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (!running() || signal?.aborted) return;
    let snapshot: JobSnapshot | null = null;
    try {
      const response = await fetch("/api/superres/progress", { signal });
      if (response.ok) snapshot = (await response.json()) as JobSnapshot;
    } catch {
      // Progress is best-effort; the POST result is the source of truth.
    }
    if (!running() || signal?.aborted) return;
    const tile = typeof snapshot?.tile === "number" ? snapshot.tile : 0;
    const total = typeof snapshot?.totalTiles === "number" ? snapshot.totalTiles : 0;
    if (snapshot?.active === true) {
      const mapped = superresTileProgress(tile, total);
      onProgress(mapped.fraction, mapped.stage);
    }
  }
}

export async function runRemoteSuperres(
  image: { width: number; height: number; data: Uint8ClampedArray },
  options: { onProgress?: SuperresProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SuperresRunResult> {
  const timeoutMs = options.timeoutMs ?? REMOTE_SUPERRES_TIMEOUT_MS;
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let running = true;
  const poller = pollJobProgress(() => running, options.onProgress, controller.signal);
  try {
    options.onProgress?.(0, "Contacting photo server…");
    let response: Response;
    try {
      options.onProgress?.(0.1, "Sending photo…");
      response = await fetch("/api/superres/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: image.width, height: image.height, imageB64: encodeB64(image.data) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && options.signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RemoteSuperresError(`Photo server timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new RemoteSuperresError("Photo server unreachable — start it with yarn dev.");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RemoteSuperresError(
        `Photo server rejected the upscale (${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}).`,
      );
    }
    const payload = (await response.json()) as {
      imageB64?: unknown;
      width?: unknown;
      height?: unknown;
      source?: unknown;
    };
    if (
      typeof payload.imageB64 !== "string" ||
      !Number.isInteger(payload.width) ||
      !Number.isInteger(payload.height)
    ) {
      throw new RemoteSuperresError("Photo server returned bad pixels.");
    }
    let data: Uint8ClampedArray;
    try {
      data = decodeB64(payload.imageB64);
    } catch {
      throw new RemoteSuperresError("Photo server returned bad pixels.");
    }
    if (data.length !== (payload.width as number) * (payload.height as number) * 4) {
      throw new RemoteSuperresError("Photo server returned bad pixels.");
    }
    if (payload.source !== "onnx") {
      throw new RemoteSuperresError("Photo server returned an unexpected upscale engine.");
    }
    options.onProgress?.(1, "Upscale done");
    return {
      width: payload.width as number,
      height: payload.height as number,
      data,
      source: "onnx",
    };
  } finally {
    running = false;
    await poller.catch(() => undefined);
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

interface HealthSnapshot {
  ready?: unknown;
  source?: unknown;
  downloading?: unknown;
  downloadPct?: unknown;
  error?: unknown;
  serving?: unknown;
}

/** One health read for the dialog's engine note (ready vs downloading vs error). */
export async function fetchSuperresHealth(signal?: AbortSignal): Promise<SuperresHealthSnapshot> {
  let snapshot: HealthSnapshot;
  try {
    const response = await fetch("/api/superres/health", { signal });
    if (!response.ok) throw new RemoteSuperresError(`Server replied ${response.status}.`);
    snapshot = (await response.json()) as HealthSnapshot;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new RemoteSuperresError("Photo server unreachable — start it with yarn dev.");
  }
  if (typeof snapshot.error === "string" && snapshot.error) {
    throw new RemoteSuperresError(snapshot.error.slice(0, 220));
  }
  if (snapshot.source !== "onnx") {
    throw new RemoteSuperresError("Photo server returned an unexpected upscale engine.");
  }
  return {
    ready: snapshot.ready === true || snapshot.serving === true,
    source: "onnx",
    downloading: snapshot.downloading === true,
    downloadPct:
      typeof snapshot.downloadPct === "number" && Number.isFinite(snapshot.downloadPct)
        ? Math.max(0, Math.min(1, snapshot.downloadPct))
        : 1,
    error: null,
  };
}

/**
 * Warm the super-resolution endpoint: kick provisioning and poll health
 * until the ML session serves, reporting real download %. 2x is ML-only,
 * so this waits out the ~64MB Real-ESRGAN fetch instead of resolving
 * early; a failed provisioning surfaces its cause as the rejection.
 */
export async function warmupRemoteSuperres(
  options: { onProgress?: SuperresProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ serving: boolean }> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const startedAt = Date.now();
  options.onProgress?.(0, "Checking photo server…");
  try {
    await fetch("/api/superres/warmup", { method: "POST", signal: options.signal });
  } catch {
    // Unreachable server surfaces via the poll below.
  }
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let snapshot: HealthSnapshot;
    try {
      const response = await fetch("/api/superres/health", { signal: options.signal });
      if (!response.ok) throw new RemoteSuperresError(`Server replied ${response.status}.`);
      snapshot = (await response.json()) as HealthSnapshot;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new RemoteSuperresError("Photo server unreachable — start it with yarn dev.");
    }
    if (typeof snapshot.error === "string" && snapshot.error) {
      throw new RemoteSuperresError(snapshot.error.slice(0, 220));
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
      throw new RemoteSuperresError("Photo server is still preparing models — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
