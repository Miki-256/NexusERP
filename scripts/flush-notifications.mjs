#!/usr/bin/env node
/** Process pending notification events + deliver Telegram/email/in-app (run after migration 00087). */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../apps/web/.env.local");

function loadEnv(path) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv(envPath);

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function deliverInApp(delivery) {
  const { data: event } = await admin
    .from("notification_events")
    .select("event_type, payload")
    .eq("id", delivery.event_id)
    .maybeSingle();
  const { data, error } = await admin.from("in_app_notifications").insert({
    organization_id: delivery.organization_id,
    user_id: delivery.recipient_ref,
    delivery_id: delivery.id,
    event_type: event?.event_type ?? null,
    title: delivery.subject ?? "Notification",
    body: delivery.body,
    link: event?.payload?.link ?? null,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, messageId: data.id };
}

async function deliverTelegram(delivery) {
  const { data: configRaw } = await admin.rpc("get_notification_telegram_config_internal", {
    p_org_id: delivery.organization_id,
  });
  const config = configRaw ?? {};
  const token = config.bot_token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "No bot token" };
  const text = delivery.subject ? `${delivery.subject}\n\n${delivery.body}` : delivery.body;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: delivery.recipient_ref,
      text,
      disable_web_page_preview: true,
    }),
  });
  const payload = await res.json();
  if (!res.ok || !payload.ok) {
    return { ok: false, error: payload.description ?? `HTTP ${res.status}` };
  }
  return { ok: true, messageId: String(payload.result?.message_id ?? "sent") };
}

async function completeDelivery(id, status, messageId, error) {
  await admin.rpc("complete_notification_delivery", {
    p_delivery_id: id,
    p_status: status,
    p_provider_message_id: messageId,
    p_provider_response: status === "sent" ? { channel: "telegram" } : null,
    p_error: error,
  });
}

const { error: probeErr } = await admin.rpc("process_notification_events", { p_limit: 1 });
if (probeErr?.message?.includes("cannot cast type record")) {
  console.error(
    "Apply migration 00087 first: supabase/migrations/20260618000087_notification_rules_event_id_fix.sql"
  );
  process.exit(1);
}

let sent = 0;
let failed = 0;

for (let batch = 0; batch < 5; batch += 1) {
  const { data: expand } = await admin.rpc("process_notification_events", { p_limit: 50 });
  const expanded = expand?.events_processed ?? 0;
  const { data: claimed } = await admin.rpc("claim_notification_deliveries", { p_limit: 50 });
  const deliveries = claimed ?? [];
  if (expanded === 0 && deliveries.length === 0) break;

  for (const delivery of deliveries) {
    if (delivery.channel === "telegram") {
      const result = await deliverTelegram(delivery);
      if (result.ok) {
        await completeDelivery(delivery.id, "sent", result.messageId, null);
        sent += 1;
      } else {
        await completeDelivery(delivery.id, "failed", null, result.error);
        failed += 1;
      }
    } else if (delivery.channel === "in_app") {
      const result = await deliverInApp(delivery);
      if (result.ok) {
        await completeDelivery(delivery.id, "sent", result.messageId, null);
        sent += 1;
      } else {
        await completeDelivery(delivery.id, "failed", null, result.error);
        failed += 1;
      }
    } else {
      await completeDelivery(delivery.id, "failed", null, `Channel ${delivery.channel} — run app worker`);
      failed += 1;
    }
  }
  console.log(`batch ${batch + 1}: events=${expanded} deliveries=${deliveries.length}`);
}

console.log({ sent, failed });
