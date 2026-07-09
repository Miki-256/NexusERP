import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { CommunicationsClient } from "./communications-client";
import type {
  NotificationCenterAnalytics,
  NotificationCenterDashboard,
} from "@/lib/notifications/types";

export default async function CommunicationsPage() {
  const ctx = await requireAppAccess("communications");
  const supabase = await createClient();

  let stats: NotificationCenterDashboard = {
    sent_today: 0,
    queued: 0,
    failed: 0,
    events_pending: 0,
    delivery_rate_pct: 100,
    channel_breakdown: [],
  };

  let analytics: NotificationCenterAnalytics | null = null;

  if (ctx.canManageCommunications) {
    const [dashRes, analyticsRes] = await Promise.all([
      supabase.rpc("notification_center_dashboard", { p_org_id: ctx.organization.id }),
      supabase.rpc("notification_center_analytics", {
        p_org_id: ctx.organization.id,
        p_days: 30,
      }),
    ]);

    if (dashRes.data && typeof dashRes.data === "object") {
      stats = dashRes.data as NotificationCenterDashboard;
    }
    if (analyticsRes.data && typeof analyticsRes.data === "object") {
      analytics = analyticsRes.data as NotificationCenterAnalytics;
    }
  }

  return (
    <CommunicationsClient
      stats={stats}
      analytics={analytics}
      canManage={ctx.canManageCommunications}
    />
  );
}
