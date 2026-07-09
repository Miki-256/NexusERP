import { createClient } from "@/lib/supabase/server";
import type { NotificationEventType } from "./event-registry";

export type PublishNotificationInput = {
  organizationId: string;
  eventType: NotificationEventType | string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
};

/** Server-side publish — modules should prefer SQL enqueue inside RPCs when possible. */
export async function publishNotificationEvent(input: PublishNotificationInput): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enqueue_notification_event", {
    p_org_id: input.organizationId,
    p_event_type: input.eventType,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_payload: input.payload ?? {},
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    console.error("[notifications] enqueue failed:", error.message);
    return null;
  }

  return typeof data === "string" ? data : null;
}
