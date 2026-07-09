import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { AnalyticsClient } from "./analytics-client";
import type { NotificationCenterAnalytics } from "@/lib/notifications/types";

const EMPTY: NotificationCenterAnalytics = {
  days: 30,
  daily: [],
  by_channel: [],
  summary: { total_sent: 0, total_failed: 0, total: 0, delivery_rate_pct: 100 },
};

export default async function CommunicationsAnalyticsPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Manager access is required to view notification analytics.
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("notification_center_analytics", {
    p_org_id: ctx.organization.id,
    p_days: 30,
  });

  const analytics =
    data && typeof data === "object" ? (data as NotificationCenterAnalytics) : EMPTY;

  return <AnalyticsClient analytics={analytics} />;
}
