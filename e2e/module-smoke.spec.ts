import { test } from "@playwright/test";
import { hasE2eCredentials } from "./helpers/credentials";
import { expectModulePageHeading } from "./helpers/page-smoke";

type ModuleSmoke = {
  path: string;
  heading: string | RegExp;
};

const SALES_MODULES: ModuleSmoke[] = [
  { path: "/pos", heading: "Select register" },
  { path: "/invoicing", heading: "Customer Invoicing" },
  { path: "/crm", heading: "CRM Pipeline" },
  { path: "/customers", heading: "Customers" },
  { path: "/refunds", heading: "Refunds" },
  { path: "/credits", heading: "Store Credit & Liabilities" },
  { path: "/receivables", heading: "Customer receivables" },
];

const INVENTORY_MODULES: ModuleSmoke[] = [
  { path: "/products", heading: "Products" },
  { path: "/inventory", heading: "Inventory" },
  { path: "/fulfillment", heading: "Fulfillment" },
  { path: "/purchasing", heading: "Purchasing & Vendor Bills" },
  { path: "/manufacturing", heading: "Manufacturing" },
  { path: "/promotions", heading: "Promotions" },
];

const FINANCE_MODULES: ModuleSmoke[] = [
  { path: "/financials", heading: "Financial Management" },
  { path: "/expenses", heading: "Expense Register" },
  { path: "/reports", heading: "Business Reports" },
  { path: "/documents", heading: "Documents" },
  { path: "/communications", heading: "Communication & Notification Center" },
  { path: "/communications/queue", heading: "Delivery queue" },
];

const HR_MODULES: ModuleSmoke[] = [
  { path: "/hr", heading: "Human Resources" },
  { path: "/recruitment", heading: "Recruitment" },
  { path: "/time-off", heading: "Time & Attendance" },
  { path: "/projects", heading: "Project" },
  { path: "/helpdesk", heading: "Helpdesk" },
];

const SETTINGS_MODULES: ModuleSmoke[] = [
  { path: "/stores", heading: "Stores & Registers" },
  { path: "/team", heading: "Team & access" },
  { path: "/settings", heading: "Settings" },
  { path: "/settings/billing", heading: "Billing & plan" },
];

function registerModuleSmoke(group: string, modules: ModuleSmoke[]) {
  test.describe(`Module smoke — ${group}`, () => {
    for (const mod of modules) {
      test(`loads ${mod.path}`, async ({ page }) => {
        test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD");
        await page.goto(mod.path);
        await expectModulePageHeading(page, mod.heading);
      });
    }
  });
}

test.describe("Module smoke — dashboard", () => {
  test("loads /dashboard", async ({ page }) => {
    test.skip(!hasE2eCredentials(), "Set E2E_EMAIL and E2E_PASSWORD");
    await page.goto("/dashboard");
    await expectModulePageHeading(page, /Dashboard/i);
  });
});

registerModuleSmoke("sales", SALES_MODULES);
registerModuleSmoke("inventory", INVENTORY_MODULES);
registerModuleSmoke("finance", FINANCE_MODULES);
registerModuleSmoke("HR & services", HR_MODULES);
registerModuleSmoke("settings", SETTINGS_MODULES);
