import { test, expect } from "@playwright/test";
import { mainScrollTop, scrollTenantMain } from "./helpers/auth";
import { hasE2eCredentials } from "./helpers/credentials";

test.describe("Financials navigation", () => {
  test("reporting tab switch preserves main scroll position", async ({ page }) => {
    test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD");

    await page.goto("/financials?area=reporting&tab=pnl&from=2026-01-01&to=2026-12-31");

    await expect(page.getByRole("heading", { name: "Financial Management" })).toBeVisible({
      timeout: 30_000,
    });

    await scrollTenantMain(page, 420);
    await expect.poll(() => mainScrollTop(page)).toBeGreaterThan(300);

    await page.getByRole("button", { name: "Trial Balance" }).click({ force: true });
    await expect(page).toHaveURL(/tab=trial/);
    await expect.poll(() => mainScrollTop(page)).toBeGreaterThan(300);
  });

  test("area change keeps scroll position on tenant main", async ({ page }) => {
    test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD");

    await page.goto("/financials?area=reporting&tab=pnl&from=2026-01-01&to=2026-12-31");

    await expect(page.getByRole("heading", { name: "Financial Management" })).toBeVisible({
      timeout: 30_000,
    });

    await scrollTenantMain(page, 360);
    await expect.poll(() => mainScrollTop(page)).toBeGreaterThan(250);

    await page.getByRole("tab", { name: "Ledger" }).click({ force: true });
    await expect(page).toHaveURL(/area=ledger/);
    await expect.poll(() => mainScrollTop(page), { timeout: 10_000 }).toBeGreaterThan(200);
  });
});
