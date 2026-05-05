import { expect, type Page } from '@playwright/test';

/**
 * Login helpers for E2E tests.
 *
 * The login form lives at `/login` with two inputs identified by
 * `id="login-dni"` and `id="login-password"`, plus a submit button. We
 * select by label text where possible to stay resilient to markup
 * changes, then fall back to the input id only if needed.
 */

const ADMIN_DNI = '00000000';
const ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

export const SEED_USER_PASSWORD = 'prode2026';

/**
 * Logs in as a regular user using DNI/password and waits for the
 * post-login redirect to `/predicciones`. If the user has an active
 * session already (e.g. from a prior test in the same browser context),
 * we expect the login submit to short-circuit; the helper still works
 * because it always navigates to /login first.
 */
export async function loginAsUser(
  page: Page,
  dni: string,
  password: string = SEED_USER_PASSWORD,
): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-dni', dni);
  await page.fill('#login-password', password);
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith('/predicciones'), {
      timeout: 15_000,
    }),
    // The public header also has an "Ingresar" link styled as a
    // button — scope to the form's submit button to avoid the strict
    // mode violation when both are visible.
    page.locator('button[type="submit"]').getByText(/ingresar/i).click(),
  ]);
  await expect(page).toHaveURL(/\/predicciones/);
}

/**
 * Logs in as the seeded admin user (DNI=00000000) and waits for the
 * redirect to `/admin`. Password comes from `ADMIN_DEFAULT_PASSWORD`
 * env var or the dev default if not set.
 */
export async function loginAsAdmin(
  page: Page,
  password: string = ADMIN_PASSWORD,
): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-dni', ADMIN_DNI);
  await page.fill('#login-password', password);
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith('/admin'), {
      timeout: 15_000,
    }),
    // The public header also has an "Ingresar" link styled as a
    // button — scope to the form's submit button to avoid the strict
    // mode violation when both are visible.
    page.locator('button[type="submit"]').getByText(/ingresar/i).click(),
  ]);
  await expect(page).toHaveURL(/\/admin/);
}

/**
 * Clears auth state by hitting the logout endpoint. Useful between
 * test cases that need to switch user identity. After logout, the
 * caller should `goto('/login')` (or any public page) before logging
 * in as a different user — the AuthProvider needs a navigation cycle
 * to pick up the cleared session.
 */
export async function logout(page: Page): Promise<void> {
  // The app exposes logout via the AppHeader/perfil page; the simplest
  // reliable way in tests is to clear cookies + storage and let the
  // next navigation re-evaluate auth.
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  });
}
