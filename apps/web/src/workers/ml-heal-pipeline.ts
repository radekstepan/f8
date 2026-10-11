// ML-heal worker pipeline: local ONNX inpainting with engine tiers.
//
// Runs inside the vision worker only. Everything ORT-flavoured is lazily
// imported here so the main bundle and the worker shell stay small: the ORT
// chunk plus model weights only load when an ml-heal job actually runs.
//
// Engine tiers (selected by Heal Quality, see mlHealEngineForQuality):
// - classic: no model; the caller runs exemplar heal instead. The pipeline
//   throws MlHealUnavailableError so routing stays in one place.
// - lama: single-pass LaMa fill (208MB). Fast, great texture.
// - moebius: Moebius diffusion (UNet + VAE enc/dec, ~1.3GB, preview DDIM
//   steps with sequential classifier-free guidance). Best removals; falls
//   back to LaMa when diffusion cannot serve the job.
//
// Design notes:
// - WebGPU-first with WASM fallback: `["webgpu", "wasm"]` lets ORT pick the
//   best available backend per device; Safari without WebGPU lands on WASM
//   (Moebius fp32 on WASM will likely OOM and fall back — by design).
// - Weights are cached in Cache Storage (ML_HEAL_CACHE_NAME) after the first
//   fetch, so repeat visits work offline. The full URL is the cache key.
// - Any terminal failure surfaces as MlHealUnavailableError so the caller
//   falls back down the tier chain — export/preview must never fail because
//   of ML.
// - Progress is reported at maximum granularity: per-file byte progress while
//   downloading, per-session while loading, per-step while diffusing.

import {
  ML_HEAL_CACHE_NAME,
  ML_HEAL_ENGINE_EPS,
  ML_HEAL_LAMA_DEFAULT_URL,
  ML_HEAL_MOEBIUS_DEFAULT_BASE,
  ML_HEAL_MOEBIUS_FILES,
  ML_HEAL_MOEBIUS_FILE_SIZES,
  ML_HEAL_MODEL_SIZE,
  MOEBIUS_GUIDANCE,
  MOEBIUS_LATENT_SIZE,
  MOEBIUS_PREVIEW_INFERENCE_STEPS,
  MOEBIUS_SEED,
  MOEBIUS_STRENGTH,
  MOEBIUS_VAE_SCALE,
  compositeMlHealOutput,
  downsampleMaskToLatent,
  makeSeededGaussian,
  maskMlHealInputForEncode,
  mlHealEngineForQuality,
  mlHealWasmThreads,
  moebiusAlphasCumprod,
  moebiusBetas,
  moebiusTimesteps,
  packMlHealInput,
  planMlHealRoi,
  seedMoebiusLatents,
  type HealProgress,
  type HealQuality,
  type MlCapabilities,
  type MlHealEngine,
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
  /** Explicit LaMa weights URL; defaults to VITE_ML_HEAL_MODEL_URL or the LaMa default. */
  modelUrl?: string;
  /** Explicit Moebius base URL; defaults to VITE_ML_HEAL_MOEBIUS_BASE or the default base. */
  moebiusBase?: string;
  onProgress?: HealProgress;
}

type OrtModule = typeof import("onnxruntime-web/wasm") | typeof import("onnxruntime-web/webgpu");
type OrtSession = import("onnxruntime-web").InferenceSession;

let ortWasmPromise: Promise<typeof import("onnxruntime-web/wasm")> | null = null;
let ortWebgpuPromise: Promise<typeof import("onnxruntime-web/webgpu")> | null = null;
const sessions = new Map<string, OrtSession>();

/**
 * Per-engine ORT entry points: the package's subpath builds carry only one
 * backend's JS (extern-wasm), unlike the 75MB all-EPs default bundle. LaMa
 * (Fourier ops, no WebGPU kernels) loads the wasm build; Moebius loads the
 * WebGPU build.
 */
function loadOrtWasm(): Promise<typeof import("onnxruntime-web/wasm")> {
  if (!ortWasmPromise) ortWasmPromise = import("onnxruntime-web/wasm");
  return ortWasmPromise;
}

function loadOrtWebgpu(): Promise<typeof import("onnxruntime-web/webgpu")> {
  if (!ortWebgpuPromise) ortWebgpuPromise = import("onnxruntime-web/webgpu");
  return ortWebgpuPromise;
}

