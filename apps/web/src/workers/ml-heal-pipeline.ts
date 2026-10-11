// ML-heal worker pipeline: local ONNX inpainting (LaMa now, Moebius next).
//
// Runs inside the vision worker only. Everything ORT-flavoured is lazily
// imported here so the main bundle and the worker shell stay small: the ORT
// chunk plus model weights only load when an ml-heal job actually runs.
//
// Design notes:
// - WebGPU-first with WASM fallback: `["webgpu", "wasm"]` lets ORT pick the
//   best available backend per device; Safari without WebGPU lands on WASM.
// - Weights are cached in Cache Storage (ML_HEAL_CACHE_NAME) after the first
//   fetch, so repeat visits work offline. The full URL is the cache key.
// - Any failure (no WebGPU+WASM, fetch blocked, session create throws)
//   surfaces as MlHealUnavailableError so the caller falls back to the frozen
//   exemplar engine — export/preview must never fail because of ML.
// - Quality currently selects nothing structural (LaMa is single-pass); it is
//   reserved for diffusion steps / ROI tiling when the Moebius UNet lands.

import {
  ML_HEAL_CACHE_NAME,
  ML_HEAL_LAMA_DEFAULT_URL,
  ML_HEAL_MODEL_SIZE,
  compositeMlHealOutput,
  packMlHealInput,
  planMlHealRoi,
  type HealProgress,
  type HealQuality,
  type PixelImage,
  type RepairMask,
} from "@photomator/core";

export class MlHealUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MlHealUnavailableError";
  }
}

export interface MlHealRunOptions {
  quality?: HealQuality;
  /** Explicit weights URL; defaults to VITE_ML_HEAL_MODEL_URL or the LaMa default. */
  modelUrl?: string;
  onProgress?: HealProgress;
}

type OrtModule = typeof import("onnxruntime-web");
type OrtSession = import("onnxruntime-web").InferenceSession;

let ortPromise: Promise<OrtModule> | null = null;
let lamaSession: OrtSession | null = null;
let lamaSessionUrl: string | null = null;

function loadOrt(): Promise<OrtModule> {
  if (!ortPromise) ortPromise = import("onnxruntime-web");
  return ortPromise;
}

function resolveModelUrl(explicit?: string): string {
  if (explicit) return explicit;
  try {
    const fromEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_ML_HEAL_MODEL_URL;
    if (fromEnv) return fromEnv;
  } catch {
    // import.meta.env is Vite-only; Node/test contexts land here.
  }
  return ML_HEAL_LAMA_DEFAULT_URL;
}

async function readWithProgress(
  response: Response,
  onProgress?: HealProgress,
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get("content-length") ?? 0);
  const body = response.body;
  if (!body || !Number.isFinite(total) || total <= 0) {
    onProgress?.(0.05, "Downloading model");
    return response.arrayBuffer();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.min(0.99, received / total) * 0.8, "Downloading model");
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.buffer;
}

async function fetchWeights(url: string, onProgress?: HealProgress): Promise<ArrayBuffer> {
  // Cache-first: offline repeat visits never re-download.
  try {
    const cache = await caches.open(ML_HEAL_CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
    const response = await fetch(url);
    if (!response.ok) {
      throw new MlHealUnavailableError(`Model download failed: HTTP ${response.status}.`);
    }
    const buffer = await readWithProgress(response, onProgress);
    // Best-effort re-cache; a full fetch that fails to cache still runs.
    try {
      await cache.put(
        url,
        new Response(buffer.slice(0), { headers: { "content-type": "application/octet-stream" } }),
      );
    } catch {
      // Quota or opaque-response limits: ignore, inference proceeds.
    }
    return buffer;
  } catch (error) {
    if (error instanceof MlHealUnavailableError) throw error;
    // Cache Storage unavailable (some private modes): plain fetch fallback.
    const response = await fetch(url);
    if (!response.ok) {
      throw new MlHealUnavailableError(`Model download failed: HTTP ${response.status}.`);
    }
    return response.arrayBuffer();
  }
}

async function getLamaSession(url: string, onProgress?: HealProgress): Promise<OrtSession> {
  if (lamaSession && lamaSessionUrl === url) return lamaSession;
  let ort: OrtModule;
  try {
    onProgress?.(0, "Loading runtime");
    ort = await loadOrt();
  } catch {
    throw new MlHealUnavailableError("ONNX runtime failed to load.");
  }
  const weights = await fetchWeights(url, onProgress);
  try {
    onProgress?.(0.85, "Loading model");
    lamaSession = await ort.InferenceSession.create(weights, {
      executionProviders: ["webgpu", "wasm"],
    });
    lamaSessionUrl = url;
    return lamaSession;
  } catch {
    lamaSession = null;
    lamaSessionUrl = null;
    throw new MlHealUnavailableError("ONNX session failed to start (WebGPU/WASM unavailable?).");
  }
}

/**
 * Run local ML inpainting over the repair mask. Returns a full reconstruction
 * (caller blends with a feathered mask). Empty mask returns a source copy.
 * Throws MlHealUnavailableError when the model runtime cannot serve the job —
 * callers must fall back to exemplar heal, never surface this to export.
 */
export async function runMlHeal(
  image: PixelImage,
  mask: RepairMask,
  options: MlHealRunOptions = {},
): Promise<PixelImage> {
  const roi = planMlHealRoi(mask);
  if (!roi) return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  const url = resolveModelUrl(options.modelUrl);
  const onProgress = options.onProgress;
  const session = await getLamaSession(url, onProgress);
  const { image: imageTensorData, mask: maskTensorData } = packMlHealInput(image, mask, roi);
  let ort: OrtModule;
  try {
    ort = await loadOrt();
  } catch {
    throw new MlHealUnavailableError("ONNX runtime failed to load.");
  }
  onProgress?.(0.9, "Inpainting");
  let output: Float32Array;
  try {
    const feeds = {
      image: new ort.Tensor("float32", imageTensorData, [1, 3, ML_HEAL_MODEL_SIZE, ML_HEAL_MODEL_SIZE]),
      mask: new ort.Tensor("float32", maskTensorData, [1, 1, ML_HEAL_MODEL_SIZE, ML_HEAL_MODEL_SIZE]),
    };
    const results = await session.run(feeds);
    const tensor = results.output ?? results[Object.keys(results)[0] as string];
    if (!tensor) throw new Error("empty output");
    output = tensor.data as Float32Array;
  } catch {
    throw new MlHealUnavailableError("ML inpainting inference failed.");
  }
  onProgress?.(1, "Done");
  return compositeMlHealOutput(image, mask, roi, output);
}

/** Drop cached sessions (tests, memory pressure). Weights stay in Cache Storage. */
export function resetMlHealPipeline(): void {
  lamaSession = null;
  lamaSessionUrl = null;
}
