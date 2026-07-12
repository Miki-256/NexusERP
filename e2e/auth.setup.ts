import fs from "node:fs";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { loginTenantUser } from "./helpers/auth";
import { e2eCredentials, hasE2eCredentials } from "./helpers/credentials";

const authDir = path.join(__dirname, ".auth");
const authFile = path.join(authDir, "user.json");

setup("authenticate", async ({ page }) => {
  fs.mkdirSync(authDir, { recursive: true });

  if (!hasE2eCredentials()) {
    await page.goto("/login");
    await page.context().storageState({ path: authFile });
    return;
  }

  const { email, password } = e2eCredentials();
  await loginTenantUser(page, email, password);
  await page.context().storageState({ path: authFile });
});
