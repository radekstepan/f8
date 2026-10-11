// apps/web/tests/e2e/global-setup.ts
//
// Assert the isolated e2e stack is up before the suite runs: the photo
// server (seeded sample library in apps/server/.e2e, never the dev library)
// answers through the Vite proxy, and the seed photos exist. Per-photo state
// (edits, heal overlays) is reset by each spec's beforeEach via the API
// (see helpers.ts resetPhoto), so no global wipe is needed here — leftover
// state between runs is the norm, and every spec starts deterministic anyway.
import { expect, request } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5174";

export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const health = await ctx.get("/api/health");
    if (!health.ok()) {
      throw new Error(`/api/health failed: ${health.status()} ${await health.text()}`);
    }
    const library = await ctx.get("/api/library");
    if (!library.ok()) {
      throw new Error(`/api/library failed: ${library.status()} ${await library.text()}`);
    }
    const body = (await library.json()) as { photos?: unknown[] };
    expect(body.photos?.length ?? 0).toBeGreaterThan(0);
  } finally {
    await ctx.dispose();
  }
}
