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

test('admin finishes a SCHEDULED match with score 2-1', async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto('/admin/partidos');

  // Wait for the table to render.
  await expect(
    page.getByRole('heading', { name: /partidos/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // The "Detalle" link in each row carries aria-label
  // "Editar partido N" (the visible text is "Detalle"). We pick the
  // first row whose status cell shows "SCHEDULED".
  const detalleLinks = page.getByRole('link', { name: /editar partido/i });
  const linkCount = await detalleLinks.count();
  expect(linkCount).toBeGreaterThan(0);

  let targetIndex = -1;
  for (let i = 0; i < Math.min(linkCount, 20); i++) {
    const row = detalleLinks.nth(i).locator('xpath=ancestor::tr[1]');
    const txt = (await row.innerText()).toUpperCase();
    if (txt.includes('SCHEDULED')) {
      targetIndex = i;
      break;
    }
  }
  expect(
    targetIndex,
    'No SCHEDULED match found in /admin/partidos',
  ).toBeGreaterThanOrEqual(0);

  await Promise.all([
    page.waitForURL(/\/admin\/partidos\/[^/]+/),
    detalleLinks.nth(targetIndex).click(),
  ]);

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
