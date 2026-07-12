import { test, expect, type Page } from "@playwright/test";
import { expectModulePageHeading } from "./helpers/page-smoke";
import { hasE2eCredentials } from "./helpers/credentials";

async function ensureVendor(page: Page) {
  const poForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Create PO" }) });
  await expect(poForm).toBeVisible({ timeout: 30_000 });

  const vendorSelect = poForm.locator("select").nth(0);
  if ((await vendorSelect.locator("option:not([value=''])").count()) > 0) {
    return vendorSelect;
  }

  await page.getByRole("button", { name: "Vendors" }).click();
  const vendorForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add" }) });
  await expect(vendorForm).toBeVisible();
  await vendorForm.locator("input").first().fill(`E2E Supplier ${Date.now()}`);
  await vendorForm.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vendor added" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Purchase Orders" }).click();
  await expect(poForm).toBeVisible({ timeout: 30_000 });
  return poForm.locator("select").nth(0);
}

test.describe("Procure-to-pay workflow", () => {
  test("create and receive a purchase order", async ({ page }) => {
    test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD");

    await page.goto("/purchasing");
    await expectModulePageHeading(page, "Purchasing & Vendor Bills");

    const poForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Create PO" }) });
    test.skip(!(await poForm.isVisible({ timeout: 10_000 }).catch(() => false)), "Manager access required");

    const vendorSelect = await ensureVendor(page);
    await vendorSelect.selectOption({ index: 1 });

    const productSelect = poForm.locator("select").filter({ hasText: "Select product…" });
    const productOptions = productSelect.locator("option:not([value=''])");
    test.skip((await productOptions.count()) === 0, "No product variants for PO test");

    await productSelect.selectOption((await productOptions.first().getAttribute("value"))!);
    await poForm.getByPlaceholder("Qty").fill("2");
    await poForm.getByPlaceholder("Unit cost").fill("10");

    await poForm.getByRole("button", { name: "Create PO" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Purchase order created" })).toBeVisible({
      timeout: 30_000,
    });

    const receiveBtn = page.getByRole("button", { name: "Receive" }).first();
    await expect(receiveBtn).toBeVisible({ timeout: 30_000 });
    await receiveBtn.click();
    await expect(page.getByRole("status").filter({ hasText: "PO received" })).toBeVisible({
      timeout: 30_000,
    });
  });
});
