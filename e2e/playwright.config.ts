import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_PASSWORD } from "./credentials";

const port = 4173;
const viewport = { width: 390, height: 844 };
const dbPath = join(tmpdir(), "workout-app-e2e.db");

// Runs against the production build (`pnpm build` first) with a fresh
// database and a known password, so the service worker and precache are the
// real ones.
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
    command: `rm -f "${dbPath}"* && printf %s "$E2E_PASSWORD" | node dist/set-password.js && node dist/index.js`,
    cwd: "../apps/server",
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      DATABASE_PATH: dbPath,
      E2E_PASSWORD,
      // WebKit drops Secure cookies over plain http, even on 127.0.0.1.
      COOKIE_SECURE: "false",
    },
  },
});
