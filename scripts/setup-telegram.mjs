#!/usr/bin/env node
/**
 * One-shot Telegram setup: verify bot, discover chat ID, enable org channel + rules.
 * Reads TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from env.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../apps/web/.env.local");

function loadEnvFile(path) {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
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
  } catch {
    /* optional */
  }
}

loadEnvFile(envPath);

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}
if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function telegramApi(method, params = {}) {
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function main() {
  const me = await telegramApi("getMe");
  if (!me.ok) {
    console.error("Bot token invalid:", me.description);
    process.exit(1);
  }
  console.log(`Bot OK: @${me.result.username} (${me.result.first_name})`);

  const updates = await telegramApi("getUpdates", { limit: 50 });
  const chats = new Map();
  if (updates.ok && Array.isArray(updates.result)) {
    for (const u of updates.result) {
      const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
      if (chat?.id) {
        chats.set(String(chat.id), {
          id: String(chat.id),
          type: chat.type,
          title:
            chat.title ??
            ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username),
        });
      }
    }
  }

  let chatId = process.argv[2]?.trim();
  if (!chatId && chats.size === 1) {
    chatId = [...chats.values()][0].id;
  } else if (!chatId && chats.size > 1) {
    console.log("Multiple chats found — pass chat ID as first argument:");
    for (const c of chats.values()) {
      console.log(`  ${c.id}  (${c.type}) ${c.title ?? ""}`);
    }
    process.exit(2);
  } else if (!chatId) {
    console.log("No chats yet. Do this first:");
    console.log(`  1. Open Telegram and message @${me.result.username} (send /start)`);
    console.log("     OR add the bot to your manager group and send any message");
    console.log("  2. Re-run: node scripts/setup-telegram.mjs");
    process.exit(2);
  }

  console.log(`Using chat ID: ${chatId}`);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: orgs, error: orgErr } = await admin.from("organizations").select("id, name").order("created_at");
  if (orgErr) {
    console.error("Organizations query failed:", orgErr.message);
    if (orgErr.message.includes("get_notification_telegram")) {
      console.error("Run migration 00086 first (npm run db:push or apply via Supabase dashboard).");
    }
    process.exit(1);
  }

  if (!orgs?.length) {
    console.error("No organizations found");
    process.exit(1);
  }

  for (const org of orgs) {
    const { error: cfgErr } = await admin.from("notification_channel_configs").upsert(
      {
        organization_id: org.id,
        channel: "telegram",
        is_enabled: true,
        config: {
          provider: "telegram",
          default_chat_id: chatId,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,channel" }
    );

    if (cfgErr) {
      console.error(`Channel config failed for ${org.name}:`, cfgErr.message);
      if (cfgErr.message.includes("notification_channel_configs")) {
        console.error("Apply migration 20260618000086_notification_telegram_sprint3.sql first.");
      }
      continue;
    }

    const { error: rulesErr } = await admin
      .from("notification_rules")
      .update({ is_active: true })
      .eq("organization_id", org.id)
      .in("name", [
        "POS sale — Telegram group",
        "Low stock — Telegram group",
        "Daily sales report — Telegram",
      ]);

    if (rulesErr) {
      console.warn(`Rules update for ${org.name}:`, rulesErr.message);
    }

    console.log(`Configured: ${org.name} (${org.id})`);
  }

  const test = await telegramApi("sendMessage", {
    chat_id: chatId,
    text: "NexusERP Telegram notifications are connected. You will receive POS alerts and daily sales reports when rules are active.",
    disable_web_page_preview: true,
  });

  if (!test.ok) {
    console.error("Test message failed:", test.description);
    console.error("If group: ensure the bot was added and can post messages.");
    process.exit(1);
  }

  console.log("Test message sent successfully.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