function env(key: string): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
  } catch {
    return undefined;
  }
}

function resolveLamaUrl(explicit?: string): string {
  return explicit ?? env("VITE_ML_HEAL_MODEL_URL") ?? ML_HEAL_LAMA_DEFAULT_URL;
}

function resolveMoebiusBase(explicit?: string): string {
  const base = explicit ?? env("VITE_ML_HEAL_MOEBIUS_BASE") ?? ML_HEAL_MOEBIUS_DEFAULT_BASE;
  return base.endsWith("/") ? base : `${base}/`;
}

async function readWithProgress(
  response: Response,
  total: number,
  base: number,
  span: number,
  stage: string,
  onProgress?: HealProgress,
): Promise<ArrayBuffer> {
  const body = response.body;
  if (!body || !Number.isFinite(total) || total <= 0) {
    onProgress?.(base, `${stage} (size unknown)`);
    return response.arrayBuffer();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const mb = (bytes: number) => `${Math.round(bytes / 1048576)}MB`;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      const pct = Math.round((received / total) * 100);
      onProgress?.(base + (Math.min(1, received / total) * span), `${stage} ${pct}% · ${mb(received)} of ${mb(total)}`);
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

async function fetchWeights(
  url: string,
  knownSize: number,
  base: number,
  span: number,
  stage: string,
  onProgress?: HealProgress,
): Promise<{ buffer: ArrayBuffer; cached: boolean }> {
  // Cache-first: offline repeat visits never re-download.
  try {
    const cache = await caches.open(ML_HEAL_CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) {
      // Weights are on the device: report the span as complete with a
      // "found" stage (never "Downloading … (cached)") so the UI can show
      // "found on this device" instead of download progress.
      onProgress?.(base + span, `${stage.replace(/^Downloading\s+/, "")} found on this device`);
      return { buffer: await hit.arrayBuffer(), cached: true };
    }
    const response = await fetch(url);
    if (!response.ok) throw new MlHealUnavailableError(`Model download failed: HTTP ${response.status}.`);
    const size = Number(response.headers.get("content-length") ?? knownSize);
    const buffer = await readWithProgress(response, size, base, span, stage, onProgress);
    try {
      await cache.put(url, new Response(buffer.slice(0), { headers: { "content-type": "application/octet-stream" } }));
    } catch {
      // Quota limits: ignore, inference proceeds.
    }
    return { buffer, cached: false };
  } catch (error) {
    if (error instanceof MlHealUnavailableError) throw error;
    const response = await fetch(url);
    if (!response.ok) throw new MlHealUnavailableError(`Model download failed: HTTP ${response.status}.`);
    return { buffer: await response.arrayBuffer(), cached: false };
  }
}

async function getSession(
  ort: OrtModule,
  url: string,
  weights: ArrayBuffer,
  engine: MlHealEngine,
  fraction: number,
  stage: string,
  onProgress?: HealProgress,
): Promise<OrtSession> {
  const eps = [...ML_HEAL_ENGINE_EPS[engine]];
  const hit = sessions.get(url);
  if (hit) {
    // Session already warm: report the load checkpoint as-is (no "(ready)"
    // suffix — "ready" at a partial fraction reads as done). The next phase
    // (healing) follows immediately, so this never stalls on screen.
    onProgress?.(fraction, stage);
    return hit;
  }
  onProgress?.(fraction, stage);
  try {
    const session = await ort.InferenceSession.create(weights, {
      executionProviders: eps,
      graphOptimizationLevel: "all",
    });
    sessions.set(url, session);
    return session;
  } catch (error) {
    const detail = errorMessage(error);
    let paths = "";
    try {
      const configured = (ort as { env?: { wasm?: { wasmPaths?: unknown } } }).env?.wasm?.wasmPaths;
      if (typeof configured === "string" && configured) paths = ` · wasmPaths ${configured}`;
    } catch {
      // Diagnostic only.
    }
    console.error(`[ml-heal] ${stage} failed on ${eps.join("/") || "no runtime"}: ${detail}`, error);
    throw new MlHealUnavailableError(`${stage} failed (${eps.join("/") || "no runtime"}${paths}): ${detail}`);
  }
}

/** Readable cause on one line; keeps ORT backend detail (up to ~800 chars). */
function errorMessage(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message : String(error);
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > 800 ? `${flat.slice(0, 800)}…` : flat;
}

/** Opt-in diffusion diagnostics via `?mldebug=1` (off by default). */
function mlDebugEnabled(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get("mldebug") === "1";
  } catch {
    return false;
  }
}

/** One-line min/max/mean for a tensor dump; debug only, never throws. */
function debugStats(label: string, data: Float32Array | Float64Array): void {
  try {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = data[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    console.debug(`[ml-heal debug] ${label}: n=${data.length} min=${min.toFixed(4)} max=${max.toFixed(4)} mean=${(sum / Math.max(1, data.length)).toFixed(4)}`);
  } catch {
    // Diagnostics must never break a heal.
  }
}

/** Device capabilities that decide which engines can run. Worker-safe. */
function probeCapabilities(): MlCapabilities {
  const nav = globalThis.navigator as (Navigator & { gpu?: unknown }) | undefined;
  let hardwareConcurrency = 4;
  let webgpu = false;
  try {
    if (typeof nav?.hardwareConcurrency === "number") hardwareConcurrency = nav.hardwareConcurrency;
    webgpu = !!nav?.gpu;
  } catch {
    // Navigator inaccessible (locked-down context): conservative defaults.
  }
  let crossOriginIsolated = false;
  try {
    crossOriginIsolated = globalThis.crossOriginIsolated === true;
  } catch {
    crossOriginIsolated = false;
  }
  return { webgpu, crossOriginIsolated, hardwareConcurrency };
}

/**
 * Tune the ORT runtime for this page and report the capability line first —
 * before any gigabyte downloads — so an unrunnable tier says so upfront.
 * Also verifies the .wasm/.mjs backends are actually servable (a dev server SPA
 * fallback returns HTML here, which fails later with an unreadable
 * WebAssembly magic-word error), and fail-fasts Moebius when WebGPU has no
 * adapter (no point downloading 1.3GB first).
 */
async function configureOrt(
  ort: OrtModule,
  engine: MlHealEngine,
  onProgress?: HealProgress,
): Promise<MlCapabilities> {
  const caps = probeCapabilities();
  const prefix = ortWasmPrefix();
  try {
    ort.env.wasm.wasmPaths = prefix;
    ort.env.wasm.numThreads = mlHealWasmThreads(caps.crossOriginIsolated, caps.hardwareConcurrency);
  } catch (error) {
    console.error("[ml-heal] wasm config failed:", error);
  }
  if (engine === "moebius") await ensureWebGpuAvailable();
  await verifyWasmServing(prefix, engine);
  // Friendly first stage: capabilities decide the tier, but the raw
  // "WebGPU: … · Threads: …" line means nothing to most users. Keep it in
  // the console-adjacent detail by folding it into a plain label.
  onProgress?.(0, "Checking device…");
  return caps;
}

/** Where the vite-static-copy'd ORT backends are served (dev and dist alike). */
function ortWasmPrefix(): string {
  let base = "/";
  try {
    base = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.BASE_URL ?? "/";
  } catch {
    base = "/";
  }
  return base.endsWith("/") ? `${base}ort/` : `${base}/ort/`;
}

/**
 * Fail fast when WebGPU cannot serve Moebius: no navigator.gpu, or
 * requestAdapter() resolves null / rejects / times out. Runs before any
 * weight download so Best says so upfront instead of after 1.3GB.
 */
async function ensureWebGpuAvailable(timeoutMs = 5000): Promise<void> {
  const nav = globalThis.navigator as (Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }) | undefined;
  const gpu = nav?.gpu;
  if (!gpu) {
    throw new MlHealUnavailableError(
      "WebGPU unavailable in this browser (no navigator.gpu). Use Balanced instead, or enable WebGPU (Chrome/Edge 113+, Safari macOS 14+, secure context).",
    );
  }
  if (typeof gpu.requestAdapter !== "function") {
    throw new MlHealUnavailableError("WebGPU unavailable (requestAdapter missing). Use Balanced instead.");
  }
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!adapter) {
      throw new MlHealUnavailableError(
        "WebGPU has no adapter on this device (requestAdapter returned null — check chrome://gpu, GPU drivers, or remote-desktop flags). Use Balanced instead.",
      );
    }
  } catch (error) {
    if (error instanceof MlHealUnavailableError) throw error;
    throw new MlHealUnavailableError(`WebGPU adapter check failed: ${errorMessage(error)} Use Balanced instead.`);
  }
}

