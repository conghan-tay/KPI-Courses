import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/studio`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Deterministic and key-free: the fixture is replayed, with the staged
      // status delays turned off so the run is fast.
      INGEST_MODE: "mock",
      INGEST_MOCK_DELAY_MS: "0",
      // A scratch store, so a test run never touches the dev data.
      DATA_DIR: path.resolve(process.cwd(), ".data-e2e"),
    },
  },
});
