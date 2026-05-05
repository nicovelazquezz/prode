import { expect, test } from '@playwright/test';
import { loginAsUser, logout } from './helpers/login';

/**
 * E2E flow #5 — create + join a mini-league (spec section 10.1).
 *
 *   1. User A (DNI=33333333) creates a league via /ligas/crear.
 *   2. The CreatedDialog renders the 6-char invite code prominently.
 *   3. We capture the code from the dialog text.
 *   4. Logout user A, login user B (DNI=44444444).
 *   5. User B navigates to /ligas/unirme, types the code, submits.
 *   6. Toast success + redirect to /leaderboard/liga/<leagueId>.
 *   7. Both users appear in the league leaderboard.
 *
 * Pre-conditions:
 *   - Dev users seeded (Test Tres = 33333333, Test Cuatro = 44444444).
 */

test.use({
  viewport: { width: 1280, height: 800 },
});

test('two users can create + join a mini-league', async ({ page }) => {
  test.setTimeout(60_000);

  // ── 1) User A creates a league ───────────────────────────────────
  await loginAsUser(page, '33333333');
  await page.goto('/ligas/crear');

  // Unique name per run so we can find the league deterministically.
  const leagueName = `E2E Liga ${Date.now()}`;
  await page.fill('#name', leagueName);
  // Description is optional; leave empty.
  // maxMembers is pre-filled with 50.

  await page.getByRole('button', { name: /crear liga/i }).click();

  // The CreatedDialog renders a 6-char code in big text. Wait for it
  // and capture the value via the dialog's accessible content.
  await expect(
    page.getByRole('heading', { name: /liga creada/i }),
  ).toBeVisible({ timeout: 15_000 });

  // The code is rendered in the dialog inside a <p> styled with a
  // very large font-size (clamp 48px..80px). Easier than parsing the
  // raw text (which contains other words like "CREADA"): grab via
  // the WhatsApp share link which embeds the literal code in the
  // text query param `?text=Te invito ... codigo ABCDEF: ...`.
  const dialog = page.getByRole('dialog');
  const waLink = dialog.getByRole('link', { name: /whatsapp/i });
  const waHref = await waLink.getAttribute('href');
  expect(waHref, 'WhatsApp share link missing').not.toBeNull();
  const decoded = decodeURIComponent(waHref ?? '');
  const codeMatch = decoded.match(
    /codigo ([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6})/i,
  );
  expect(codeMatch, `Could not extract invite code from share link:\n${decoded}`).not.toBeNull();
  const inviteCode = codeMatch![1];

  // ── 2) Logout user A, login user B ───────────────────────────────
  await logout(page);
  await loginAsUser(page, '44444444');

  // ── 3) User B joins the league via /ligas/unirme ────────────────
  await page.goto(`/ligas/unirme?code=${inviteCode}`);

  // The page autofills the OTP from `?code=`. The submit button is
  // a regular submit. We just click it and wait for the toast +
  // navigation.
  await Promise.all([
    page.waitForURL(/\/leaderboard\/liga\//, { timeout: 15_000 }),
    page.getByRole('button', { name: /unirme/i }).click(),
  ]);

  // ── 4) Both users show up in the league leaderboard ──────────────
  // The page renders the league name in a heading.
  await expect(
    page.getByRole('heading', { name: new RegExp(leagueName, 'i') }),
  ).toBeVisible({ timeout: 15_000 });

  // Each leaderboard row is a <button> with aria-label
  // "Posicion N: <First> <Last>, X puntos". We assert both users.
  await expect(
    page.getByRole('button', { name: /test tres.*puntos/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole('button', { name: /test cuatro.*puntos/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
});
