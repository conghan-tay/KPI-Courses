import { defineConfig, devices } from "@playwright/test";

/**
 * Journey 1 in a real browser, against the real stack.
 *
 * There is no `webServer` block any more, and that is the honest consequence of
 * the API moving to Go: this app can no longer serve `/api/courses/*` on its
 * own, so booting Next alone would exercise a proxy pointing at nothing. The
 * spec runs against the compose stack — web, gateway, postgres, temporal and a
 * worker on MODEL_PROVIDER=fake, which replays the fixture and needs no API key.
 *
 *   make test-e2e                                   # brings the stack up first
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // Ingestion is a durable workflow across a dozen activities. Even replaying
  // the fixture that is slower than a function call, and the default five-second
  // expect timeout would make this flaky for no reason.
  timeout: 180_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