/**
 * Fetch the first bytes of the engine's backend files and check them.
 * The .wasm must start with the WebAssembly magic header (00 61 73 6d);
 * the WebGPU asyncify .mjs must be servable JS (not an SPA HTML fallback).
 * Catches static-asset misconfiguration with a readable error instead of
 * ORT's "no available backend found" + failed dynamic import.
 */
async function verifyWasmServing(prefix: string, engine: MlHealEngine): Promise<void> {
  await verifyWasmMagic(prefix, engine === "moebius" ? "ort-wasm-simd-threaded.jsep.wasm" : "ort-wasm-simd-threaded.wasm");
  if (engine === "moebius") await verifyJsServing(prefix, "ort-wasm-simd-threaded.asyncify.mjs");
}

async function verifyWasmMagic(prefix: string, file: string): Promise<void> {
  const fail = (detail: string): MlHealUnavailableError =>
    new MlHealUnavailableError(`ONNX runtime files missing at ${prefix}${file} (${detail}).`);
  let response: Response;
  try {
    response = await fetch(`${prefix}${file}`, { headers: { Range: "bytes=0-3" } });
  } catch (error) {
    throw fail(`fetch failed: ${errorMessage(error)}`);
  }
  try {
    if (!response.ok && response.status !== 206) throw fail(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw fail("empty response");
    try {
      const { value } = await reader.read();
      const magic = Array.from((value ?? new Uint8Array(0)).subarray(0, 4));
      if (magic.length < 4 || magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
        throw fail("got HTML, not a WebAssembly binary (check static asset serving)");
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Best effort: the ranged body is tiny either way.
      }
    }
  } catch (error) {
    if (error instanceof MlHealUnavailableError) throw error;
    throw fail(errorMessage(error));
  }
}

/** The WebGPU .mjs glue must be servable JS, not an HTML fallback page. */
async function verifyJsServing(prefix: string, file: string): Promise<void> {
  const fail = (detail: string): MlHealUnavailableError =>
    new MlHealUnavailableError(`ONNX runtime files missing at ${prefix}${file} (${detail}).`);
  let response: Response;
  try {
    response = await fetch(`${prefix}${file}`, { headers: { Range: "bytes=0-127" } });
  } catch (error) {
    throw fail(`fetch failed: ${errorMessage(error)}`);
  }
  if (!response.ok && response.status !== 206) throw fail(`HTTP ${response.status}`);
  const text = await response.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
    throw fail("got HTML, not JavaScript (check viteStaticCopy serves ort/*.mjs)");
  }
  if (text.length < 64) throw fail("empty response");
}

