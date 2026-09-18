import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Minimal node env typing for the proxy target below (the web tsconfig only
// includes vite/client + vitest/globals, so `process` is otherwise unknown to
// tsc; the config itself always runs in node via vite).
declare const process: { env: Record<string, string | undefined> };

// The Vite base path is a placeholder here; CI / Pages deployment (Milestone 4)
// injects the real `/{repo}/` base so the built demo works under GitHub Pages.
const base = "/timeline/";

// Backend target for the /api + /healthz proxy. The host run (`make start`)
// serves the API on 127.0.0.1:8124 and sets TIMELINE_API_URL accordingly;
// docker compose overrides this to http://api:8124 via the TIMELINE_API_URL environment (see docker-compose.yml). The proxy keeps the
// frontend same-origin, so it works for both localhost and LAN IPs with a
// single firewall port (8123) and no CORS issues.
const apiTarget = process.env.TIMELINE_API_URL ?? "http://127.0.0.1:8123";

export default defineConfig({
  plugins: [react()],
  base,
  // The web app is LAN-accessible by design: bind to 0.0.0.0:8123 (owner
  // decision, commit 3ccc3a5) so the dev server is reachable from the host
  // system and the LAN, not just loopback. The app has no auth — anyone on
  // the LAN can read/write events, so this assumes a trusted LAN. The
  // Playwright smoke test still targets 127.0.0.1:8123 and keeps working
  // (0.0.0.0 accepts loopback connections).
  server: {
    host: "0.0.0.0",
    port: 8123,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/healthz": { target: apiTarget, changeOrigin: true },
    },
  },
  // `preview` (production-build preview, `npm run preview`) binds the same
  // way for parity with the dev server and the Docker serve stage.
  preview: {
    host: "0.0.0.0",
    port: 8123,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/healthz": { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // The e2e smoke spec lives in tests/e2e/ and is run by Playwright, not
    // vitest. Exclude it so `npm test` (vitest) stays unit-only.
    exclude: ["tests/e2e/**"],
    // Coverage is enforced only on core business logic (plan.md §19.1). The UI
    // layer stays a thin, dumb view and is intentionally excluded from the gate.
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      exclude: [],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
      reporter: ["text", "html"],
    },
  },
});