import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedDelivery } from "../types";

export async function deliverInApp(
  admin: SupabaseClient,
  delivery: ClaimedDelivery,
  eventType?: string | null,
  link?: string | null
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  if (delivery.recipient_type !== "user") {
    return { ok: false, error: "In-app channel requires user recipient" };
  }

  const userId = delivery.recipient_ref;

  const { data, error } = await admin
    .from("in_app_notifications")
    .insert({
      organization_id: delivery.organization_id,
      user_id: userId,
      delivery_id: delivery.id,
      event_type: eventType ?? null,
      title: delivery.subject ?? "Notification",
      body: delivery.body,
      link: link ?? null,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, messageId: data.id as string };
}
