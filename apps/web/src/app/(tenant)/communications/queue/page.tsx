import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { QueueClient } from "./queue-client";
import type { NotificationQueueRow } from "@/lib/notifications/types";

export default async function CommunicationsQueuePage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return <div className="p-6 text-sm text-muted-foreground">Manager access required.</div>;
  }

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const { data: dash } = await supabase.rpc("notification_center_dashboard", { p_org_id: orgId });
  const eventsPending =
    dash && typeof dash === "object" && "events_pending" in dash
      ? Number((dash as { events_pending?: number }).events_pending ?? 0)
      : 0;

  if (eventsPending > 0) {
    const { error: processError } = await supabase.rpc("process_notification_events_for_org", {
      p_org_id: orgId,
      p_limit: 50,
    });
    if (processError) {
      console.error("[communications/queue] process_notification_events_for_org:", processError.message);
    }
  }

  const { data, error } = await supabase.rpc("list_notification_queue", {
    p_org_id: orgId,
    p_status: null,
    p_limit: 50,
  });

  if (error) {
    return (
      <div className="space-y-2 p-6 text-sm">
        <p className="font-medium text-destructive">Could not load delivery queue</p>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <QueueClient
      orgId={orgId}
      rows={parseRpcJsonArray<NotificationQueueRow>(data)}
      initialEventsPending={eventsPending}
    />
  );
}
