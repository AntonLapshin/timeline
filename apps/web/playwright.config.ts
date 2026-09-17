import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the timeline web UI (issue #56).
 *
 * The smoke test boots the Vite dev server and drives a real Chromium
 * against the app shell over the loopback interface (127.0.0.1:8123). The
 * dev server itself binds 0.0.0.0 (owner LAN-access decision, see
 * vite.config.ts) — 0.0.0.0 accepts loopback connections, so the loopback
 * URL keeps working unchanged. It runs with no backend: the spec
 * intercepts the API routes and returns sample JSON, so the Timeline /
 * Calendar views and the summary bar render with real content.
 *
 * Playwright starts/stops the dev server for us via `webServer`. Headless
 * Chromium is required; if the browser binaries are unavailable, run
 * `npx playwright install chromium` once.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  // The test connects via loopback (127.0.0.1) even though the dev server
  // binds 0.0.0.0 (owner decision, see vite.config.ts).
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
