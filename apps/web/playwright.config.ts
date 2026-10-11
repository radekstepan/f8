// apps/web/playwright.config.ts
//
// Playwright e2e for Photomator. Mirrors the shape of the sibling
// `ynab4-alternative-spa-implementation` config (one config inside the app,
// chromium-only project, CI-aware retries/workers/reporter, workers: 1).
//
// Adaptations for Photomator's split architecture:
//   - Two webServers: the Hono photo server (source via `yarn dev`, always
//     current, no build needed) on 5194 backed by an isolated data dir
//     (apps/server/.e2e), plus Vite dev on 5174 proxying /api at it via
//     PHOTOMATOR_API. The dev library on 5193 is never touched.
//   - PHOTOMATOR_ML_HEAL_OFFLINE=1: the test server never downloads real
//     weights (208MB–1.3GB). ML specs route-intercept /api/ml-heal/* with
//     deterministic tinted outputs (see tests/e2e/heal-mocks.ts).
//   - E2E_TESTING=true is passed through as a future seam (same as sibling).
//
// Concurrency: the suite mutates one shared test library (edits + heal
// overlays for the seed photos), so tests MUST not run in parallel —
// workers: 1 everywhere, local as deterministic as CI.
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = process.env.PLAYWRIGHT_PORT ? Number(process.env.PLAYWRIGHT_PORT) : 5174;
const API_PORT = process.env.PLAYWRIGHT_API_PORT ? Number(process.env.PLAYWRIGHT_API_PORT) : 5194;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
// Absolute so the server resolves it independent of webServer cwd.
const E2E_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../server/.e2e",
);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: [
    {
      // Source-run (node type-stripping, same as `yarn dev`): e2e always
      // exercises current server code with no build step.
      command: "yarn workspace @photomator/server dev",
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: String(API_PORT),
        PHOTOMATOR_DATA: E2E_DATA_DIR,
        PHOTOMATOR_ML_HEAL_OFFLINE: "1",
      },
    },
    {
      // --host 127.0.0.1: Vite defaults to `localhost` (often ::1 only),
      // which the IPv4 healthcheck below could never reach.
      command: `yarn dev --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PHOTOMATOR_API: API_URL,
        E2E_TESTING: "true",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
