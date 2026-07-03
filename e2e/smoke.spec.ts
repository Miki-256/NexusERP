import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

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

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

function loadFixtures(): Fixtures {
  const file = path.join(e2eDir, "fixtures.json");
  if (!existsSync(file)) return { prepared: false };
  return JSON.parse(readFileSync(file, "utf8")) as Fixtures;
}

const fixtures = loadFixtures();
const email = process.env.E2E_EMAIL ?? fixtures.email;
const password = process.env.E2E_PASSWORD;

test.describe("NexusERP smoke", () => {
  test("login and sales register loads", async ({ page }) => {
    test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run smoke tests");

    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: /^Sign in/ }).click();

    await page.waitForURL(/\/(dashboard|pending-approval|onboarding)/, { timeout: 30_000 });

    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: "Sales Register" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByPlaceholder(/Search receipt/i)).toBeVisible();
  });

  test("POS cash sale appears in sales register", async ({ page }) => {
    test.skip(
      !fixtures.prepared || !email || !password,
      fixtures.error ?? "Run with E2E_EMAIL, E2E_PASSWORD, E2E_STAFF_PIN and stocked products"
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: /^Sign in/ }).click();
    await page.waitForURL(/\/(dashboard|pending-approval|onboarding)/, { timeout: 30_000 });

    await page.goto(`/pos/${fixtures.registerId}`);
    await expect(page.getByText(fixtures.registerName ?? "Register", { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: fixtures.staffName! }).click();
    await page.getByPlaceholder("••••").fill(fixtures.staffPin!);
    await page.getByRole("button", { name: "Enter" }).click();

    const openShift = page.getByRole("button", { name: "Open shift" });
    if (await openShift.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await openShift.click();
    }

    await expect(page.getByRole("button", { name: /Checkout/i })).toBeVisible({ timeout: 30_000 });

    const productButton = page.getByRole("button", { name: fixtures.productName!, exact: false }).first();
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
