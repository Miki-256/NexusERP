import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { FailedClient } from "./failed-client";
import type { NotificationFailedRow } from "@/lib/notifications/types";

type DlqSummary = {
  failed: number;
  dead_letter: number;
  cancelled: number;
  oldest_failed_at: string | null;
};

export default async function CommunicationsFailedPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Manager access is required to manage failed deliveries.
      </div>
    );
  }

  const supabase = await createClient();
  const [listRes, sumRes] = await Promise.all([
    supabase.rpc("list_notification_failed_deliveries", {
      p_org_id: ctx.organization.id,
      p_limit: 50,
    }),
    supabase.rpc("notification_dlq_summary", {
      p_org_id: ctx.organization.id,
    }),
  ]);

  const summary: DlqSummary =
    sumRes.data && typeof sumRes.data === "object"
      ? (sumRes.data as DlqSummary)
      : { failed: 0, dead_letter: 0, cancelled: 0, oldest_failed_at: null };

  return (
    <FailedClient
      orgId={ctx.organization.id}
      rows={parseRpcJsonArray<NotificationFailedRow>(listRes.data)}
      summary={summary}
    />
  );
}
