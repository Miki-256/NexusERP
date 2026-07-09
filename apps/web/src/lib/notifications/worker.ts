import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverEmail } from "./channels/email";
import { deliverInApp } from "./channels/in-app";
import { deliverTelegram } from "./channels/telegram";
import { deliverWhatsApp } from "./channels/whatsapp";
import type { ClaimedDelivery } from "./types";

export type NotificationWorkerResult = {
  processed: number;
  sent: number;
  failed: number;
  events_expanded: Record<string, unknown> | null;
};

function resolveBatchSize(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return Math.max(1, Math.min(override, 200));
  }
  const fromEnv = Number(process.env.NOTIFICATION_BATCH_SIZE ?? 50);
  return Math.max(1, Math.min(Number.isFinite(fromEnv) ? fromEnv : 50, 200));
}

export async function processNotificationPipeline(
  admin: SupabaseClient,
  batchSize?: number
): Promise<NotificationWorkerResult> {
  let sent = 0;
  let failed = 0;
  const limit = resolveBatchSize(batchSize);

  const { data: expandData } = await admin.rpc("process_notification_events", {
    p_limit: limit,
  });

  const { data: claimedRaw, error: claimError } = await admin.rpc("claim_notification_deliveries", {
    p_limit: limit,
  });

  if (claimError) {
    throw new Error(claimError.message);
  }

  const deliveries = (claimedRaw ?? []) as ClaimedDelivery[];

  for (const delivery of deliveries) {
    try {
      const meta = await fetchEventMeta(admin, delivery.event_id);

      if (delivery.channel === "in_app") {
        const result = await deliverInApp(admin, delivery, meta.eventType, meta.link);
        if (!result.ok) {
          await completeDelivery(admin, delivery.id, "failed", null, null, result.error);
          failed += 1;
          continue;
        }
        await completeDelivery(admin, delivery.id, "sent", result.messageId, { channel: "in_app" }, null);
        sent += 1;
        continue;
      }

      if (delivery.channel === "email") {
        const result = await deliverEmail(admin, delivery);
        if (!result.ok) {
          await completeDelivery(admin, delivery.id, "failed", null, null, result.error);
          failed += 1;
          continue;
        }
        await completeDelivery(
          admin,
          delivery.id,
          "sent",
          result.messageId,
          { channel: "email", provider: "resend" },
          null
        );
        if (meta.eventType === "accounting.invoice_reminder" && meta.payload?.invoice_id) {
          await admin.rpc("log_invoice_reminder", {
            p_invoice_id: meta.payload.invoice_id as string,
          });
        }
        sent += 1;
        continue;
      }

      if (delivery.channel === "telegram") {
        const result = await deliverTelegram(admin, delivery);
        if (!result.ok) {
          await completeDelivery(admin, delivery.id, "failed", null, null, result.error);
          failed += 1;
          continue;
        }
        await completeDelivery(
          admin,
          delivery.id,
          "sent",
          result.messageId,
          { channel: "telegram", provider: "telegram_bot_api" },
          null
        );
        sent += 1;
        continue;
      }

      if (delivery.channel === "whatsapp") {
        const result = await deliverWhatsApp(admin, delivery);
        if (!result.ok) {
          await completeDelivery(admin, delivery.id, "failed", null, null, result.error);
          failed += 1;
          continue;
        }
        await completeDelivery(
          admin,
          delivery.id,
          "sent",
          result.messageId,
          { channel: "whatsapp", provider: "meta_cloud_api" },
          null
        );
        sent += 1;
        continue;
      }

      await completeDelivery(
        admin,
        delivery.id,
        "failed",
        null,
        null,
        `Channel ${delivery.channel} not configured`
      );
      failed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delivery failed";
      await completeDelivery(admin, delivery.id, "failed", null, null, message);
      failed += 1;
    }
  }

  return {
    processed: deliveries.length,
    sent,
    failed,
    events_expanded: (expandData as Record<string, unknown>) ?? null,
  };
}

async function fetchEventMeta(
  admin: SupabaseClient,
  eventId: string
): Promise<{
  eventType: string | null;
  link: string | null;
  payload: Record<string, unknown> | null;
}> {
  const { data } = await admin
    .from("notification_events")
    .select("event_type, payload")
    .eq("id", eventId)
    .maybeSingle();
  const row = data as { event_type?: string; payload?: Record<string, unknown> } | null;
  return {
    eventType: row?.event_type ?? null,
    link: (row?.payload?.link as string | undefined) ?? null,
    payload: row?.payload ?? null,
  };
}

async function completeDelivery(
  admin: SupabaseClient,
  id: string,
  status: "sent" | "failed" | "delivered",
  providerMessageId: string | null,
  providerResponse: Record<string, unknown> | null,
  error: string | null
) {
  await admin.rpc("complete_notification_delivery", {
    p_delivery_id: id,
    p_status: status,
    p_provider_message_id: providerMessageId,
    p_provider_response: providerResponse,
    p_error: error,
  });
}
