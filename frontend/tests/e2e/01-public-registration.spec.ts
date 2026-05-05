import { expect, test } from '@playwright/test';

/**
 * E2E flow #1 — public registration (spec section 10.1).
 *
 * Walks the canonical "I want to play the Prode" path:
 *   1.  Visit `/` (landing).
 *   2.  Click "Pagar con MercadoPago".
 *   3.  Land on `/dev/mock-checkout` (backend dev mock provider points
 *       initPoint at this page in NODE_ENV=development).
 *   4.  Type a payer email, click "Aprobar pago".
 *   5.  Backend dev/simulate-webhook approves the Payment, mints a
 *       fresh completion token and the page redirects to
 *       `/inscripcion/success?token=...`.
 *   6.  After a short delay, success page redirects to
 *       `/completar-registro?token=...`.
 *   7.  Fill in DNI/firstName/lastName/whatsapp/password and submit.
 *   8.  Land on `/predicciones` with the AppHeader greeting visible.
 *
 * Pre-conditions:
 *   - Backend on :3001 in NODE_ENV=development with the mock checkout
 *     provider bound (see backend/src/shared/checkout/checkout.module.ts).
 *   - Postgres + Redis up (via docker compose).
 *
 * Each run picks a random unused DNI in the 60_000_000–69_999_999 range
 * to avoid colliding with seeded fixtures or earlier runs of the same
 * test against a shared dev DB.
 */

function randomDni(): string {
  // 8 digits, leading 6 → safe distance from real DNIs and our seed
  // accounts (00000000, 11111111…55555555).
  const n = 60_000_000 + Math.floor(Math.random() * 9_999_999);
  return String(n);
}

function randomWhatsapp(): string {
  // 10 digits area+number under +54 9 prefix. Random suffix to keep
  // unique against the User.whatsapp unique constraint.
  const n = 2914000000 + Math.floor(Math.random() * 999_999);
  return String(n);
}

test('public registration: pay → mock approve → complete → predicciones', async ({
  page,
}) => {
  const email = `e2e+${Date.now()}@local.test`;
  const dni = randomDni();
  const whatsapp = randomWhatsapp();
  const firstName = 'Pepe';
  const lastName = 'Tester';
  const password = 'prode2026';

  // Surface unexpected console / network errors. The flow has many
  // moving parts (CORS, throttler, mock provider) and a silent toast
  // failure at the CTA used to swallow the real cause.
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
  page.on('requestfailed', (req) => {
    // eslint-disable-next-line no-console
    console.log('[request failed]', req.url(), req.failure()?.errorText);
  });

  // 1) Landing
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /sumate al prode/i }),
  ).toBeVisible();

  // 2) Click "Pagar con MercadoPago" — the CTA button on the landing.
  await Promise.all([
    page.waitForURL(/\/dev\/mock-checkout/, { timeout: 30_000 }),
    page.getByRole('button', { name: /pagar con mercadopago/i }).click(),
  ]);

  // 3) Mock checkout — fill email, click Aprobar
  await expect(
    page.getByRole('heading', { name: /mock checkout/i }),
  ).toBeVisible();
  await page.fill('#mock-email', email);

  await Promise.all([
    page.waitForURL(/\/inscripcion\/success/, { timeout: 30_000 }),
    page.getByRole('button', { name: /aprobar pago/i }).click(),
  ]);

  // 4) Inscripcion success page auto-redirects to completar-registro after
  // ~1.5s. Just wait for the URL change rather than polling the DOM.
  await page.waitForURL(/\/completar-registro/, { timeout: 15_000 });

  // 5) Form: step 1 (DNI + nombre + apellido)
  await expect(
    page.getByRole('heading', { name: /completá tu registro/i }),
  ).toBeVisible();

  await page.fill('#reg-dni', dni);
  await page.fill('#reg-first', firstName);
  await page.fill('#reg-last', lastName);

  // The form is multi-step on mobile (md hidden) — we run with the
  // Desktop Chrome viewport so all sections are visible at once and a
  // single submit completes everything. We still fill all three steps
  // because the inputs are present in the DOM regardless.
  await page.fill('#reg-whatsapp', whatsapp);
  await page.fill('#reg-password', password);

  await Promise.all([
    page.waitForURL(/\/predicciones/, { timeout: 30_000 }),
    page.getByRole('button', { name: /completar registro/i }).click(),
  ]);

  // 6) AppHeader greets us by first name.
  await expect(page.getByText(`Hola, ${firstName}`)).toBeVisible({
    timeout: 10_000,
  });
});
