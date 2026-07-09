/**
 * Run axe-core against the POS page.
 *
 * Usage:
 *   npm run audit:pos-a11y
 *   POS_A11Y_URL=http://localhost:3003/pos npm run audit:pos-a11y
 *
 * First run downloads Chromium via Playwright if missing.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const targetUrl = process.env.POS_A11Y_URL ?? "https://nexus-erp-preprod.vercel.app/pos";

function isMissingBrowserError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /Executable doesn't exist|browserType\.launch/i.test(msg);
}

function installChromium() {
  console.log("Playwright Chromium not found — downloading (one-time setup)…\n");
  const result = spawnSync("npx", ["playwright", "install", "chromium"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      "Failed to install Playwright Chromium. Run manually: npx playwright install chromium"
    );
  }
}

async function launchBrowser(chromium, retried = false) {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    if (!retried && isMissingBrowserError(err)) {
      installChromium();
      return launchBrowser(chromium, true);
    }
    throw err;
  }
}

async function main() {
  const { chromium } = await import("playwright");

  const browser = await launchBrowser(chromium);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log(`Navigating to ${targetUrl}…`);
  const response = await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60_000 });
  console.log(`HTTP ${response?.status() ?? "?"}`);

  await page.waitForTimeout(2000);

  const title = await page.title();
  const hasPosRoot = await page.locator(".pos-root, .pos-shell, [class*='pos-']").count();
  const isLogin = await page.locator('input[type="password"], [href*="login"]').count();

  console.log(`Page title: ${title}`);
  console.log(`POS-like elements: ${hasPosRoot}`);
  if (isLogin > 0 && hasPosRoot === 0) {
    console.warn(
      "⚠ Page appears to require authentication. Audit ran on the reachable shell only."
    );
  }

  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    // @ts-expect-error axe injected inline
    const axe = window.axe;
    if (!axe) throw new Error("axe-core failed to load");
    axe.reset();
    return axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      resultTypes: ["violations", "incomplete"],
    });
  });

  const violations = results.violations ?? [];
  const incomplete = results.incomplete ?? [];

  console.log("\n=== axe POS accessibility audit ===\n");
  console.log(`URL: ${targetUrl}`);
  console.log(`Violations: ${violations.length}`);
  console.log(`Incomplete: ${incomplete.length}`);

  if (violations.length === 0) {
    console.log("\n✓ No WCAG violations detected on this page state.");
  } else {
    console.log("\n--- Violations ---");
    for (const v of violations) {
      console.log(`\n[${v.impact?.toUpperCase() ?? "UNKNOWN"}] ${v.id}: ${v.help}`);
      console.log(`  ${v.description}`);
      console.log(`  Nodes: ${v.nodes.length}`);
      for (const node of v.nodes.slice(0, 3)) {
        console.log(`    • ${node.html?.slice(0, 120)}`);
      }
      if (v.nodes.length > 3) console.log(`    … +${v.nodes.length - 3} more`);
    }
  }

  if (incomplete.length > 0) {
    console.log("\n--- Incomplete (manual review) ---");
    for (const item of incomplete.slice(0, 8)) {
      console.log(`• ${item.id}: ${item.help} (${item.nodes.length} nodes)`);
    }
  }

  await browser.close();
  process.exit(violations.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
