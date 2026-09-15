import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the timeline web UI (issue #56).
 *
 * The smoke test boots the Vite dev server on 127.0.0.1:8123 (the loopback
 * port the whole project uses for local runs) and drives a real Chromium
 * against the app shell. It runs with no backend: the spec intercepts the API
 * routes and returns sample JSON, so the Timeline / Calendar views and the
 * summary bar render with real content.
 *
 * Playwright starts/stops the dev server for us via `webServer` (loopback
 * only — the web app is never exposed beyond 127.0.0.1 by design). Headless
 * Chromium is required; if the browser binaries are unavailable, run
 * `npx playwright install chromium` once.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  // Loopback only — the web app is never exposed beyond 127.0.0.1 by design.
  use: {
    baseURL: "http://127.0.0.1:8123",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8123",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
