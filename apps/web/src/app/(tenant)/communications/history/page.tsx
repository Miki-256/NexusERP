import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { HistoryClient } from "./history-client";
import type { NotificationDeliveryHistoryRow } from "@/lib/notifications/types";

export default async function CommunicationsHistoryPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Manager access is required to view delivery history.
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("list_notification_delivery_history", {
    p_org_id: ctx.organization.id,
    p_limit: 50,
  });

  return <HistoryClient rows={parseRpcJsonArray<NotificationDeliveryHistoryRow>(data)} />;
}
