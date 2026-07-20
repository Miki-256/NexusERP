import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { OpsSloSettings, PlatformSettings } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { SettingsClient } from "./settings-client";

const DEFAULTS: PlatformSettings = {
  broadcast_banner: { enabled: false, message: "", variant: "info" },
  maintenance_mode: {
    enabled: false,
    message: "Nexus ERP is temporarily unavailable for maintenance.",
    block_signup: true,
  },
  dual_control: {
    enabled: true,
    actions: ["org.suspend", "org.export", "org.offboard"],
    solo_admin_bypass: true,
  },
};

const DEFAULT_OPS_SLO: OpsSloSettings = {
  enabled: false,
  webhook_url: "",
  notify_slack: true,
  cooldown_minutes: 60,
  thresholds: {
    ledger_queue_pending: 50,
    ledger_queue_failed: 1,
    payment_webhook_pending: 20,
    unposted_completed_sales: 100,
    notification_deliveries_failed: 20,
    heartbeat_stale_minutes: 15,
  },
};

export default async function AdminSettingsPage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const [{ data }, { data: opsSloRaw }] = await Promise.all([
    supabase.rpc("admin_get_platform_settings"),
    supabase.rpc("admin_get_ops_slo_settings"),
  ]);
  const raw = (data ?? {}) as Partial<PlatformSettings>;
  const opsRaw = (opsSloRaw ?? {}) as Partial<OpsSloSettings>;

  const settings: PlatformSettings = {
    broadcast_banner: { ...DEFAULTS.broadcast_banner, ...raw.broadcast_banner },
    maintenance_mode: { ...DEFAULTS.maintenance_mode, ...raw.maintenance_mode },
    dual_control: {
      ...DEFAULTS.dual_control!,
      ...raw.dual_control,
      actions: raw.dual_control?.actions ?? DEFAULTS.dual_control!.actions,
    },
  };

  const opsSlo: OpsSloSettings = {
    ...DEFAULT_OPS_SLO,
    ...opsRaw,
    thresholds: { ...DEFAULT_OPS_SLO.thresholds, ...opsRaw.thresholds },
  };

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Platform settings"
        description="Broadcast, maintenance, dual-control governance, and ops SLO webhooks."
      />
      <SettingsClient
        settings={settings}
        opsSlo={opsSlo}
        canWrite={!!ctx?.canWrite}
        canManageMaintenance={!!ctx?.canManageAdmins}
      />
    </div>
  );
}
