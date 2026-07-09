import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { GroupsClient } from "./groups-client";
import type { NotificationRecipientGroupRow } from "@/lib/notifications/types";

export default async function CommunicationsGroupsPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return <div className="p-6 text-sm text-muted-foreground">Manager access required.</div>;
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("list_notification_recipient_groups", {
    p_org_id: ctx.organization.id,
  });

  return (
    <GroupsClient orgId={ctx.organization.id} groups={parseRpcJsonArray<NotificationRecipientGroupRow>(data)} />
  );
}
