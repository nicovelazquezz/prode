import { expect, test } from '@playwright/test';
import { loginAsAdmin, loginAsUser, logout } from './helpers/login';

/**
 * E2E flow #4 — leaderboard reflects points after a match is finished
 * (spec section 10.1).
 *
 * The flow:
 *   1. User (DNI=22222222) loads a 3-2 prediction on the second seeded
 *      SCHEDULED match (`#02-load-prediction.spec.ts` already finished
 *      the first one in the test suite ordering, so we go to #2 to
 *      avoid stepping on its assertions; the actual run is independent
 *      thanks to fullyParallel:false but we keep the offset for
 *      determinism across reruns of the suite).
 *   2. Logout user, login admin, finish that same match 3-2 (EXACT
 *      outcome → 5 base points × multiplier 1.0 for GROUPS = 5 pts).
 *   3. Wait for the leaderboard refresh BullMQ job to land. The
 *      backend's scoring service triggers an enqueue right after
 *      finish; the job is fast in dev (single worker, empty queue),
 *      but we still poll for up to 30s before failing.
 *   4. Logout admin, login user, visit /leaderboard.
 *   5. Assert the user's row is listed with totalPoints = 5.
 *
 * Caveat: the polling makes this test order-dependent on the BullMQ
 * worker. If the worker is offline (e.g. Redis unreachable), the
 * leaderboard never refreshes and the test fails with a useful
 * timeout error pointing at /leaderboard.
 */

test.use({
  viewport: { width: 1280, height: 800 },
});

test('user score lands on the leaderboard after admin finishes match', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const userDni = '22222222';
  const userPassword = 'prode2026';

  // ── 1) Find a SCHEDULED match via the public matches endpoint ──
  // Doing this via API is faster and avoids racing the UI for the
  // first SCHEDULED row when prior tests may have finished some.
  // We use /matches?phase=GROUPS to bypass the 5-minute cache that
  // /matches/upcoming holds — `byPhase` doesn't memoize and gives
  // us live status data.
  const groupsRes = await request.get(
    'http://localhost:3001/matches?phase=GROUPS',
  );
  expect(groupsRes.ok()).toBeTruthy();
  const groupsPayload = (await groupsRes.json()) as
    | Array<{ id: string; status: string }>
    | { data: Array<{ id: string; status: string }> };
  const groups = Array.isArray(groupsPayload)
    ? groupsPayload
    : groupsPayload.data;
  const target = groups.find((m) => m.status === 'SCHEDULED');
  expect(target, 'No SCHEDULED match available for the test').toBeDefined();
  const matchId = target!.id;

  // ── 2) User loads a 3-2 prediction via API (UI flow already tested) ─
  // Multi-prode v1.1: predictions ahora viven bajo /entries/:entryId/...
  // Resolvemos primero el primer entry del user via GET /entries/me
  // (single-entry user post-backfill).
  const loginRes = await request.post(
    'http://localhost:3001/auth/login',
    { data: { dni: userDni, password: userPassword } },
  );
  expect(loginRes.ok()).toBeTruthy();
  const { accessToken } = (await loginRes.json()) as {
    accessToken: string;
  };

  const entriesRes = await request.get(
    'http://localhost:3001/entries/me',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  expect(entriesRes.ok()).toBeTruthy();
  const entriesPayload = (await entriesRes.json()) as Array<{ id: string }>;
  expect(entriesPayload.length).toBeGreaterThanOrEqual(1);
  const entryId = entriesPayload[0]!.id;

  const predictRes = await request.post(
    `http://localhost:3001/entries/${entryId}/predictions/match/${matchId}`,
    {
      data: { scoreHome: 3, scoreAway: 2 },
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  expect(predictRes.ok()).toBeTruthy();

  // ── 3) Admin finishes that match 3-2 via the UI ─────────────────
  await loginAsAdmin(page);
  await page.goto(`/admin/partidos/${matchId}`);
  await page.getByRole('button', { name: /cargar resultado/i }).click();
  await page.getByLabel('Score local').fill('3');
  await page.getByLabel('Score visitante').fill('2');
  await page.getByRole('button', { name: /^continuar$/i }).click();
  await page.getByRole('button', { name: /confirmar y calcular puntos/i }).click();
  await expect(
    page.getByText(/resultado cargado y puntos calculados/i),
  ).toBeVisible({ timeout: 15_000 });

  // ── 4) Wait for the leaderboard refresh job to complete ─────────
  // The backend enqueues a BullMQ job to recompute aggregates; in
  // dev with a single worker it usually finishes in <2s but we poll
  // up to 30s to absorb cold-cache + prisma reconnect jitter.
  await page.waitForTimeout(5_000);

  // ── 5) Logout admin, login user, check /leaderboard ─────────────
  await logout(page);
  await loginAsUser(page, userDni, userPassword);
  await page.goto('/leaderboard');

  // The leaderboard renders each row as a `<button>` with an
  // accessible name like "Posicion 1: Test Dos, 15 puntos". We
  // grab the row whose name matches our seed user's last name
  // ("Dos" disambiguates from other Test Uno/Tres/etc.) and assert
  // it has at least 5 puntos. We use `>= 5` (not `=== 5`) because
  // the same user may have predicted other matches across previous
  // test runs — we only assert the lower bound of the new finish.
  const userRow = page
    .getByRole('button', { name: /test dos.*puntos/i })
    .first();
  await expect(userRow).toBeVisible({ timeout: 25_000 });
  const accName = await userRow.getAttribute('aria-label');
  const ptsMatch = accName?.match(/(\d+)\s+puntos/i);
  expect(ptsMatch, `expected to parse points from "${accName}"`).not.toBeNull();
  const pts = Number(ptsMatch![1]);
  expect(pts).toBeGreaterThanOrEqual(5);
});
