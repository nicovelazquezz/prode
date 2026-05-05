import { expect, test } from "@playwright/test";

/**
 * Landing Mundial 2026 — verifica render del hero, CTAs y FAQ.
 * No depende del backend (la landing es totalmente estática a nivel
 * red — no hay fetches a /api).
 */
test.describe("Landing Mundial 2026", () => {
  test("hero muestra INSCRIPCIÓN ABIERTA + brand correcto", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/INSCRIPCIÓN ABIERTA/i).first()).toBeVisible();
    await expect(
      page.getByText(/PRODE MUNDIAL 2026 · BAHÍA BLANCA/i).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /JUGÁ EL PRODE\./i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /BANCÁ EL VIAJE\./i }),
    ).toBeVisible();
  });

  test("CTA primario apunta a /inscripcion", async ({ page }) => {
    await page.goto("/");
    const primary = page
      .getByRole("link", { name: /Inscribirme · \$10\.000/i })
      .first();
    await expect(primary).toHaveAttribute("href", "/inscripcion");
  });

  test("CTA Cómo funciona apunta al ancla de la sección", async ({ page }) => {
    await page.goto("/");
    const secondary = page
      .getByRole("link", { name: /Cómo funciona/i })
      .first();
    await expect(secondary).toHaveAttribute("href", "#como-funciona");
  });

  test("FAQ items se expanden al click", async ({ page }) => {
    await page.goto("/");
    const summary = page.getByText("¿Necesito ser socio del club?");
    // Antes del click la respuesta no es visible (details cerrado).
    const answer = page.getByText(/cualquiera puede jugar/i);
    await expect(answer).toBeHidden();
    await summary.click();
    await expect(answer).toBeVisible();
  });

  test("countdown grid tiene aria-live polite", async ({ page }) => {
    await page.goto("/");
    const liveRegion = page.locator("[aria-live='polite']").first();
    await expect(liveRegion).toBeAttached();
  });

  test("footer muestra columna Organiza con club", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(/Club Tiro Federal · Bahía Blanca · 2026/i).first(),
    ).toBeVisible();
  });
});
