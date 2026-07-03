"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import type { PlatformFeatureFlag } from "@/lib/admin-types";

export function FeaturesClient({
  flags,
  canManage,
}: {
  flags: PlatformFeatureFlag[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function toggle(key: string, enabled: boolean) {
    setBusyKey(key);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_set_feature_flag", {
      p_key: key,
      p_enabled: enabled,
    });
    setBusyKey(null);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: enabled ? "Module enabled" : "Module disabled" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {!canManage && (
        <p className="text-sm text-muted-foreground">
          Read-only. Only super admins can change feature flags.
        </p>
      )}

      <FormCard
        title="Global modules"
        description="Disabled modules are hidden from tenant navigation for all organizations."
      >
        <ul className="divide-y rounded-lg border">
          {flags.map((flag) => (
            <li key={flag.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium">{flag.label}</p>
                {flag.description && (
                  <p className="text-sm text-muted-foreground">{flag.description}</p>
                )}
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{flag.key}</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={
                    flag.enabled
                      ? "text-xs font-medium text-emerald-600"
                      : "text-xs font-medium text-muted-foreground"
                  }
                >
                  {flag.enabled ? "Enabled" : "Disabled"}
                </span>
                {canManage && (
                  <Button
                    size="sm"
                    variant={flag.enabled ? "outline" : "default"}
                    disabled={busyKey === flag.key}
                    onClick={() => toggle(flag.key, !flag.enabled)}
                  >
                    {busyKey === flag.key ? "Saving…" : flag.enabled ? "Disable" : "Enable"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </FormCard>
    </div>
  );
}
