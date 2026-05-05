import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Prode frontend E2E tests.
 *
 * Tests run against:
 * - Frontend (Next.js dev server) at http://localhost:3000
 *   Auto-started via `webServer` so devs/CI just run `npx playwright test`.
 * - Backend (NestJS) at http://localhost:3001
 *   Assumed to be running already (started via `cd backend && npm run start:dev`).
 *
 * The backend dependency is intentional: starting NestJS + BullMQ workers +
 * Postgres + Redis is too heavy to wire here, and we want devs running the
 * backend interactively while iterating on tests.
 *
 * Defaults: chromium-only (single browser is enough for the 5 happy-path flows
 * in spec section 10.1), 1 retry to absorb network flakiness, screenshots and
 * videos kept only when a test fails so the artifacts dir stays small.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // tests share backend state (DB), keep them serial
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1, // serial — same reason as fullyParallel: false
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Auto-start the Next.js dev server. Backend (port 3001) must be running
  // separately — see top-of-file note.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
