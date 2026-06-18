/**
 * Seed sample products using the service role key.
 *
 * Add to apps/web/.env.local:
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *
 * Run: node scripts/seed-sample-products.mjs
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const ORG_ID = "bc3717ca-62e9-4cfd-b0da-019499953072";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, "apps/web/.env.local");

function loadEnv() {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local\n");
  console.error("Quick alternative: open Supabase → SQL Editor and run:");
  console.error("  supabase/seeds/sample_products_bc3717ca.sql");
  process.exit(1);
}

const res = await fetch("http://localhost:3000/api/dev/seed-products", {
  method: "POST",
});

const body = await res.json();
console.log(res.status, body);

if (!res.ok) process.exit(1);