async function ensureOrt(engine: MlHealEngine): Promise<OrtModule> {
  try {
    return engine === "moebius" ? await loadOrtWebgpu() : await loadOrtWasm();
  } catch (error) {
    console.error("[ml-heal] ONNX runtime failed to load:", error);
    throw new MlHealUnavailableError(`ONNX runtime failed to load: ${errorMessage(error)}`);
  }
}

async function runLama(
  ort: OrtModule,
  image: PixelImage,
  mask: RepairMask,
  url: string,
  onProgress?: HealProgress,
): Promise<PixelImage> {
  const roi = planMlHealRoi(mask);
  if (!roi) return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  const { buffer } = await fetchWeights(url, 208 * 1024 * 1024, 0, 0.7, "Downloading LaMa", onProgress);
  const session = await getSession(ort, url, buffer, "lama", 0.7, "Loading LaMa…", onProgress);
  const { image: imageTensorData, mask: maskTensorData } = packMlHealInput(image, mask, roi);
  onProgress?.(0.85, "Healing with LaMa…");
  // LaMa is a single session.run with no per-step callbacks: it can sit at
  // one fraction for seconds. Nudge the fraction on a timer so the UI can
  // infer it is still working (capped well below Done).
  let heartbeat = 0.85;
  const pulse = setInterval(() => {
    heartbeat = Math.min(0.97, heartbeat + 0.01);
    onProgress?.(heartbeat, "Healing with LaMa…");
  }, 600);
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
  } catch (error) {
    console.error("[ml-heal] LaMa inference failed:", error);
    throw new MlHealUnavailableError(`LaMa inference failed: ${errorMessage(error)}`);
  } finally {
    clearInterval(pulse);
  }
  onProgress?.(1, "Healing done");
  return compositeMlHealOutput(image, mask, roi, output);
}

