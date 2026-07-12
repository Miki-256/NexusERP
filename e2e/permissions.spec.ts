import { test, expect } from "@playwright/test";
import { loginTenantUser } from "./helpers/auth";
import {
  e2eCashierCredentials,
  hasE2eCashierCredentials,
  hasE2eCredentials,
} from "./helpers/credentials";
import { expectModulePageHeading } from "./helpers/page-smoke";

/** Manager/owner routes cashiers should not reach by default. */
const MANAGER_ONLY = [
  { path: "/financials", heading: "Financial Management" },
  { path: "/team", heading: "Team & access" },
  { path: "/settings", heading: "Settings" },
  { path: "/invoicing", heading: "Customer Invoicing" },
  { path: "/purchasing", heading: "Purchasing & Vendor Bills" },
] as const;

/** Routes included in CASHIER_DEFAULT_APP_IDS. */
const CASHIER_ALLOWED = [
  { path: "/dashboard", heading: /Dashboard/i },
  { path: "/sales", heading: "Sales Register" },
  { path: "/customers", heading: "Customers" },
] as const;

test.describe("Permission matrix — manager", () => {
  test("manager can open restricted finance and admin apps", async ({ page }) => {
    test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD");

    for (const route of MANAGER_ONLY) {
      await page.goto(route.path);
      await expectModulePageHeading(page, route.heading);
      await expect(page).toHaveURL(new RegExp(route.path.replace("/", "\\/")));
    }
  });
});

test.describe("Permission matrix — cashier", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("cashier is redirected away from manager-only apps", async ({ page }) => {
    test.skip(!hasE2eCashierCredentials(), "Set E2E_CASHIER_EMAIL and E2E_CASHIER_PASSWORD");

    const { email, password } = e2eCashierCredentials();
    await loginTenantUser(page, email, password);

    for (const route of MANAGER_ONLY) {
      await page.goto(route.path);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    }
  });

  test("cashier can open default sales apps", async ({ page }) => {
    test.skip(!hasE2eCashierCredentials(), "Set E2E_CASHIER_EMAIL and E2E_CASHIER_PASSWORD");

    const { email, password } = e2eCashierCredentials();
    await loginTenantUser(page, email, password);

    for (const route of CASHIER_ALLOWED) {
      await page.goto(route.path);
      await expectModulePageHeading(page, route.heading);
    }
  });
});

test.describe("Permission matrix — nav visibility", () => {
  test("manager sidebar exposes Team and Accounting", async ({ page }) => {
    test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD");

    await page.goto("/dashboard");
    await expect(page.getByRole("navigation").getByRole("link", { name: "Team & access" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("navigation").getByRole("link", { name: "Accounting" })).toBeVisible();
  });
});
