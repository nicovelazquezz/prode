import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/login';

/**
 * E2E flow #3 — admin finishes a match (spec section 10.1).
 *
 *   - Logs in as admin (DNI=00000000).
 *   - Navigates to /admin/partidos.
 *   - Clicks the first SCHEDULED match's "Detalle" link.
 *   - Opens the "Cargar resultado" modal.
 *   - Types 2-1 in the home/away score inputs.
 *   - Clicks "Continuar" then "CONFIRMAR Y CALCULAR PUNTOS".
 *   - Asserts the success toast.
 *   - Asserts the match detail re-renders with status FINISHED
 *     (the "Cargar resultado" CTA disappears, "Recalcular" appears).
 *
 * Pre-conditions:
 *   - Admin user seeded by `prisma/seed-config.ts` with the env-provided
 *     password (defaults to `ChangeMe_DevOnly!` per the dev `.env`).
 *   - The seeded matches contain at least one SCHEDULED row in the
 *     "upcoming" feed.
 *
 * Caveat: the test picks whichever match happens to be first. If a
 * previous run already finished it, the "Cargar resultado" CTA won't
 * be visible and we fall through to the next SCHEDULED row. We only
 * fail if there is no SCHEDULED match at all.
 */

test.use({
  viewport: { width: 1280, height: 800 },
});

test('admin finishes a SCHEDULED match with score 2-1', async ({
  page,
  request,
}) => {
  // Find a live SCHEDULED match via the un-cached `/matches?phase=GROUPS`
  // endpoint. The /admin/partidos UI lists rows from `/matches/upcoming`
  // which is cached server-side for 5 minutes, so its status badges go
  // stale once a match flips to FINISHED. Going directly to the detail
  // URL avoids that staleness.
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

  await loginAsAdmin(page);

  // Sanity check: visit the list page so we exercise the table
  // navigation, then jump straight to the known SCHEDULED match.
  await page.goto('/admin/partidos');
  await expect(
    page.getByRole('heading', { name: /partidos/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await page.goto(`/admin/partidos/${matchId}`);

  // On detail page — open the score modal.
  await page.getByRole('button', { name: /cargar resultado/i }).click();

  // Modal renders — fill in scores via the PredictionInput desktop
  // variant (text inputs with aria-label "Score local"/"Score visitante").
  await page.getByLabel('Score local').fill('2');
  await page.getByLabel('Score visitante').fill('1');

  // Continue → confirmation step.
  await page.getByRole('button', { name: /^continuar$/i }).click();

  // Confirm → triggers finishMatch.
  await page.getByRole('button', { name: /confirmar y calcular puntos/i }).click();

  // Toast success.
  await expect(
    page.getByText(/resultado cargado y puntos calculados/i),
  ).toBeVisible({ timeout: 15_000 });

  // The detail page now shows the "Recalcular" button (only visible
  // when match.status === FINISHED).
  await expect(
    page.getByRole('button', { name: /recalcular/i }),
  ).toBeVisible({ timeout: 10_000 });
});
