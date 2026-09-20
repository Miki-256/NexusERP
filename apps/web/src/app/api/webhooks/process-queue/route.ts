import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/api/internal-auth";
import { resolveArchiveSales } from "@/lib/api/process-queue-options";
import { runProcessQueue } from "@/lib/ops/run-process-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function processQueue(request: Request) {
  try {
    const archiveSales = resolveArchiveSales(request);
    const result = await runProcessQueue(
      archiveSales === undefined ? undefined : { archiveSales }
    );

    if (result.error && !result.processed) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (result.security_alert_error) {
      return NextResponse.json(
        {
          processed: result.processed,
          security_alerts: result.security_alerts,
          security_alert_error: result.security_alert_error,
        },
        { status: 500 }
      );
    }

    if (result.hr_webhook_error) {
      return NextResponse.json(
        {
          processed: result.processed,
          security_alerts: result.security_alerts,
          hr_webhooks: result.hr_webhooks,
          hr_webhook_error: result.hr_webhook_error,
        },
        { status: 500 }
      );
    }

    if (result.notification_error) {
      return NextResponse.json(
        {
          processed: result.processed,
          security_alerts: result.security_alerts,
          notifications: result.notifications,
          notification_error: result.notification_error,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      processed: result.processed,
      ledger_posts: result.ledger_posts,
      refund_ledger_posts: result.refund_ledger_posts,
      security_alerts: result.security_alerts,
      hr_webhooks: result.hr_webhooks,
      notifications: result.notifications,
      scheduled_reports: result.scheduled_reports,
      daily_sales_telegram: result.daily_sales_telegram,
      low_stock_scan: result.low_stock_scan,
      queue_backlog_scan: result.queue_backlog_scan,
      maintenance: result.maintenance,
      summaries_refreshed: result.summaries_refreshed,
      db_activity_log_pruned: result.db_activity_log_pruned,
      sales_archived: result.sales_archived,
      financial_ai_retention: result.financial_ai_retention,
      queue_depth: result.queue_depth,
      stale_rollup_orgs: result.stale_rollup_orgs,
      storage_orphans_removed: result.storage_orphans_removed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Process queue failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
