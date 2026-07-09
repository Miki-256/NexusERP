import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { SchedulesClient } from "./schedules-client";
import type { NotificationScheduleRow } from "@/lib/notifications/types";

export default async function CommunicationsSchedulesPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return <div className="p-6 text-sm text-muted-foreground">Manager access required.</div>;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_notification_schedules", {
    p_org_id: ctx.organization.id,
  });

  if (error) {
    return (
      <div className="space-y-2 p-6 text-sm">
        <p className="font-medium text-destructive">Could not load schedules</p>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <SchedulesClient
      orgId={ctx.organization.id}
      orgTimezone={ctx.organization.timezone?.trim() || "Africa/Addis_Ababa"}
      schedules={parseRpcJsonArray<NotificationScheduleRow>(data)}
    />
  );
}
