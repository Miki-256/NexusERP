import { test, expect } from "@playwright/test";
import { expectModulePageHeading } from "./helpers/page-smoke";
import { hasE2eCredentials } from "./helpers/credentials";

test.describe("Order-to-cash invoicing", () => {
  test("create and post a customer invoice to the ledger", async ({ page }) => {
    test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD");

    await page.goto("/invoicing");
    await expectModulePageHeading(page, "Customer Invoicing");

    const form = page.locator("form").filter({
      has: page.getByRole("button", { name: "Create draft" }),
    });
    test.skip(!(await form.isVisible({ timeout: 10_000 }).catch(() => false)), "Manager access required");

    const description = `E2E invoice ${Date.now()}`;
    await form.getByPlaceholder("Description").fill(description);
    await form.getByPlaceholder("Qty").fill("1");
    await form.getByPlaceholder("Unit price").fill("100");

    await form.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Invoice created" })).toBeVisible({
      timeout: 30_000,
    });

    const postBtn = page.getByRole("button", { name: "Post" }).first();
    await expect(postBtn).toBeVisible({ timeout: 30_000 });
    await postBtn.click();
    await expect(page.getByRole("status").filter({ hasText: "Invoice posted to ledger" })).toBeVisible({
      timeout: 30_000,
    });
  });
});
