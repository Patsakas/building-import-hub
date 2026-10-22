import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the static build served by the Firebase Hosting emulator (the same
// rewrites as production; the emulator does not apply custom headers, the post-deploy smoke test
// checks those) and a local Supabase stack with the seed users.
// See e2e/README.md for how to run them locally.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
