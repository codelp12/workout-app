import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const viewport = { width: 390, height: 844 };

// Runs against the production build (`pnpm build` first) with a fresh
// in-memory database, so the service worker and precache are the real ones.
export default defineConfig({
  testDir: "tests",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport },
    },
  ],
  webServer: {
    command: "pnpm --filter @workout-app/server start",
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    env: { PORT: String(port), DATABASE_PATH: ":memory:" },
  },
});
