#!/usr/bin/env node
/**
 * Playwright global setup — prepares E2E fixtures when credentials are available.
 * Writes e2e/fixtures.json (gitignored).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "../..");
const envPath = path.join(root, "apps/web/.env.local");
const outPath = path.join(root, "e2e/fixtures.json");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* missing */
  }
  return out;
}

async function authSignIn(supabaseUrl, anonKey, email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description ?? body.msg ?? JSON.stringify(body));
  return body.access_token;
}

async function rpc(supabaseUrl, anonKey, token, name, args = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${name}: ${typeof data === "object" ? data.message ?? JSON.stringify(data) : data}`);
  }
  return data;
}

async function restGet(supabaseUrl, anonKey, token, table, query) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${table}: ${await res.text()}`);
  return res.json();
}

export default async function globalSetup() {
  mkdirSync(path.dirname(outPath), { recursive: true });

  const env = loadEnv(envPath);
  const email =
    process.env.E2E_EMAIL ?? env.E2E_EMAIL ?? env.LOAD_TEST_EMAIL ?? "";
  const password =
    process.env.E2E_PASSWORD ?? env.E2E_PASSWORD ?? env.LOAD_TEST_PASSWORD ?? "";
  const staffPin =
    process.env.E2E_STAFF_PIN ?? env.E2E_STAFF_PIN ?? env.LOAD_TEST_STAFF_PIN ?? "";

  if (!email || !password) {
    console.log("[e2e] Skipping fixture prep — set E2E_EMAIL and E2E_PASSWORD.");
    writeFileSync(outPath, JSON.stringify({ prepared: false }, null, 2));
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!supabaseUrl || !anonKey) {
    console.warn("[e2e] Missing Supabase URL/key — POS smoke will be skipped.");
    writeFileSync(outPath, JSON.stringify({ prepared: false }, null, 2));
    return;
  }

  try {
    const accessToken = await authSignIn(supabaseUrl, anonKey, email, password);
    const workspace = await rpc(supabaseUrl, anonKey, accessToken, "get_my_workspace", {});
    const orgId = workspace.organization?.id;
    if (!orgId) throw new Error("No workspace organization");

    const registerId =
      process.env.E2E_REGISTER_ID ??
      env.E2E_REGISTER_ID ??
      (
        await restGet(
          supabaseUrl,
          anonKey,
          accessToken,
          "registers",
          `organization_id=eq.${orgId}&is_active=eq.true&select=id,name&order=created_at&limit=1`
        )
      )[0]?.id;

    if (!registerId) throw new Error("No active register");

    const ctx = await rpc(supabaseUrl, anonKey, accessToken, "get_pos_register_context", {
      p_register_id: registerId,
    });
    const staff = ctx?.staff ?? [];
    const staffMember =
      staff.find((s) => s.display_name === (process.env.E2E_STAFF_NAME ?? env.E2E_STAFF_NAME)) ??
      staff[0];

    if (!staffMember) throw new Error("No POS staff on register");
    if (!staffPin) throw new Error("Set E2E_STAFF_PIN (4–6 digit cashier PIN)");

    const openSession = await rpc(supabaseUrl, anonKey, accessToken, "get_open_register_session", {
      p_register_id: registerId,
    });
    if (!openSession?.id) {
      await rpc(supabaseUrl, anonKey, accessToken, "open_register_session_manager", {
        p_register_id: registerId,
        p_organization_id: orgId,
        p_opening_float: 0,
        p_staff_id: null,
      });
    }

    const catalog = await rpc(supabaseUrl, anonKey, accessToken, "get_pos_catalog", {
      p_register_id: registerId,
    });
    const inStock = (catalog ?? []).find((item) => item.stock > 0 && item.variantId);
    if (!inStock) throw new Error("No in-stock products on register catalog");

    writeFileSync(
      outPath,
      JSON.stringify(
        {
          prepared: true,
          email,
          registerId,
          registerName: ctx.register_name,
          staffName: staffMember.display_name,
          staffPin,
          productName: inStock.name,
          preparedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    console.log(`[e2e] Fixtures ready — register ${registerId}, staff ${staffMember.display_name}`);
  } catch (err) {
    console.warn(`[e2e] Fixture prep failed: ${err.message}`);
    writeFileSync(outPath, JSON.stringify({ prepared: false, error: err.message }, null, 2));
  }
}
