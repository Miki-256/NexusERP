import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { RulesClient } from "./rules-client";
import type { NotificationRuleRow } from "@/lib/notifications/types";

export default async function CommunicationsRulesPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return <div className="p-6 text-sm text-muted-foreground">Manager access required.</div>;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_notification_rules", {
    p_org_id: ctx.organization.id,
  });

  if (error) {
    return (
      <div className="space-y-2 p-6 text-sm">
        <p className="font-medium text-destructive">Could not load notification rules</p>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <RulesClient
      orgId={ctx.organization.id}
      rules={parseRpcJsonArray<NotificationRuleRow>(data)}
    />
  );
}
