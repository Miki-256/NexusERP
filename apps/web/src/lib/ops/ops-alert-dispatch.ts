import type { SupabaseClient } from "@supabase/supabase-js";

type OpsAlertRow = {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type OpsSloSettings = {
  enabled: boolean;
  webhook_url: string;
  notify_slack: boolean;
};

export async function dispatchOpsSloAlerts(
  admin: SupabaseClient
): Promise<{ evaluated: boolean; enqueued: number; sent: number; failed: number }> {
  const { data: settingsRaw } = await admin.rpc("admin_get_ops_slo_settings_internal", {});
  const settings = (settingsRaw ?? {
    enabled: false,
    webhook_url: "",
    notify_slack: true,
  }) as OpsSloSettings;

  if (!settings.enabled) {
    return { evaluated: false, enqueued: 0, sent: 0, failed: 0 };
  }

  const { data: evalRaw, error: evalError } = await admin.rpc("admin_evaluate_ops_slos");
  if (evalError) {
    throw new Error(evalError.message);
  }
  const enqueued = Number((evalRaw as { enqueued?: number } | null)?.enqueued ?? 0);

  if (!settings.webhook_url?.trim()) {
    return { evaluated: true, enqueued, sent: 0, failed: 0 };
  }

  const { data: claimedRaw, error: claimError } = await admin.rpc("admin_claim_ops_alerts", {
    p_limit: 20,
  });
  if (claimError) {
    throw new Error(claimError.message);
  }

  const alerts = (claimedRaw ?? []) as OpsAlertRow[];
  let sent = 0;
  let failed = 0;

  for (const alert of alerts) {
    const text = `[Nexus ERP][${alert.severity}] ${alert.title}: ${alert.detail}`;
    const body = settings.notify_slack
      ? JSON.stringify({ text })
      : JSON.stringify({
          source: "nexus-erp",
          kind: "ops_slo",
          alert_type: alert.alert_type,
          severity: alert.severity,
          title: alert.title,
          detail: alert.detail,
          message: text,
          payload: alert.payload,
          created_at: alert.created_at,
        });

    try {
      const res = await fetch(settings.webhook_url.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        failed += 1;
        await admin.rpc("admin_complete_ops_alert", {
          p_alert_id: alert.id,
          p_status: "failed",
          p_error: `HTTP ${res.status}`,
        });
        continue;
      }
      sent += 1;
      await admin.rpc("admin_complete_ops_alert", {
        p_alert_id: alert.id,
        p_status: "sent",
        p_error: null,
      });
    } catch (err) {
      failed += 1;
      await admin.rpc("admin_complete_ops_alert", {
        p_alert_id: alert.id,
        p_status: "failed",
        p_error: err instanceof Error ? err.message : "Delivery failed",
      });
    }
  }

  return { evaluated: true, enqueued, sent, failed };
}
