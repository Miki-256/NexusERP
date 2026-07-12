import { expect, type Page } from "@playwright/test";

/** Match the page `<h1>` from PageHeader, not nested form/card headings. */
export async function expectModulePageHeading(
  page: Page,
  heading: string | RegExp,
  timeout = 30_000
) {
  const main = page.locator("main");
  const locator =
    typeof heading === "string"
      ? main.getByRole("heading", { level: 1, name: heading, exact: true })
      : main.getByRole("heading", { level: 1, name: heading });
  await expect(locator).toBeVisible({ timeout });
}
