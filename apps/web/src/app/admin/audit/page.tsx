import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { PlatformAuditLog } from "@/lib/admin-types";
import { AuditLogClient } from "./audit-client";

export default async function AdminAuditPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_platform_audit_logs", {
    p_limit: 200,
    p_offset: 0,
  });

  const payload = (data ?? { total: 0, rows: [] }) as {
    total: number;
    rows: PlatformAuditLog[];
  };

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Platform audit log"
        description="Every super-admin and support action is recorded here for security and compliance."
      />
      <AuditLogClient logs={payload.rows ?? []} total={payload.total ?? 0} />
    </div>
  );
}
