import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dispatchSecurityAlerts } from "@/lib/security-alert-dispatch";
import { dispatchHrWebhooks } from "@/lib/hr/webhook-dispatch";
import { processNotificationPipeline } from "@/lib/notifications/worker";
import { runNotificationSchedules } from "@/lib/notifications/schedule-runner";

export type ProcessQueueResult = {
  ok: boolean;
  processed: unknown;
  ledger_posts: Record<string, unknown> | null;
  refund_ledger_posts: Record<string, unknown> | null;
  security_alerts: { sent: number; failed: number };
  hr_webhooks: { sent: number; failed: number; claimed: number };
  notifications: {
    processed: number;
    sent: number;
    failed: number;
    events_expanded: Record<string, unknown> | null;
  };
  scheduled_reports: { claimed: number; deliveries_created: number; errors: string[] };
  daily_sales_telegram: Record<string, unknown> | null;
  low_stock_scan: Record<string, unknown> | null;
  queue_backlog_scan: Record<string, unknown> | null;
  maintenance: Record<string, unknown> | null;
  summaries_refreshed: number | null;
  db_activity_log_pruned: number | null;
  sales_archived: number | null;
  queue_depth: { pending?: number; oldest_pending?: string } | null;
  stale_rollup_orgs: number | null;
  storage_orphans_removed: number;
  error?: string;
  security_alert_error?: string;
  hr_webhook_error?: string;
  notification_error?: string;
};

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Server not configured");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function recordHeartbeat(admin: SupabaseClient, result: ProcessQueueResult) {
  try {
    await admin.rpc("record_platform_ops_heartbeat", {
      p_key: "process_queue",
      p_result: {
        ok: result.ok,
        ledger_posts: result.ledger_posts,
        refund_ledger_posts: result.refund_ledger_posts,
        notifications: {
          processed: result.notifications.processed,
          sent: result.notifications.sent,
          failed: result.notifications.failed,
        },
        hr_webhooks: result.hr_webhooks,
        stale_rollup_orgs: result.stale_rollup_orgs,
        error: result.error ?? null,
      },
    });
  } catch {
    // Heartbeat is best-effort; do not fail the drain.
  }
}

/** Shared worker used by cron `/api/webhooks/process-queue` and Admin Health drain. */
export async function runProcessQueue(options?: {
  archiveSales?: boolean;
}): Promise<ProcessQueueResult> {
  const admin = serviceClient();

  const { data, error } = await admin.rpc("process_payment_webhook_queue", { p_limit: 50 });
  if (error) {
    const failed: ProcessQueueResult = {
      ok: false,
      processed: null,
      ledger_posts: null,
      refund_ledger_posts: null,
      security_alerts: { sent: 0, failed: 0 },
      hr_webhooks: { sent: 0, failed: 0, claimed: 0 },
      notifications: { processed: 0, sent: 0, failed: 0, events_expanded: null },
      scheduled_reports: { claimed: 0, deliveries_created: 0, errors: [] },
      daily_sales_telegram: null,
      low_stock_scan: null,
      queue_backlog_scan: null,
      maintenance: null,
      summaries_refreshed: null,
      db_activity_log_pruned: null,
      sales_archived: null,
      queue_depth: null,
      stale_rollup_orgs: null,
      storage_orphans_removed: 0,
      error: error.message,
    };
    await recordHeartbeat(admin, failed);
    return failed;
  }

  let ledgerPosts: Record<string, unknown> | null = null;
  const { data: ledgerData, error: ledgerError } = await admin.rpc("process_sale_ledger_post_queue", {
    p_limit: 200,
  });
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

  const maintenanceArgs =
    options?.archiveSales === undefined ? {} : { p_archive_sales: options.archiveSales };

  let maintenance: Record<string, unknown> | null = null;
  const { data: maintenanceData, error: maintenanceError } = await admin.rpc(
    "run_enterprise_maintenance",
    maintenanceArgs
  );
  if (!maintenanceError && maintenanceData && typeof maintenanceData === "object") {
    maintenance = maintenanceData as Record<string, unknown>;
  }

  const summariesRefreshed =
    typeof maintenance?.summaries_refreshed === "number"
      ? (maintenance.summaries_refreshed as number)
      : null;
  const prunedLogs =
    typeof maintenance?.db_activity_log_pruned === "number"
      ? (maintenance.db_activity_log_pruned as number)
      : null;
  const salesArchived =
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
  let securityAlertError: string | undefined;
  try {
    securityAlerts = await dispatchSecurityAlerts(admin);
  } catch (alertError) {
    securityAlertError =
      alertError instanceof Error ? alertError.message : "Security alert dispatch failed";
  }

  let hrWebhooks = { sent: 0, failed: 0, claimed: 0 };
  let hrWebhookError: string | undefined;
  try {
    hrWebhooks = await dispatchHrWebhooks(admin, 25);
  } catch (hrErr) {
    hrWebhookError = hrErr instanceof Error ? hrErr.message : "HR webhook dispatch failed";
  }

  let notifications = {
    processed: 0,
    sent: 0,
    failed: 0,
    events_expanded: null as Record<string, unknown> | null,
  };
  let notificationError: string | undefined;
  let lowStockScan: Record<string, unknown> | null = null;
  let dailySalesTelegram: Record<string, unknown> | null = null;
  let queueBacklogScan: Record<string, unknown> | null = null;

  const { data: dailySalesData } = await admin.rpc("enqueue_daily_sales_telegram_reports", {
    p_limit: 100,
  });
  if (dailySalesData && typeof dailySalesData === "object") {
    dailySalesTelegram = dailySalesData as Record<string, unknown>;
  }

  const { data: lowStockData } = await admin.rpc("scan_low_stock_notification_events", {
    p_limit: 100,
  });
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

  const schedules = { claimed: 0, deliveries_created: 0, errors: [] as string[] };
  try {
    const s = await runNotificationSchedules(admin, 20);
    Object.assign(schedules, s);
  } catch (scheduleError) {
    const message =
      scheduleError instanceof Error ? scheduleError.message : "Scheduled report runner failed";
    schedules.errors.push(message);
  }

  try {
    notifications = await processNotificationPipeline(admin, 50);
  } catch (notificationErr) {
    notificationError =
      notificationErr instanceof Error ? notificationErr.message : "Notification dispatch failed";
  }

  const result: ProcessQueueResult = {
    ok: !securityAlertError && !hrWebhookError && !notificationError,
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
    security_alert_error: securityAlertError,
    hr_webhook_error: hrWebhookError,
    notification_error: notificationError,
  };

  await recordHeartbeat(admin, result);
  return result;
}
