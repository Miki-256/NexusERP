import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { dispatchSecurityAlerts } from "@/lib/security-alert-dispatch";
import { dispatchHrWebhooks } from "@/lib/hr/webhook-dispatch";
import { processNotificationPipeline } from "@/lib/notifications/worker";
import { runNotificationSchedules } from "@/lib/notifications/schedule-runner";
import { verifyInternalSecret } from "@/lib/api/internal-auth";
import { resolveArchiveSales } from "@/lib/api/process-queue-options";

export const dynamic = "force-dynamic";

async function processQueue(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("process_payment_webhook_queue", { p_limit: 50 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let ledgerPosts: Record<string, unknown> | null = null;
  const { data: ledgerData, error: ledgerError } = await admin.rpc(
    "process_sale_ledger_post_queue",
    { p_limit: 200 }
  );
  if (!ledgerError && ledgerData && typeof ledgerData === "object") {
    ledgerPosts = ledgerData as Record<string, unknown>;
  }

  let refundLedgerPosts: Record<string, unknown> | null = null;
  const { data: refundLedgerData, error: refundLedgerError } = await admin.rpc(
    "process_refund_ledger_post_queue",
    { p_limit: 200 }
  );
  if (!refundLedgerError && refundLedgerData && typeof refundLedgerData === "object") {
    refundLedgerPosts = refundLedgerData as Record<string, unknown>;
  }

  const archiveSales = resolveArchiveSales(request);
  const maintenanceArgs =
    archiveSales === undefined ? {} : { p_archive_sales: archiveSales };

  let maintenance: Record<string, unknown> | null = null;
  const { data: maintenanceData, error: maintenanceError } = await admin.rpc(
    "run_enterprise_maintenance",
    maintenanceArgs
  );
  if (!maintenanceError && maintenanceData && typeof maintenanceData === "object") {
    maintenance = maintenanceData as Record<string, unknown>;
  }

  let summariesRefreshed: number | null =
    typeof maintenance?.summaries_refreshed === "number"
      ? (maintenance.summaries_refreshed as number)
      : null;
  let prunedLogs: number | null =
    typeof maintenance?.db_activity_log_pruned === "number"
      ? (maintenance.db_activity_log_pruned as number)
      : null;
  let salesArchived: number | null =
    typeof maintenance?.sales_archived === "number" ? (maintenance.sales_archived as number) : null;

  let queueDepth: { pending?: number; oldest_pending?: string } | null = null;
  const { data: depthData } = await admin.rpc("get_payment_webhook_queue_depth");
  if (depthData && typeof depthData === "object") {
    queueDepth = depthData as { pending?: number; oldest_pending?: string };
  }

  let staleRollupOrgs: number | null = null;
  const { data: staleData } = await admin.rpc("rollup_freshness_stale_orgs", {
    p_max_lag_days: 2,
  });
  if (Array.isArray(staleData)) {
    staleRollupOrgs = staleData.length;
  }

  let storageOrphansRemoved = 0;
  const { data: orphanData } = await admin.rpc("list_orphan_product_image_paths", { p_limit: 50 });
  const orphanPaths = (orphanData as { paths?: string[] } | null)?.paths ?? [];
  if (orphanPaths.length > 0) {
    const { error: removeError } = await admin.storage.from("product-images").remove(orphanPaths);
    if (!removeError) {
      storageOrphansRemoved = orphanPaths.length;
    }
  }

  let securityAlerts = { sent: 0, failed: 0 };
  try {
    securityAlerts = await dispatchSecurityAlerts(admin);
  } catch (alertError) {
    const message = alertError instanceof Error ? alertError.message : "Security alert dispatch failed";
    return NextResponse.json(
      { processed: data, security_alerts: securityAlerts, security_alert_error: message },
      { status: 500 }
    );
  }

  let hrWebhooks = { sent: 0, failed: 0, claimed: 0 };
  try {
    hrWebhooks = await dispatchHrWebhooks(admin, 25);
  } catch (hrWebhookError) {
    const message =
      hrWebhookError instanceof Error ? hrWebhookError.message : "HR webhook dispatch failed";
    return NextResponse.json(
      { processed: data, security_alerts: securityAlerts, hr_webhooks: hrWebhooks, hr_webhook_error: message },
      { status: 500 }
    );
  }

  let notifications = { processed: 0, sent: 0, failed: 0, events_expanded: null as Record<string, unknown> | null };
  let lowStockScan: Record<string, unknown> | null = null;
  let dailySalesTelegram: Record<string, unknown> | null = null;
  let queueBacklogScan: Record<string, unknown> | null = null;

  const { data: dailySalesData } = await admin.rpc("enqueue_daily_sales_telegram_reports", {
    p_limit: 100,
  });
  if (dailySalesData && typeof dailySalesData === "object") {
    dailySalesTelegram = dailySalesData as Record<string, unknown>;
  }

  const { data: lowStockData } = await admin.rpc("scan_low_stock_notification_events", { p_limit: 100 });
  if (lowStockData && typeof lowStockData === "object") {
    lowStockScan = lowStockData as Record<string, unknown>;
  }

  const { data: backlogData } = await admin.rpc("scan_notification_queue_backlog", {
    p_delivery_threshold: 50,
    p_event_threshold: 25,
  });
  if (backlogData && typeof backlogData === "object") {
    queueBacklogScan = backlogData as Record<string, unknown>;
  }

  let schedules = { claimed: 0, deliveries_created: 0, errors: [] as string[] };

  try {
    schedules = await runNotificationSchedules(admin, 20);
  } catch (scheduleError) {
    const message =
      scheduleError instanceof Error ? scheduleError.message : "Scheduled report runner failed";
    schedules.errors.push(message);
  }

  try {
    notifications = await processNotificationPipeline(admin, 50);
  } catch (notificationError) {
    const message =
      notificationError instanceof Error ? notificationError.message : "Notification dispatch failed";
    return NextResponse.json(
      {
        processed: data,
        security_alerts: securityAlerts,
        notifications,
        notification_error: message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    processed: data,
    ledger_posts: ledgerPosts,
    refund_ledger_posts: refundLedgerPosts,
    security_alerts: securityAlerts,
    hr_webhooks: hrWebhooks,
    notifications,
    scheduled_reports: schedules,
    daily_sales_telegram: dailySalesTelegram,
    low_stock_scan: lowStockScan,
    queue_backlog_scan: queueBacklogScan,
    maintenance,
    summaries_refreshed: summariesRefreshed,
    db_activity_log_pruned: prunedLogs,
    sales_archived: salesArchived,
    queue_depth: queueDepth,
    stale_rollup_orgs: staleRollupOrgs,
    storage_orphans_removed: storageOrphansRemoved,
  });
}

/** Vercel Cron invokes GET once daily on Hobby (see vercel.json). POST for manual triggers. */
export async function GET(request: Request) {
  if (!verifyInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processQueue(request);
}

export async function POST(request: Request) {
  if (!verifyInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processQueue(request);
}
