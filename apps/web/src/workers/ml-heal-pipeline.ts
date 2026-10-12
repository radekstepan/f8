// ML-heal worker pipeline: retired to stubs — every neural engine runs on
// the photo server via /api/ml-heal (server-required, always up).
//
// The in-browser paths are deleted: LaMa's WASM worker run plus the WebGPU
// diffusion path that hung multi-area jobs. This module keeps its exports so
// the vision worker still compiles: any stray ml-heal call throws
// MlHealUnavailableError and the worker falls back to exemplar heal, while
// the app routes all ML tiers to the server before the worker is involved.

import {
  mlHealEngineForQuality,
  type HealProgress,
  type HealQuality,
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
  onProgress?: HealProgress;
}

function unavailable(engine: MlHealEngine): MlHealUnavailableError {
  if (engine === "classic") return new MlHealUnavailableError("Fast tier uses classic heal.");
  return new MlHealUnavailableError("ML heal runs on the photo server (start it with yarn dev).");
}

/**
 * Never runs inference: Fast (classic) routes to exemplar heal, every neural
 * tier routes to the photo server. Always throws MlHealUnavailableError.
 */
export async function runMlHeal(
  image: PixelImage,
  _mask: RepairMask,
  options: MlHealRunOptions = {},
): Promise<PixelImage> {
  void image;
  const engine = mlHealEngineForQuality(options.quality ?? "balanced");
  options.onProgress?.(0, engine === "classic" ? "Repairing with Classic…" : "Repairing on photo server…");
  throw unavailable(engine);
}

/**
 * Never prefetches: the browser holds no ML weights. Always throws
 * MlHealUnavailableError for neural tiers so callers probe the server.
 */
export async function warmupMlHeal(
  engine: MlHealEngine,
  _options: Pick<MlHealRunOptions, "onProgress"> = {},
): Promise<{ engine: MlHealEngine; cached: boolean }> {
  if (engine === "classic") return { engine, cached: true };
  throw unavailable(engine);
}

/** No sessions exist anymore; kept for callers that reset on cancel. */
export function resetMlHealPipeline(): void {}
