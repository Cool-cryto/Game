import { defineConfig, devices } from "@playwright/test";
import { ADVANCED_STORAGE } from "./tests/e2e/storage";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:5173", viewport: { width: 1400, height: 860 }, storageState: ADVANCED_STORAGE },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 860 } } }],
  webServer: [
    { command: "npx vite --port 5173", url: "http://localhost:5173", reuseExistingServer: true },
    // The game server, with a fresh throw-away database and a short AI-takeover delay for testing.
    {
      command: "rm -rf ../../.cache/e2e-db && DATA_DIR=../../.cache/e2e-db GRACE_MS=2000 WEB_DIST=/none PORT=8787 npx tsx ../server/src/main.ts",
      url: "http://localhost:8787/api/health",
      reuseExistingServer: true,
    },
  ],
});
