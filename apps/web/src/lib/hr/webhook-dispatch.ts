import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type HrWebhookClaimRow = {
  queue_id: string;
  organization_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  endpoint_id: string;
  url: string;
  secret: string | null;
  endpoint_name: string;
};

function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function dispatchHrWebhooks(
  admin: SupabaseClient,
  limit = 25
): Promise<{ sent: number; failed: number; claimed: number }> {
  const { data: claimedRaw, error: claimError } = await admin.rpc("claim_hr_webhook_batch", {
    p_limit: limit,
  });
  if (claimError) {
    throw new Error(claimError.message);
  }

  const items = (claimedRaw ?? []) as HrWebhookClaimRow[];
  let sent = 0;
  let failed = 0;

  for (const item of items) {
    const body = JSON.stringify({
      event: item.event_type,
      organization_id: item.organization_id,
      endpoint_id: item.endpoint_id,
      endpoint_name: item.endpoint_name,
      payload: item.payload ?? {},
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "NexusERP-HR-Webhook/1.0",
      "X-Nexus-Event": item.event_type,
    };

    if (item.secret?.trim()) {
      headers["X-Nexus-Signature"] = signPayload(item.secret.trim(), body);
    }

    let success = false;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(item.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        success = true;
      } else {
        const text = await response.text().catch(() => "");
        errorMessage = `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Request failed";
    }

    const { error: markError } = await admin.rpc("mark_hr_webhook_delivery", {
      p_queue_id: item.queue_id,
      p_success: success,
      p_error: errorMessage,
    });
    if (markError) {
      throw new Error(markError.message);
    }

    if (success) sent += 1;
    else failed += 1;
  }

  return { sent, failed, claimed: items.length };
}
