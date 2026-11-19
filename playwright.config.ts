import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Browser end-to-end tests against the real API.
 *
 * The API lives in its own repo; point TP_API_DIR at a checkout of it.
 * It runs on a throwaway in-memory MongoDB (`pnpm dev:memory`), never a
 * real database.
 *
 *   TP_API_DIR=../../Backend/tp-writer-api pnpm test:e2e
 */
const apiDir = process.env.TP_API_DIR;
// Dedicated ports so the suite doesn't collide with dev servers on 3000/3001.
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
if (!apiDir) {
  throw new Error("Set TP_API_DIR to the tp-writer-api checkout to run e2e tests.");
}

export default defineConfig({
  testDir: "e2e",
  // Tests share one API process and account; keep them sequential.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    storageState: "e2e/.auth/user.json",
    viewport: { width: 1400, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1400, height: 1000 },
        // Locally use the installed Chrome; CI installs Playwright's build.
        ...(process.env.CI ? {} : { channel: "chrome" }),
      },
    },
  ],
  webServer: [
    {
      command: "pnpm dev:memory",
      cwd: path.resolve(apiDir),
      env: { PORT: String(API_PORT), CORS_ORIGINS: `http://localhost:${APP_PORT}` },
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Empty VITE_API_URL → the app uses the /api dev proxy.
      command: `pnpm exec vite --port ${APP_PORT} --strictPort`,
      env: { VITE_API_URL: "", VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
