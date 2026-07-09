import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { AuditClient } from "./audit-client";
import type { NotificationAuditLogRow } from "@/lib/notifications/types";

export default async function CommunicationsAuditPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Manager access is required to view the audit log.
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("list_notification_audit_log", {
    p_org_id: ctx.organization.id,
    p_limit: 50,
  });

  return <AuditClient rows={parseRpcJsonArray<NotificationAuditLogRow>(data)} />;
}
