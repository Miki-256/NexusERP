import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { AuthLockout, AuthPolicies, SecurityAlertSettings } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { AuthThrottleClient } from "./auth-throttle-client";

const DEFAULT_POLICIES: AuthPolicies = {
  id: "default",
  max_login_failures_email: 5,
  login_lockout_minutes: 15,
  login_failure_window_minutes: 15,
  max_login_failures_ip: 30,
  max_pin_failures: 5,
  pin_lockout_minutes: 15,
  max_manager_pin_failures_register: 5,
  updated_at: new Date(0).toISOString(),
};

const DEFAULT_ALERTS: SecurityAlertSettings = {
  enabled: false,
  webhook_url: "",
  notify_slack: true,
};

export default async function AdminAuthThrottlePage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();

  const [policiesRes, alertsRes, lockoutsRes] = await Promise.all([
    supabase.rpc("admin_get_auth_policies"),
    supabase.rpc("admin_get_auth_security_settings"),
    supabase.rpc("admin_list_auth_lockouts", { p_limit: 50, p_active_only: false }),
  ]);

  const policies = { ...DEFAULT_POLICIES, ...((policiesRes.data ?? {}) as Partial<AuthPolicies>) };
  const alertSettings = { ...DEFAULT_ALERTS, ...((alertsRes.data ?? {}) as Partial<SecurityAlertSettings>) };
  const lockouts = (lockoutsRes.data ?? []) as AuthLockout[];

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Auth throttling"
        description="Configure login and PIN lockout limits, webhook alerts, and clear active lockouts."
        action={
          <Link href="/admin/security" className="text-sm text-primary hover:underline">
            ← Security overview
          </Link>
        }
      />
      <AuthThrottleClient
        policies={policies}
        alertSettings={alertSettings}
        lockouts={lockouts}
        canWrite={!!ctx?.canWrite}
      />
    </div>
  );
}
