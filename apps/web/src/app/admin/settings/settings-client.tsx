"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import type { DualControlSettings, PlatformSettings } from "@/lib/admin-types";

const DEFAULT_DUAL: DualControlSettings = {
  enabled: true,
  actions: ["org.suspend", "org.export"],
  solo_admin_bypass: true,
};

export function SettingsClient({
  settings,
  canWrite,
  canManageMaintenance,
}: {
  settings: PlatformSettings;
  canWrite: boolean;
  canManageMaintenance: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [banner, setBanner] = useState(settings.broadcast_banner);
  const [maintenance, setMaintenance] = useState(settings.maintenance_mode);
  const [dual, setDual] = useState<DualControlSettings>(settings.dual_control ?? DEFAULT_DUAL);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const payload: Record<string, unknown> = {};
    if (canWrite) payload.broadcast_banner = banner;
    if (canManageMaintenance) {
      payload.maintenance_mode = maintenance;
      payload.dual_control = dual;
    }

    const { error } = await supabase.rpc("admin_set_platform_settings", {
      p_settings: payload,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Settings saved" });
    router.refresh();
  }

  function toggleAction(action: string, on: boolean) {
    const actions = new Set(dual.actions);
    if (on) actions.add(action);
    else actions.delete(action);
    setDual({ ...dual, actions: Array.from(actions) });
  }

  return (
    <div className="space-y-6">
      <FormCard
        title="Broadcast banner"
        description="Shows a message bar at the top of the ERP for all logged-in users."
      >
        {!canWrite && (
          <p className="mb-4 text-sm text-muted-foreground">Read-only — requires App Support or Super Admin.</p>
        )}
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={banner.enabled}
              disabled={!canWrite}
              onChange={(e) => setBanner({ ...banner, enabled: e.target.checked })}
            />
            Enable broadcast banner
          </label>
          <div className="space-y-2">
            <Label htmlFor="bannerMessage">Message</Label>
            <Input
              id="bannerMessage"
              value={banner.message}
              disabled={!canWrite}
              onChange={(e) => setBanner({ ...banner, message: e.target.value })}
              placeholder="Scheduled maintenance tonight at 10 PM…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bannerVariant">Variant</Label>
            <select
              id="bannerVariant"
              className="h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
              value={banner.variant}
              disabled={!canWrite}
              onChange={(e) =>
                setBanner({ ...banner, variant: e.target.value as PlatformSettings["broadcast_banner"]["variant"] })
              }
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
      </FormCard>

      <FormCard
        title="Maintenance mode"
        description="Blocks ERP access for regular users. Platform admins can still use /admin."
      >
        {!canManageMaintenance && (
          <p className="mb-4 text-sm text-muted-foreground">Only Super Admins can toggle maintenance mode.</p>
        )}
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={maintenance.enabled}
              disabled={!canManageMaintenance}
              onChange={(e) => setMaintenance({ ...maintenance, enabled: e.target.checked })}
            />
            Enable maintenance mode
          </label>
          <div className="space-y-2">
            <Label htmlFor="maintMessage">Message</Label>
            <Input
              id="maintMessage"
              value={maintenance.message}
              disabled={!canManageMaintenance}
              onChange={(e) => setMaintenance({ ...maintenance, message: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={maintenance.block_signup}
              disabled={!canManageMaintenance}
              onChange={(e) => setMaintenance({ ...maintenance, block_signup: e.target.checked })}
            />
            Block new signups during maintenance
          </label>
        </div>
      </FormCard>

      <FormCard
        title="Dual control"
        description="Require a second write admin to approve suspend and org export. Solo-admin bypass keeps a single operator unblocked."
      >
        {!canManageMaintenance && (
          <p className="mb-4 text-sm text-muted-foreground">Only Super Admins can change dual-control settings.</p>
        )}
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={dual.enabled}
              disabled={!canManageMaintenance}
              onChange={(e) => setDual({ ...dual, enabled: e.target.checked })}
            />
            Enable dual control
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={dual.solo_admin_bypass}
              disabled={!canManageMaintenance}
              onChange={(e) => setDual({ ...dual, solo_admin_bypass: e.target.checked })}
            />
            Bypass when only one write admin exists
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={dual.actions.includes("org.suspend")}
              disabled={!canManageMaintenance}
              onChange={(e) => toggleAction("org.suspend", e.target.checked)}
            />
            Require approval for suspend
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={dual.actions.includes("org.export")}
              disabled={!canManageMaintenance}
              onChange={(e) => toggleAction("org.export", e.target.checked)}
            />
            Require approval for org export
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={dual.actions.includes("org.offboard")}
              disabled={!canManageMaintenance}
              onChange={(e) => toggleAction("org.offboard", e.target.checked)}
            />
            Require approval for offboard
          </label>
          <p className="text-xs text-muted-foreground">
            Pending requests appear under <Link href="/admin/approvals" className="text-primary hover:underline">Approvals</Link>.
          </p>
        </div>
      </FormCard>

      {(canWrite || canManageMaintenance) && (
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      )}

      <Button variant="outline" size="sm" asChild>
        <Link href="/admin">← Overview</Link>
      </Button>
    </div>
  );
}
