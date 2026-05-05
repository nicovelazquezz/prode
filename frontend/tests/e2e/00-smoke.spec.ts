import { expect, test } from '@playwright/test';

/**
 * Smoke test — exercises the Playwright + Next.js dev server wiring.
 * Hits `/api/health`, the only Next.js route handler in the project,
 * and asserts the JSON shape. Must pass before any of the actual flow
 * specs are useful.
 */
test('frontend health endpoint responds', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toMatchObject({ status: 'ok' });
});