function firstTensor(results: Record<string, import("onnxruntime-web").Tensor>): Float32Array {
  const tensor = results.output ?? results[Object.keys(results)[0] as string];
  if (!tensor) throw new Error("empty model output");
  return tensor.data as Float32Array;
}

/**
 * Moebius diffusion inpainting: VAE-encode the masked ROI, seed a noisy
 * latent, run classifier-free-guided DDIM with known-region re-injection,
 * VAE-decode. Conventions: VAE I/O in [-1, 1] (SD-style), latent scaled by
 * MOEBIUS_VAE_SCALE, 9-channel UNet input
 * [noisy_latent(4), fill_mask(1), masked_latent(4)], input_ids [0..9]
 * conditional / [10..19] unconditional.
 */
async function runMoebius(
  ort: OrtModule,
  image: PixelImage,
  mask: RepairMask,
  base: string,
  onProgress?: HealProgress,
): Promise<PixelImage> {
  const roi = planMlHealRoi(mask);
  if (!roi) return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  const latent = MOEBIUS_LATENT_SIZE;
  const latentN = latent * latent;
  const [unetFile, encFile, decFile] = ML_HEAL_MOEBIUS_FILES;
  const unetUrl = `${base}${unetFile}`;
  const encUrl = `${base}${encFile}`;
  const decUrl = `${base}${decFile}`;
  const totalBytes = ML_HEAL_MOEBIUS_FILE_SIZES.reduce((sum, size) => sum + size, 0);
  // Download: 0..0.6 byte-weighted across the three graphs.
  let cursor = 0;
  const parts: ArrayBuffer[] = [];
  for (let i = 0; i < ML_HEAL_MOEBIUS_FILES.length; i += 1) {
    const span = ((ML_HEAL_MOEBIUS_FILE_SIZES[i] ?? 0) / totalBytes) * 0.6;
    const { buffer } = await fetchWeights(
      [unetUrl, encUrl, decUrl][i] as string,
      ML_HEAL_MOEBIUS_FILE_SIZES[i] ?? 0,
      cursor,
      span,
      `Downloading Moebius ${i + 1}/3`,
      onProgress,
    );
    parts.push(buffer);
    cursor += span;
  }
  const unet = await getSession(ort, unetUrl, parts[0] as ArrayBuffer, "moebius", 0.6, "Loading Moebius diffusion…", onProgress);
  const enc = await getSession(ort, encUrl, parts[1] as ArrayBuffer, "moebius", 0.63, "Loading Moebius encoder…", onProgress);
  const dec = await getSession(ort, decUrl, parts[2] as ArrayBuffer, "moebius", 0.66, "Loading Moebius decoder…", onProgress);

  const { image: packed, mask: maskPacked } = packMlHealInput(image, mask, roi);
  // Masked image for the encoder: hole → 0.0 in [-1, 1] (reference parity).
  // The model must never see the object it has to remove.
  const vaeIn = maskMlHealInputForEncode(packed, maskPacked);
  if (mlDebugEnabled()) {
    let filled = 0;
    for (let i = 0; i < maskPacked.length; i += 1) filled += maskPacked[i] ?? 0;
    console.debug(`[ml-heal debug] roi=${roi.x0},${roi.y0},${roi.size} mask512=${filled}/${maskPacked.length}`);
    debugStats("vaeIn(masked)", vaeIn);
  }
  onProgress?.(0.68, "Preparing image…");
  let maskedLatent: Float32Array;
  try {
    const encOut = await enc.run({ image: new ort.Tensor("float32", vaeIn, [1, 3, 512, 512]) });
    const moments = firstTensor(encOut);
    maskedLatent = new Float32Array(4 * latentN);
    for (let c = 0; c < 4; c += 1) {
      for (let i = 0; i < latentN; i += 1) {
        maskedLatent[c * latentN + i] = (moments[c * latentN + i] ?? 0) * MOEBIUS_VAE_SCALE;
      }
    }
    } catch (error) {
    console.error("[ml-heal] Moebius VAE encode failed:", error);
    throw new MlHealUnavailableError(`Moebius VAE encode failed: ${errorMessage(error)}`);
  }
  const fillLatent = downsampleMaskToLatent(maskPacked);
  const debug = mlDebugEnabled();
  if (debug) {
    let fillCells = 0;
    for (let i = 0; i < fillLatent.length; i += 1) fillCells += fillLatent[i] ?? 0;
    console.debug(`[ml-heal debug] fill64=${fillCells}/${fillLatent.length}`);
  }
  const alphas = moebiusAlphasCumprod(moebiusBetas());
  // Preview schedule: fewer DDIM steps so interactive heals finish in low
  // minutes on integrated GPUs (each step is 2 sequential UNet passes).
  const timesteps = moebiusTimesteps(MOEBIUS_PREVIEW_INFERENCE_STEPS, MOEBIUS_STRENGTH);
  const condIds = new ort.Tensor("int64", BigInt64Array.from({ length: 10 }, (_, i) => BigInt(i)), [1, 10]);
  const uncondIds = new ort.Tensor("int64", BigInt64Array.from({ length: 10 }, (_, i) => BigInt(10 + i)), [1, 10]);
  // Pure-noise start (+ per-channel offset); image latents play no role at
  // strength≈1. Denoising runs freely — known regions are restored at
  // composite time, never re-injected mid-loop (reference parity).
  let latentF32 = seedMoebiusLatents(makeSeededGaussian, MOEBIUS_SEED);
  if (debug) {
    console.debug(`[ml-heal debug] steps=${timesteps.join(",")}`);
    debugStats("maskedLatent", maskedLatent);
    debugStats("latent0", latentF32);
  }
  const unetIn = new Float32Array(9 * latentN);
  // Heartbeat: a single UNet pass can run minutes with no callbacks (first
  // pass also compiles WebGPU shaders), so nudge progress on a timer capped
  // below the next step boundary — the UI must never look dead.
  let currentStage = `Healing 1 of ${timesteps.length}…`;
  let shown = 0.7;
  onProgress?.(0.7, "Compiling shaders — first run takes minutes…");
  const pulse = setInterval(() => {
    shown = Math.min(0.94, shown + 0.006);
    onProgress?.(shown, currentStage);
  }, 1000);
  try {
    for (let step = 0; step < timesteps.length; step += 1) {
      const t = timesteps[step] ?? 0;
      const tPrev = step + 1 < timesteps.length ? (timesteps[step + 1] ?? -1) : -1;
      const aT = alphas[t] ?? 1;
      const aPrev = tPrev < 0 ? 1 : (alphas[tPrev] ?? 1);
      // 9-channel assembly: [noisy(4), fill(1), masked(4)].
      unetIn.set(latentF32, 0);
      unetIn.set(fillLatent, 4 * latentN);
      unetIn.set(maskedLatent, 5 * latentN);
      const latentPayload = unetIn.slice();
      const tPayload = BigInt64Array.from([BigInt(t)]);
      const stepBase = 0.7 + (0.25 * step) / timesteps.length;
      const stepMid = 0.7 + (0.25 * (step + 0.5)) / timesteps.length;
      currentStage = step === 0 ? "Compiling shaders — first run takes minutes…" : `Healing ${step + 1} of ${timesteps.length}…`;
      shown = Math.max(shown, stepBase);
      onProgress?.(stepBase, currentStage);
      // Sequential CFG passes (not Promise.all): halves peak WebGPU memory
      // on unified-memory devices where two concurrent 0.22B dispatches stall.
      const condOut = await unet.run({
        latent: new ort.Tensor("float32", latentPayload.slice(), [1, 9, latent, latent]),
        timesteps: new ort.Tensor("int64", tPayload.slice(), [1]),
        input_ids: condIds,
      });
      shown = Math.max(shown, stepMid);
      onProgress?.(stepMid, `Healing ${step + 1} of ${timesteps.length}…`);
      currentStage = `Healing ${step + 1} of ${timesteps.length}…`;
      const uncondOut = await unet.run({
        latent: new ort.Tensor("float32", latentPayload.slice(), [1, 9, latent, latent]),
        timesteps: new ort.Tensor("int64", tPayload.slice(), [1]),
        input_ids: uncondIds,
      });
      const cond = firstTensor(condOut);
      const uncond = firstTensor(uncondOut);
      if (debug && (step === 0 || step === timesteps.length - 1)) {
        debugStats(`eps-cond step${step}`, cond);
        debugStats(`eps-uncond step${step}`, uncond);
      }
      // CFG + DDIM (eta 0). No mid-loop re-injection: the loop denoises
      // freely and known regions are restored at composite time (reference
      // parity — paste-back via compositeMlHealOutput + feather blend).
      const sqrtAT = Math.sqrt(aT);
      const sqrt1mAT = Math.sqrt(Math.max(0, 1 - aT));
      const sqrtAPrev = Math.sqrt(aPrev);
      const sqrt1mAPrev = Math.sqrt(Math.max(0, 1 - aPrev));
      const next = new Float32Array(4 * latentN);
      for (let i = 0; i < next.length; i += 1) {
        const eps = (uncond[i] ?? 0) + MOEBIUS_GUIDANCE * ((cond[i] ?? 0) - (uncond[i] ?? 0));
        const predX0 = ((latentF32[i] ?? 0) - sqrt1mAT * eps) / Math.max(1e-8, sqrtAT);
        next[i] = sqrtAPrev * predX0 + sqrt1mAPrev * eps;
      }
      latentF32 = next;
    }
  } catch (error) {
    if (error instanceof MlHealUnavailableError) throw error;
    console.error("[ml-heal] Moebius diffusion failed:", error);
    throw new MlHealUnavailableError(`Moebius diffusion failed: ${errorMessage(error)}`);
  } finally {
    clearInterval(pulse);
  }
  onProgress?.(0.97, "Finishing…");
  try {
    const decoded = new Float32Array(latentF32.length);
    for (let i = 0; i < decoded.length; i += 1) decoded[i] = (latentF32[i] ?? 0) / MOEBIUS_VAE_SCALE;
    const decOut = await dec.run({ latent: new ort.Tensor("float32", decoded, [1, 4, latent, latent]) });
    const rgb = firstTensor(decOut);
    if (debug) debugStats("decoded-rgb", rgb);
    const output = new Float32Array(3 * 512 * 512);
    for (let i = 0; i < output.length; i += 1) {
      output[i] = Math.max(0, Math.min(255, ((rgb[i] ?? 0) * 0.5 + 0.5) * 255));
    }
    onProgress?.(1, "Healing done");
    return compositeMlHealOutput(image, mask, roi, output);
  } catch (error) {
    console.error("[ml-heal] Moebius VAE decode failed:", error);
    throw new MlHealUnavailableError(`Moebius VAE decode failed: ${errorMessage(error)}`);
  }
}

