// Remote ML heal: every neural engine runs on the photo server, never in
// the browser.
//
// The in-browser paths hung multi-area jobs (WebGPU VAE-encode buffer
// failures, poisoned sessions, heartbeats re-arming the sliding timeout
// forever). All ML tiers are server-required: this transport POSTs a square
// ROI crop to /api/ml-heal/inpaint and composites the 512 model output with
// the shared compositeMlHealOutput, so pixels match the old browser path.

import {
  ML_HEAL_DIFFUSION_TIMEOUT_MS,
  compositeMlHealOutput,
  planMlHealRoi,
  type HealProgress,
  type MlHealEngine,
  type PixelImage,
  type RepairMask,
} from "@photomator/core";

export class RemoteHealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteHealError";
  }
}

/** Long ceiling for diffusion heals; LaMa's single pass uses its own. */
export const REMOTE_LAMA_TIMEOUT_MS = 90_000;

function encodeB64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function decodeB64(b64: string, expected: number): Uint8Array {
  const binary = atob(b64);
  if (binary.length !== expected) {
    throw new RemoteHealError(`Server returned ${binary.length} bytes, expected ${expected}.`);
  }
  const out = new Uint8Array(expected);
  for (let i = 0; i < expected; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export interface RemoteHealOptions {
  onProgress?: HealProgress;
  steps?: number;
  timeoutMs?: number;
}

/**
 * Run one ML heal against the photo server. Same signature as RunInpaint
 * so healSingleGroup/export keep working unchanged. Throws RemoteHealError
 * when the server is missing or the job fails — callers fall back to blur,
 * never hang. The server is always up; there is no browser fallback.
 */
export async function runRemoteHeal(
  engine: MlHealEngine,
  image: PixelImage,
  mask: RepairMask,
  options: RemoteHealOptions = {},
): Promise<PixelImage> {
  const roi = planMlHealRoi(mask);
  if (!roi) return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  const { x0, y0, size } = roi;
  const remoteEngine = engine === "lama" ? "lama" : "moebius";
  options.onProgress?.(0, "Contacting photo server…");

  // Crop the square ROI at native resolution: small payload (vs full-res),
  // server packs it to the 512 model grid.
  const roiImage = new Uint8ClampedArray(size * size * 4);
  const roiMask = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y += 1) {
    const srcRow = ((y0 + y) * image.width + x0) * 4;
    roiImage.set(image.data.subarray(srcRow, srcRow + size * 4), y * size * 4);
    roiMask.set(mask.data.subarray((y0 + y) * image.width + x0, (y0 + y) * image.width + x0 + size), y * size);
  }

  const timeoutMs = options.timeoutMs ?? (remoteEngine === "lama" ? REMOTE_LAMA_TIMEOUT_MS : ML_HEAL_DIFFUSION_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    options.onProgress?.(0.1, "Healing on server…");
    response = await fetch("/api/ml-heal/inpaint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engine: remoteEngine,
        roi: { x0, y0, size },
        srcWidth: image.width,
        srcHeight: image.height,
        imageB64: encodeB64(roiImage),
        maskB64: encodeB64(roiMask),
        ...(options.steps === undefined ? {} : { steps: options.steps }),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RemoteHealError(`Photo server timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new RemoteHealError("Photo server unreachable — start it with yarn dev.");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    if (response.status === 503 || response.status === 500) {
      throw new RemoteHealError("Photo server heal failed.");
    }
    const detail = await response.text().catch(() => "");
    throw new RemoteHealError(`Photo server rejected the heal (${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}).`);
  }
  const payload = (await response.json()) as { outputB64?: unknown };
  if (typeof payload.outputB64 !== "string") throw new RemoteHealError("Photo server returned no output.");
  options.onProgress?.(0.9, "Compositing…");
  const rgb = decodeB64(payload.outputB64, 3 * 512 * 512);
  const output = new Float32Array(3 * 512 * 512);
  for (let i = 0; i < output.length; i += 1) output[i] = rgb[i] ?? 0;
  const result = compositeMlHealOutput(image, mask, roi, output);
  options.onProgress?.(1, "Healing done");
  return result;
}

export interface RemoteWarmupResult {
  ready: boolean;
  serving: boolean;
  detail: string;
}

interface EngineSnapshot {
  serving?: unknown;
  downloading?: unknown;
  downloadPct?: unknown;
  error?: unknown;
}

async function readEngineSnapshot(remoteEngine: "lama" | "moebius"): Promise<EngineSnapshot> {
  const response = await fetch("/api/ml-heal/health");
  if (!response.ok) throw new RemoteHealError(`Server replied ${response.status}.`);
  const health = (await response.json()) as { engines?: Record<string, EngineSnapshot> };
  const snapshot = health.engines?.[remoteEngine];
  if (!snapshot) throw new RemoteHealError("Photo server answered without engine status.");
  return snapshot;
}

/**
 * Warm one engine: kick provisioning (models download once, sessions warm)
 * and poll health until it serves, reporting real download %. Resolves only
 * when the engine serves; throws otherwise. Progress stays terse — detail
 * strings live in the console, not the UI.
 */
export async function warmupRemoteHeal(
  engine: MlHealEngine,
  options: { onProgress?: HealProgress; timeoutMs?: number } = {},
): Promise<RemoteWarmupResult> {
  const remoteEngine = engine === "lama" ? "lama" : "moebius";
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const startedAt = Date.now();
  options.onProgress?.(0, "Checking photo server…");
  try {
    await fetch("/api/ml-heal/warmup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: remoteEngine }),
    });
  } catch {
    // Unreachable server surfaces via the poll below.
  }
  for (;;) {
    let snapshot: EngineSnapshot;
    try {
      snapshot = await readEngineSnapshot(remoteEngine);
    } catch {
      throw new RemoteHealError("Photo server unreachable — start it with yarn dev.");
    }
    if (typeof snapshot.error === "string" && snapshot.error) {
      throw new RemoteHealError(snapshot.error.slice(0, 220));
    }
    if (snapshot.serving === true) {
      options.onProgress?.(1, "Server ready.");
      return { ready: true, serving: true, detail: "Server ready." };
    }
    if (snapshot.downloading === true) {
      const pct = typeof snapshot.downloadPct === "number" && Number.isFinite(snapshot.downloadPct)
        ? Math.max(0, Math.min(0.99, snapshot.downloadPct))
        : 0;
      options.onProgress?.(pct, `Downloading models… ${Math.round(pct * 100)}%`);
    } else {
      options.onProgress?.(0, "Preparing models…");
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new RemoteHealError("Photo server is still preparing models — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
