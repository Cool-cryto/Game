import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:5173", viewport: { width: 1400, height: 860 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 860 } } }],
  webServer: { command: "npx vite --port 5173", url: "http://localhost:5173", reuseExistingServer: true },
});
