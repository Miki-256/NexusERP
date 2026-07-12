import { test, expect, type Page } from "@playwright/test";

export async function loginTenantUser(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(
    (url) => {
      const p = url.pathname;
      return !p.includes("/login") && !p.includes("/signup");
    },
    { timeout: 30_000, waitUntil: "domcontentloaded" }
  );
}

export async function mainScrollTop(page: Page): Promise<number> {
  return page.locator("main").evaluate((el) => el.scrollTop);
}

export async function scrollTenantMain(page: Page, top: number) {
  await page.locator("main").evaluate((el, value) => {
    el.scrollTop = value;
  }, top);
}