/**
 * Run local ML inpainting for the quality tier. Fast (classic) throws
 * MlHealUnavailableError so the worker routes it to exemplar heal without
 * touching the model runtime. Best tries Moebius, then LaMa, then throws for
 * the classic fallback. Empty mask returns a source copy.
 */
export async function runMlHeal(
  image: PixelImage,
  mask: RepairMask,
  options: MlHealRunOptions = {},
): Promise<PixelImage> {
  const quality = options.quality ?? "balanced";
  const engine: MlHealEngine = mlHealEngineForQuality(quality);
  if (engine === "classic") {
    options.onProgress?.(0, "Healing with Classic…");
    throw new MlHealUnavailableError("Fast tier uses classic heal.");
  }
  const ort = await ensureOrt(engine);
  const onProgress = options.onProgress;
  await configureOrt(ort, engine, onProgress);
  if (engine === "moebius") {
    try {
      return await runMoebius(ort, image, mask, resolveMoebiusBase(options.moebiusBase), onProgress);
    } catch (error) {
      if (error instanceof MlHealUnavailableError && error.message !== "Fast tier uses classic heal.") {
        onProgress?.(0, "Best unavailable — trying Balanced…");
      } else {
        throw error;
      }
    }
  }
  try {
    return await runLama(ort, image, mask, resolveLamaUrl(options.modelUrl), onProgress);
  } catch (error) {
    if (error instanceof MlHealUnavailableError) throw error;
    throw new MlHealUnavailableError("ML inpainting inference failed.");
  }
}

