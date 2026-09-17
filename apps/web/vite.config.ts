import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The Vite base path is a placeholder here; CI / Pages deployment (Milestone 4)
// injects the real `/{repo}/` base so the built demo works under GitHub Pages.
const base = "/timeline/";

export default defineConfig({
  plugins: [react()],
  base,
  // The web app is LAN-accessible by design: bind to 0.0.0.0:8123 (the port
  // the rest of the project uses for local runs and the Playwright smoke test).
  // Exposing to the LAN without auth is part of the plan (trusted LAN only).
  server: {
    host: "0.0.0.0",
    port: 8123,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8123,
    strictPort: true,
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