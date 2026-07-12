import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), "apps/web/.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

if (!process.env.INTEGRATION_TEST_EMAIL && process.env.LOAD_TEST_EMAIL) {
  process.env.INTEGRATION_TEST_EMAIL = process.env.LOAD_TEST_EMAIL;
}
if (!process.env.INTEGRATION_TEST_PASSWORD && process.env.LOAD_TEST_PASSWORD) {
  process.env.INTEGRATION_TEST_PASSWORD = process.env.LOAD_TEST_PASSWORD;
}
if (!process.env.E2E_EMAIL && process.env.LOAD_TEST_EMAIL) {
  process.env.E2E_EMAIL = process.env.LOAD_TEST_EMAIL;
}
if (!process.env.E2E_PASSWORD && process.env.LOAD_TEST_PASSWORD) {
  process.env.E2E_PASSWORD = process.env.LOAD_TEST_PASSWORD;
}