/**
 * One throwaway UNet pass at real shapes so WebGPU shader compilation happens
 * during warmup (tool open), not during the first stroke. Single conditional
 * pass only — half the cost of a CFG pair, same kernels.
 */
async function precompileMoebiusUnet(ort: OrtModule, unet: OrtSession, onProgress?: HealProgress): Promise<void> {
  onProgress?.(0.6, "Preparing engine — first run compiles shaders…");
  let heartbeat = 0.6;
  const pulse = setInterval(() => {
    heartbeat = Math.min(0.94, heartbeat + 0.006);
    onProgress?.(heartbeat, "Preparing engine — first run compiles shaders…");
  }, 800);
  try {
    const latentN = MOEBIUS_LATENT_SIZE * MOEBIUS_LATENT_SIZE;
    const result = await unet.run({
      latent: new ort.Tensor("float32", new Float32Array(9 * latentN), [1, 9, MOEBIUS_LATENT_SIZE, MOEBIUS_LATENT_SIZE]),
      timesteps: new ort.Tensor("int64", BigInt64Array.from([BigInt(999)]), [1]),
      input_ids: new ort.Tensor("int64", BigInt64Array.from({ length: 10 }, (_, i) => BigInt(i)), [1, 10]),
    });
    firstTensor(result);
    onProgress?.(0.95, "Engine ready — warming done");
  } catch (error) {
    console.error("[ml-heal] Moebius precompile failed:", error);
    throw new MlHealUnavailableError(`Moebius engine check failed: ${errorMessage(error)}`);
  } finally {
    clearInterval(pulse);
  }
}

