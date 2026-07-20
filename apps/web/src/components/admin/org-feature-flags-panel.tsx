"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormCard } from "@/components/layout/form-card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { OrgFeatureFlagRow } from "@/lib/admin-types";

export function OrgFeatureFlagsPanel({
  organizationId,
  canWrite,
}: {
  organizationId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [flags, setFlags] = useState<OrgFeatureFlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_list_org_feature_flags", {
      p_org_id: organizationId,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Could not load flags", description: error.message, variant: "destructive" });
      return;
    }
    setFlags((data ?? []) as OrgFeatureFlagRow[]);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when org changes
  }, [organizationId]);

  async function setOverride(key: string, enabled: boolean) {
    setBusyKey(key);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_set_org_feature_flag", {
      p_org_id: organizationId,
      p_key: key,
      p_enabled: enabled,
    });
    setBusyKey(null);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    setFlags((data ?? []) as OrgFeatureFlagRow[]);
    toast({ title: enabled ? "Module enabled for tenant" : "Module disabled for tenant" });
    router.refresh();
  }

  async function clearOverride(key: string) {
    setBusyKey(`clear-${key}`);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_clear_org_feature_flag", {
      p_org_id: organizationId,
      p_key: key,
    });
    setBusyKey(null);
    if (error) {
      toast({ title: "Clear failed", description: error.message, variant: "destructive" });
      return;
    }
    setFlags((data ?? []) as OrgFeatureFlagRow[]);
    toast({ title: "Override cleared — using global default" });
    router.refresh();
  }

  return (
    <FormCard
      title="Module overrides"
      description="Per-tenant overrides of global feature flags. Effective access also respects the org plan."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No module flags defined.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {flags.map((flag) => (
            <li key={flag.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{flag.label}</p>
                {flag.description && (
                  <p className="text-sm text-muted-foreground">{flag.description}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Global: {flag.global_enabled ? "on" : "off"}
                  {" · "}
                  Effective:{" "}
                  <span className={flag.effective_enabled ? "text-emerald-700" : "text-amber-800"}>
                    {flag.effective_enabled ? "on" : "off"}
                  </span>
                  {flag.has_override ? " · override set" : " · using global"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canWrite && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant={flag.effective_enabled ? "outline" : "default"}
                      disabled={busyKey !== null}
                      onClick={() => void setOverride(flag.key, !flag.effective_enabled)}
                    >
                      {busyKey === flag.key
                        ? "…"
                        : flag.effective_enabled
                          ? "Disable for tenant"
                          : "Enable for tenant"}
                    </Button>
                    {flag.has_override && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyKey !== null}
                        onClick={() => void clearOverride(flag.key)}
                      >
                        {busyKey === `clear-${flag.key}` ? "…" : "Use global"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </FormCard>
  );
}
