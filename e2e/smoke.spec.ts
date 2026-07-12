import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginTenantUser } from "./helpers/auth";
import { e2eCredentials, hasE2eCredentials } from "./helpers/credentials";

type Fixtures = {
  prepared?: boolean;
  email?: string;
  registerId?: string;
  registerName?: string;
  staffName?: string;
  staffPin?: string;
  productName?: string;
  error?: string;
};

const e2eDir = path.join(process.cwd(), "e2e");

function loadFixtures(): Fixtures {
  const file = path.join(e2eDir, "fixtures.json");
  if (!existsSync(file)) return { prepared: false };
  return JSON.parse(readFileSync(file, "utf8")) as Fixtures;
}

const fixtures = loadFixtures();
const { email, password } = e2eCredentials();
const loginEmail = email || fixtures.email || "";

test.describe("NexusERP smoke", () => {
  // Exercise the real login form — not the shared auth.setup session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login and sales register loads", async ({ page }) => {
    test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run smoke tests");

    await loginTenantUser(page, loginEmail, password);

    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: "Sales Register" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByPlaceholder(/Search receipt/i)).toBeVisible();
  });

  test("POS cash sale appears in sales register", async ({ page }) => {
    const fx = loadFixtures();
    test.skip(
      !fx.prepared || !hasE2eCredentials(),
      fx.error ?? "Run with E2E_EMAIL, E2E_PASSWORD, E2E_STAFF_PIN and stocked products"
    );

    await loginTenantUser(page, loginEmail, password);

    await page.goto(`/pos/${fx.registerId}`);
    await expect(page.getByText(fx.registerName ?? "Register", { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("option", { name: new RegExp(fx.staffName!, "i") }).click();
    await page.getByPlaceholder("••••").fill(fx.staffPin!);
    await page.getByRole("button", { name: "Enter" }).click();

    const openShift = page.getByRole("button", { name: "Open shift" });
    if (await openShift.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await openShift.click();
    }

    await expect(page.getByRole("button", { name: /Checkout/i })).toBeVisible({ timeout: 30_000 });

    const productButton = page.getByRole("button", { name: fx.productName!, exact: false }).first();
    await productButton.click();

    await page.getByRole("button", { name: /Checkout/i }).click();
    await expect(page.getByRole("button", { name: /Complete sale/i })).toBeVisible();

    const exactBtn = page.getByRole("button", { name: "Exact order" });
    if (await exactBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await exactBtn.click();
    }

    await page.getByRole("button", { name: /Complete sale/i }).click();
    await expect(page.getByText("Receipt preview")).toBeVisible({ timeout: 30_000 });

    const receiptText = await page.locator(".pos-modal-panel").textContent();
    const receiptMatch = receiptText?.match(/R-\d+|REC-[A-Z0-9-]+|\b\d{4,}\b/i);
    const receiptNo = receiptMatch?.[0];

    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: "Sales Register" })).toBeVisible();

    if (receiptNo) {
      await page.getByPlaceholder(/Search receipt/i).fill(receiptNo);
      await expect(page.getByText(receiptNo, { exact: false }).first()).toBeVisible({
        timeout: 15_000,
      });
    } else {
      await expect(page.locator("table tbody tr, .space-y-3 > div").first()).toBeVisible();
    }
  });
});