/**
 * Prefetch weights + sessions for an engine without an image (called when the
 * Repair tool opens so the first stroke never waits on the download).
 */
export async function warmupMlHeal(
  engine: MlHealEngine,
  options: Pick<MlHealRunOptions, "modelUrl" | "moebiusBase" | "onProgress"> = {},
): Promise<{ engine: MlHealEngine; cached: boolean }> {
  if (engine === "classic") return { engine, cached: true };
  const ort = await ensureOrt(engine);
  const onProgress = options.onProgress;
  await configureOrt(ort, engine, onProgress);
  if (engine === "moebius") {
    const base = resolveMoebiusBase(options.moebiusBase);
    const totalBytes = ML_HEAL_MOEBIUS_FILE_SIZES.reduce((sum, size) => sum + size, 0);
    let cursor = 0;
    let allCached = true;
    let unet: OrtSession | null = null;
    for (let i = 0; i < ML_HEAL_MOEBIUS_FILES.length; i += 1) {
      const url = `${base}${ML_HEAL_MOEBIUS_FILES[i]}`;
      const span = ((ML_HEAL_MOEBIUS_FILE_SIZES[i] ?? 0) / totalBytes) * 0.6;
      const { buffer, cached } = await fetchWeights(
        url,
        ML_HEAL_MOEBIUS_FILE_SIZES[i] ?? 0,
        cursor,
        span,
        `Downloading Moebius ${i + 1}/3`,
        onProgress,
      );
      allCached = allCached && cached;
      const session = await getSession(ort, url, buffer, "moebius", cursor, `Loading Moebius model ${i + 1} of 3…`, onProgress);
      if (i === 0) unet = session;
      cursor += span;
    }
    // Shader precompile: one throwaway UNet pass now, so the first stroke
    // diffuses immediately instead of stalling on WebGPU compilation.
    if (unet) await precompileMoebiusUnet(ort, unet, onProgress);
    onProgress?.(1, "Moebius ready on this device");
    return { engine, cached: allCached };
  }
  const url = resolveLamaUrl(options.modelUrl);
  const { buffer, cached } = await fetchWeights(url, 208 * 1024 * 1024, 0, 0.8, "Downloading LaMa", onProgress);
  await getSession(ort, url, buffer, "lama", 0.8, "Loading LaMa…", onProgress);
  onProgress?.(1, "LaMa ready on this device");
  return { engine, cached };
}

/** Drop cached sessions (tests, memory pressure). Weights stay in Cache Storage. */
export function resetMlHealPipeline(): void {
  sessions.clear();
}
