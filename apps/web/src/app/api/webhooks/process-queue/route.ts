import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { dispatchSecurityAlerts } from "@/lib/security-alert-dispatch";

function verifySecret(request: Request): boolean {
  const webhookSecret = process.env.POS_WEBHOOK_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const headerSecret = request.headers.get("x-pos-webhook-secret");
  if (webhookSecret && headerSecret === webhookSecret) return true;

  const auth = request.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  if (!webhookSecret && !cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  return false;
}

/** undefined = DB default (archive cold sales on Sunday UTC). */
function resolveArchiveSales(request: Request): boolean | undefined {
  const url = new URL(request.url);
  const param = url.searchParams.get("archive_sales");
  if (param === "1" || param === "true") return true;
  if (param === "0" || param === "false") return false;
  if (request.headers.get("x-archive-sales") === "1") return true;
  if (process.env.FORCE_SALES_ARCHIVE === "true") return true;
  if (process.env.SKIP_SALES_ARCHIVE === "true") return false;
  return undefined;
}

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

  return NextResponse.json({
    processed: data,
    ledger_posts: ledgerPosts,
    security_alerts: securityAlerts,
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
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processQueue(request);
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processQueue(request);
}
