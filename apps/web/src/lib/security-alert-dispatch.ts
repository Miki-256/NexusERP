import type { SupabaseClient } from "@supabase/supabase-js";

type SecurityAlertRow = {
  id: string;
  alert_type: string;
  lockout_type: string;
  identifier: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type AlertSettings = {
  enabled: boolean;
  webhook_url: string;
  notify_slack: boolean;
};

function formatAlertMessage(alert: SecurityAlertRow): string {
  const payload = alert.payload ?? {};
  const until = payload.locked_until
    ? new Date(String(payload.locked_until)).toLocaleString()
    : "unknown";

  if (alert.alert_type === "login_blocked") {
    const email = payload.email ? ` · ${payload.email}` : "";
    const ip = payload.ip_address ? ` · IP ${payload.ip_address}` : "";
    return `[Nexus ERP] Login locked (${alert.lockout_type})${email}${ip} until ${until}`;
  }

  if (alert.alert_type === "pos_manager_pin_locked") {
    return `[Nexus ERP] Manager PIN locked on register ${alert.identifier} until ${until}`;
  }

  return `[Nexus ERP] Security alert: ${alert.alert_type} (${alert.lockout_type}: ${alert.identifier})`;
}

export async function dispatchSecurityAlerts(admin: SupabaseClient): Promise<{ sent: number; failed: number }> {
  const { data: settingsRaw } = await admin.rpc("admin_get_security_alert_settings_internal", {});
  const settings = (settingsRaw ?? {
    enabled: false,
    webhook_url: "",
    notify_slack: true,
  }) as AlertSettings;

  if (!settings.enabled || !settings.webhook_url?.trim()) {
    return { sent: 0, failed: 0 };
  }

  const { data: claimedRaw, error: claimError } = await admin.rpc("admin_claim_security_alerts", {
    p_limit: 20,
  });
  if (claimError) {
    throw new Error(claimError.message);
  }

  const alerts = (claimedRaw ?? []) as SecurityAlertRow[];
  let sent = 0;
  let failed = 0;

  for (const alert of alerts) {
    const text = formatAlertMessage(alert);
    const body = settings.notify_slack
      ? JSON.stringify({ text })
      : JSON.stringify({
          source: "nexus-erp",
          alert_type: alert.alert_type,
          lockout_type: alert.lockout_type,
          identifier: alert.identifier,
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
        await admin.rpc("admin_complete_security_alert", {
          p_alert_id: alert.id,
          p_status: "failed",
          p_error: `HTTP ${res.status}`,
        });
        continue;
      }
      sent += 1;
      await admin.rpc("admin_complete_security_alert", {
        p_alert_id: alert.id,
        p_status: "sent",
        p_error: null,
      });
    } catch (err) {
      failed += 1;
      await admin.rpc("admin_complete_security_alert", {
        p_alert_id: alert.id,
        p_status: "failed",
        p_error: err instanceof Error ? err.message : "Delivery failed",
      });
    }
  }

  return { sent, failed };
}
