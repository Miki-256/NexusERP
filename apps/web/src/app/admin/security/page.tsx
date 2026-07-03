import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { SecurityDashboard } from "@/lib/admin-types";
import { SecurityDashboardClient } from "./security-dashboard-client";

export default async function AdminSecurityPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_get_security_dashboard");

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Security"
        description="Monitor failed logins, suspended tenants, disabled accounts, and admin activity."
      />
      <SecurityDashboardClient data={(data ?? {}) as SecurityDashboard} />
    </div>
  );
}
