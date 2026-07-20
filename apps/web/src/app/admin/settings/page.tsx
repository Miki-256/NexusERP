import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { PlatformSettings } from "@/lib/admin-types";
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
    actions: ["org.suspend", "org.export"],
    solo_admin_bypass: true,
  },
};

export default async function AdminSettingsPage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_get_platform_settings");
  const raw = (data ?? {}) as Partial<PlatformSettings>;

  const settings: PlatformSettings = {
    broadcast_banner: { ...DEFAULTS.broadcast_banner, ...raw.broadcast_banner },
    maintenance_mode: { ...DEFAULTS.maintenance_mode, ...raw.maintenance_mode },
    dual_control: {
      ...DEFAULTS.dual_control!,
      ...raw.dual_control,
      actions: raw.dual_control?.actions ?? DEFAULTS.dual_control!.actions,
    },
  };

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Platform settings"
        description="Broadcast messages, maintenance mode, and dual-control governance."
      />
      <SettingsClient
        settings={settings}
        canWrite={!!ctx?.canWrite}
        canManageMaintenance={!!ctx?.canManageAdmins}
      />
    </div>
  );
}
