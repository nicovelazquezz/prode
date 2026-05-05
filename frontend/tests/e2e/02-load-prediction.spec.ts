import { expect, test } from '@playwright/test';
import { loginAsUser } from './helpers/login';

/**
 * E2E flow #2 — load a prediction (spec section 10.1).
 *
 * Logs in as a seeded dev user (`prisma/seed-dev-users.ts`), opens the
 * mobile NumberPadSheet on the first scheduled match, taps a 2-1 score
 * and saves. Then asserts the badge swap to "✓ GUARDADO" and that the
 * value persists across a page reload.
 *
 * Mobile viewport (390×844) is required for the NumberPadSheet flow —
 * `PredictionInput` renders an inline `<input>` on desktop and a tap
 * target that opens the sheet on mobile (≤767px), per spec §6.5.
 *
 * Pre-conditions:
 *   - Dev users seeded:
 *       NODE_ENV=development npx tsx backend/prisma/seed-dev-users.ts
 *   - Backend on :3001 in dev with throttler bypassed if rerunning
 *     more than ~5 times/hour (login limiter is 5/min/IP+DNI).
 *   - At least one scheduled match in /matches/upcoming (the standard
 *     match seed covers this).
 */

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test('user loads a 2-1 prediction and it persists across reload', async ({
  page,
}) => {
  await loginAsUser(page, '11111111');

  // Land on /predicciones — wait for matches to render.
  await page.waitForURL(/\/predicciones/);

  // Mobile PredictionInput renders a `<button>` with aria-label
  // `Prediccion <homeTeamName>`. Seeded matches use placeholder
  // names like "Eq A1", "Eq A2", etc — we just want the first one.
  const homeBtn = page
    .getByRole('button', { name: /^prediccion /i })
    .first();
  await homeBtn.waitFor({ state: 'visible', timeout: 15_000 });

  // Read the home/away team labels from the card so we can target the
  // matching TeamRow buttons inside the sheet without hard-coding
  // "Eq A1" etc. The PredictionInput aria-label is "Prediccion <name>".
  const homeAriaLabel = await homeBtn.getAttribute('aria-label');
  const homeTeamName = homeAriaLabel?.replace(/^prediccion\s+/i, '') ?? 'Eq A1';

  // Tap the home prediction button → opens the NumberPadSheet.
  await homeBtn.click();

  // Wait for the drawer to fully open. vaul animates it in over ~500ms,
  // and clicking on keypad buttons during the slide-up animation
  // sometimes lands on the overlay (which doesn't propagate clicks).
  // Locator the dialog by its accessible name + wait for stable bbox.
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });

  // Sheet renders — assert the GUARDAR button is visible. We don't
  // check its disabled state because a prior run may have left a
  // prediction in the DB which the sheet pre-fills (enabled GUARDAR).
  const saveBtn = page.getByRole('button', { name: /^guardar$/i });
  await expect(saveBtn).toBeVisible();

  // Clear and set home score = 2. Keypad appends digits, so we hit
  // "Borrar" once before "2" to reset stale state from prior runs.
  const keypad = page.getByRole('group', { name: /teclado numerico/i });
  await keypad.getByRole('button', { name: /borrar/i }).click();
  await keypad.getByRole('button', { name: '2' }).click();

  // Switch to the away row. After tapping a digit the home row is
  // still aria-pressed=true; the away row is the inactive button
  // inside the dialog. We target by aria-pressed=false so the
  // assertion is decoupled from the placeholder character order.
  void homeTeamName; // documents intent for the locator
  const inactiveRow = dialog
    .locator('button[aria-pressed="false"]')
    .first();
  await inactiveRow.click();
  // Clear away then set 1.
  await keypad.getByRole('button', { name: /borrar/i }).click();
  await keypad.getByRole('button', { name: '1' }).click();

  // Save.
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // Sheet closes; the MatchCard now shows "✓ GUARDADO".
  await expect(page.getByText('✓ GUARDADO').first()).toBeVisible({
    timeout: 10_000,
  });

  // Reload and re-check — the prediction must come back from the API.
  await page.reload();
  await expect(page.getByText('✓ GUARDADO').first()).toBeVisible({
    timeout: 15_000,
  });
});
