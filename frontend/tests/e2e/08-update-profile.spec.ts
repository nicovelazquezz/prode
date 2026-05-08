import { expect, test } from '@playwright/test';
import { loginAsUser } from './helpers/login';

/**
 * E2E flow #8 — /perfil edit (Sprint 2.3).
 *
 * Logs in as DNI=44444444 (seeded "Test Cuatro"), navigates to /perfil,
 * changes firstName, saves, and verifies:
 *   - Success toast surfaces.
 *   - The form re-fills with the new value (we re-read after the
 *     onSuccess refresh()).
 *   - The AppHeader greeting reflects the new name.
 *   - A reload preserves the new value (so it really hit the backend
 *     and not just the in-memory form state).
 *
 * We pick DNI 44 specifically so spec #2 (load-prediction, uses 11) and
 * spec #5 (leagues, uses 22) stay independent — a parallel run won't
 * race over the same seed user. The new name uses only letters because
 * the regex (`/^[A-Za-zÁÉÍÓÚáéíóúñÑüÜ' -]+$/`) rejects digits.
 *
 * Pre-conditions:
 *   - Dev users seeded: `npx tsx backend/prisma/seed-dev-users.ts`.
 *   - Backend on :3001 in dev with PATCH /users/me wired (Sprint 2.1).
 *
 * Cleanup is intentional best-effort: we revert the firstName at the
 * end via a second PATCH so re-runs against a shared dev DB stay green.
 */

const NAME_POOL = [
  'Tomás',
  'Lucas',
  'Mateo',
  'Bruno',
  'Iván',
  'Pablo',
  'Cesar',
  'Javier',
];

function pickDifferent(current: string): string {
  // Pick something that's not the current value to guarantee `dirty`.
  const candidate = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
  if (candidate && candidate !== current) return candidate;
  return current === 'Tomás' ? 'Bruno' : 'Tomás';
}

test('user edits firstName from /perfil and the change persists', async ({
  page,
}) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // eslint-disable-next-line no-console
      console.log('[browser console error]', msg.text());
    }
  });
  page.on('pageerror', (err) => {
    // eslint-disable-next-line no-console
    console.log('[browser pageerror]', err.message);
  });

  await loginAsUser(page, '44444444');

  // Navigate to /perfil. Use direct goto rather than clicking the
  // bottom-nav so we don't depend on viewport / nav rendering.
  await page.goto('/perfil');
  await expect(
    page.getByRole('heading', { name: /perfil\.?/i }),
  ).toBeVisible({ timeout: 15_000 });

  const firstNameInput = page.locator('#firstName');
  await firstNameInput.waitFor({ state: 'visible' });
  const originalName = (await firstNameInput.inputValue()) || 'Test';
  const newName = pickDifferent(originalName);

  await firstNameInput.fill(newName);

  const saveBtn = page.getByRole('button', { name: /guardar cambios/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // Toast feedback (sonner). The success toast renders a status role.
  await expect(page.getByText(/perfil actualizado/i)).toBeVisible({
    timeout: 10_000,
  });

  // The form input should reflect the new value after the onSuccess
  // form.reset() runs.
  await expect(firstNameInput).toHaveValue(newName, { timeout: 5_000 });

  // The AppHeader greeting reads from the AuthProvider — refresh()
  // triggered by the mutation should propagate.
  await expect(page.getByText(`Hola, ${newName}`)).toBeVisible({
    timeout: 10_000,
  });

  // Reload — the change must come from the backend, not the form's
  // in-memory state. The /auth/me bootstrap fills the AppHeader and
  // the form with the persisted firstName.
  await page.reload();
  await expect(page.locator('#firstName')).toHaveValue(newName, {
    timeout: 15_000,
  });
  await expect(page.getByText(`Hola, ${newName}`)).toBeVisible();

  // Cleanup: revert the firstName so re-runs don't drift the seed.
  // If this PATCH fails the test still passes — the assertion contract
  // is already satisfied above.
  await page.locator('#firstName').fill(originalName);
  const revertBtn = page.getByRole('button', { name: /guardar cambios/i });
  if (await revertBtn.isEnabled()) {
    await revertBtn.click();
    await expect(page.getByText(/perfil actualizado/i)).toBeVisible({
      timeout: 10_000,
    });
  }
});

test('client-side validation rejects digits in firstName', async ({ page }) => {
  await loginAsUser(page, '44444444');
  await page.goto('/perfil');

  const firstNameInput = page.locator('#firstName');
  await firstNameInput.waitFor({ state: 'visible' });
  await firstNameInput.fill('Pepe123');

  // Trigger the zod resolver by attempting submit. The form blocks the
  // mutation when the schema fails — we'll see the error message render
  // below the input and no success toast appears.
  await page.getByRole('button', { name: /guardar cambios/i }).click();

  await expect(
    page.getByText(/solo letras, espacios, tildes, ñ, ' y -/i),
  ).toBeVisible({ timeout: 5_000 });
});
