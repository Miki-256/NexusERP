import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { PlatformHealth } from "@/lib/admin-types";
import { probePlatformDependencies, type PlatformDependencyProbe } from "@/lib/ops/platform-deps";
import { HealthClient } from "./health-client";

export type SecurityPulse = {
  security_events_24h: number;
  security_events_7d: number;
  platform_audit_24h: number;
};

export default async function AdminHealthPage() {
  const supabase = await createClient();
  const [{ data }, { data: roleData }, { data: pulseData }] = await Promise.all([
    supabase.rpc("admin_get_platform_health"),
    supabase.rpc("admin_my_role"),
    supabase.rpc("admin_platform_security_pulse"),
  ]);

  const role = roleData as { can_write?: boolean } | null;
  const deps = probePlatformDependencies();
  const securityPulse = (pulseData ?? {
    security_events_24h: 0,
    security_events_7d: 0,
    platform_audit_24h: 0,
  }) as SecurityPulse;

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Platform health"
        description="Queues, cron heartbeat, dependencies, security pulse, and one-click drain for background workers."
      />
      <HealthClient
        data={(data ?? {}) as PlatformHealth}
        canWrite={Boolean(role?.can_write)}
        dependencies={deps as PlatformDependencyProbe[]}
        securityPulse={securityPulse}
      />
    </div>
  );
}
