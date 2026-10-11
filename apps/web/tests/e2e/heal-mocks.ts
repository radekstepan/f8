// apps/web/tests/e2e/heal-mocks.ts
//
// Deterministic stand-ins for the photo server's neural endpoints. Real ML
// tiers need 208MB (LaMa) to ~1.3GB (Moebius) weights plus minutes of
// diffusion — impossible in CI — so ML specs intercept:
//
//   GET  /api/ml-heal/health    -> both engines serving (or not, on demand)
//   POST /api/ml-heal/warmup    -> background kick, instant serving snapshot
//   POST /api/ml-heal/inpaint   -> tinted 512x512 RGB per engine
//
// The tint is the assertion mechanism: compositeMlHealOutput paints the
// returned RGB where the mask is nonzero, so canvas pixels prove which
// engine healed which group. Calls (engine, delay, failures) are recorded
// for queue-ordering assertions.

import type { Page, Route } from "@playwright/test";

export const LAMA_TINT = { r: 38, g: 200, b: 90 } as const;
export const MOEBIUS_TINT = { r: 150, g: 60, b: 220 } as const;

export interface MockInpaintCall {
  engine: string;
  at: number;
  roi: { x0: number; y0: number; size: number } | null;
  /** Nonzero bytes in the posted ROI mask: the client's real mask sparsity. */
  maskNonzero: number;
  maskTotal: number;
}

function engineSnapshot(serving: boolean) {
  return {
    weightsReady: serving,
    sessionsWarm: serving,
    serving,
    downloading: false,
    downloadPct: serving ? 1 : 0,
    error: serving ? null : "mocked: engine never provisioned",
  };
}

function healthBody(lamaServing: boolean, moebiusServing: boolean) {
  return {
    ok: true,
    ready: true,
    ortAvailable: true,
    lamaReady: lamaServing,
    lamaCached: lamaServing,
    moebiusReady: moebiusServing,
    modelsCached: moebiusServing,
    device: "mock",
    detail: "Mocked ML health for e2e.",
    engines: {
      lama: engineSnapshot(lamaServing),
      moebius: engineSnapshot(moebiusServing),
    },
  };
}

// Model-output layout is planar NCHW (3 planes of 512x512: all R, then all
// G, then all B) — the same bytes the real server forwards from its
// Float32Array inference result (see app.ts ml-heal/inpaint). A packed RGB
// interleave here would desynchronize every plane and land as sparse
// rainbow pixels instead of the intended flat tint.
function tintedOutput(tint: { r: number; g: number; b: number }): string {
  const size = 512;
  const plane = size * size;
  const rgb = Buffer.alloc(3 * plane);
  rgb.fill(tint.r, 0, plane);
  rgb.fill(tint.g, plane, 2 * plane);
  rgb.fill(tint.b, 2 * plane, 3 * plane);
  return rgb.toString("base64");
}

export interface MockMlOptions {
  /** Extra latency per inpaint call; exercises queue + progress copy. */
  delayMs?: number;
  /** Engines that answer 503 instead of pixels (blur fallback path). */
  failing?: ("lama" | "moebius")[];
  /** Engineers serving health (default both true). */
  lamaServing?: boolean;
  moebiusServing?: boolean;
}

/**
 * Install the mocked neural backend. Returns a live call log the spec can
 * assert ordering/aggregate progress against.
 */
export async function mockMlHeal(page: Page, options: MockMlOptions = {}): Promise<MockInpaintCall[]> {
  const { delayMs = 0, failing = [], lamaServing = true, moebiusServing = true } = options;
  const calls: MockInpaintCall[] = [];

  await page.route("**/api/ml-heal/health", (route: Route) =>
    route.fulfill({ json: healthBody(lamaServing, moebiusServing) }),
  );
  await page.route("**/api/ml-heal/warmup", (route: Route) =>
    route.fulfill({ json: healthBody(lamaServing, moebiusServing) }),
  );
  await page.route("**/api/ml-heal/inpaint", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      engine?: string;
      roi?: { x0: number; y0: number; size: number };
      maskB64?: string;
    } | null;
    const engine = body?.engine === "lama" ? "lama" : "moebius";
    let maskNonzero = -1;
    let maskTotal = -1;
    try {
      const raw = Buffer.from(body?.maskB64 ?? "", "base64");
      maskTotal = raw.length;
      maskNonzero = 0;
      for (const byte of raw) if (byte !== 0) maskNonzero += 1;
    } catch {
      // Leave the -1 sentinels: the spec will fail loudly on them.
    }
    calls.push({ engine, at: Date.now(), roi: body?.roi ?? null, maskNonzero, maskTotal });
    if (failing.includes(engine)) {
      await route.fulfill({ status: 503, json: { error: "Remote heal failed." } });
      return;
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      json: {
        engine: `${engine}-remote`,
        width: 512,
        height: 512,
        outputB64: tintedOutput(engine === "lama" ? LAMA_TINT : MOEBIUS_TINT),
      },
    });
  });
  return calls;
}
