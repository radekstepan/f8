// Remote face detection: ML face-aware exposure's detect step runs on the
// photo server, like every neural path.
//
// The hook POSTs a ≤640px downsample to /api/face-detect/detect and gets
// normalized face boxes with eye landmarks back; it anchors white balance
// on the skin tones inside the boxes, lifts underexposed faces through a
// masked exposure recipe, and suppresses red-eye pupils around the
// landmarks. The server always serves — YuNet ONNX once weights land, the
// classical skin-tone proposer until then — so this transport mirrors
// remoteObjectDetect's warmup/health polling and stage copy.

import type { DetectedFace, FaceDetectSource } from "@f8/core";

export class RemoteFaceDetectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteFaceDetectError";
  }
}

export const REMOTE_FACE_DETECT_TIMEOUT_MS = 90_000;

export interface RemoteFaceDetectResult {
  faces: DetectedFace[];
  source: FaceDetectSource;
}

export type FaceDetectProgress = (fraction: number, stage: string) => void;

function encodeB64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function runRemoteFaceDetect(
  image: { width: number; height: number; data: Uint8ClampedArray },
  options: { onProgress?: FaceDetectProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RemoteFaceDetectResult> {
  const timeoutMs = options.timeoutMs ?? REMOTE_FACE_DETECT_TIMEOUT_MS;
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    options.onProgress?.(0, "Contacting photo server…");
    let response: Response;
    try {
      options.onProgress?.(0.1, "Detecting faces…");
      response = await fetch("/api/face-detect/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: image.width, height: image.height, imageB64: encodeB64(image.data) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && options.signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RemoteFaceDetectError(`Photo server timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new RemoteFaceDetectError("Photo server unreachable — start it with yarn dev.");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RemoteFaceDetectError(
        `Photo server rejected the detection (${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}).`,
      );
    }
    const payload = (await response.json()) as { faces?: unknown; source?: unknown };
    if (!Array.isArray(payload.faces)) {
      throw new RemoteFaceDetectError("Photo server returned no faces.");
    }
    options.onProgress?.(1, "Detection done");
    return {
      faces: payload.faces as DetectedFace[],
      source: payload.source === "onnx" ? "onnx" : "classic",
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

interface FaceDetectSnapshot {
  serving?: unknown;
  downloading?: unknown;
  downloadPct?: unknown;
  error?: unknown;
}

/**
 * Warm the face-detect endpoint: kick provisioning and poll health until it
 * serves, reporting real download %. Resolves quickly when the classical
 * fallback serves (no weights yet); reports download progress while the
 * ~227KB YuNet weights fetch.
 */
export async function warmupRemoteFaceDetect(
  options: { onProgress?: FaceDetectProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ serving: boolean }> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const startedAt = Date.now();
  options.onProgress?.(0, "Checking photo server…");
  try {
    await fetch("/api/face-detect/warmup", { method: "POST", signal: options.signal });
  } catch {
    // Unreachable server surfaces via the poll below.
  }
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let snapshot: FaceDetectSnapshot;
    try {
      const response = await fetch("/api/face-detect/health", { signal: options.signal });
      if (!response.ok) throw new RemoteFaceDetectError(`Server replied ${response.status}.`);
      snapshot = (await response.json()) as FaceDetectSnapshot;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new RemoteFaceDetectError("Photo server unreachable — start it with yarn dev.");
    }
    if (typeof snapshot.error === "string" && snapshot.error) {
      throw new RemoteFaceDetectError(snapshot.error.slice(0, 220));
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
      throw new RemoteFaceDetectError("Photo server is still preparing models — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
