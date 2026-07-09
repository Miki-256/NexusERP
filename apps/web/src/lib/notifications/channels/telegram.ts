import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedDelivery } from "../types";

export type TelegramDeliveryResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

type TelegramChannelConfig = {
  is_enabled?: boolean;
  bot_token?: string | null;
  default_chat_id?: string | null;
};

function telegramEnabled(): boolean {
  const flag = process.env.NOTIFICATION_TELEGRAM_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return true;
}

export async function deliverTelegram(
  admin: SupabaseClient,
  delivery: ClaimedDelivery
): Promise<TelegramDeliveryResult> {
  if (!telegramEnabled()) {
    return { ok: false, error: "Telegram channel disabled (NOTIFICATION_TELEGRAM_ENABLED)" };
  }

  const { data: configRaw, error: configError } = await admin.rpc(
    "get_notification_telegram_config_internal",
    { p_org_id: delivery.organization_id }
  );
  if (configError) {
    return { ok: false, error: configError.message };
  }

  const config = (configRaw ?? {}) as TelegramChannelConfig;
  if (!config.is_enabled) {
    return { ok: false, error: "Telegram channel is disabled for this organization" };
  }

  const { data: deliveryRow } = await admin
    .from("notification_deliveries")
    .select("attachments")
    .eq("id", delivery.id)
    .maybeSingle();

  const attachments = (deliveryRow as {
    attachments?: { url?: string; filename?: string; type?: string; mime_type?: string }[];
  } | null)?.attachments;
  const document = Array.isArray(attachments)
    ? attachments.find((a) => a?.url && (a.type === "document" || a.filename || a.mime_type))
    : undefined;

  const token = config.bot_token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: "No bot token configured (org channel settings or TELEGRAM_BOT_TOKEN)",
    };
  }

  const text = delivery.subject
    ? `${delivery.subject}\n\n${delivery.body}`
    : delivery.body;

  if (document?.url) {
    const docResponse = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: delivery.recipient_ref,
        document: document.url,
        caption: text.slice(0, 1024),
      }),
    });
    const docPayload = (await docResponse.json()) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (docResponse.ok && docPayload.ok) {
      return { ok: true, messageId: String(docPayload.result?.message_id ?? "sent") };
    }
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: delivery.recipient_ref,
      text,
      disable_web_page_preview: true,
    }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };

  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      error: payload.description ?? `Telegram API error (${response.status})`,
    };
  }

  return {
    ok: true,
    messageId: String(payload.result?.message_id ?? "sent"),
  };
}
