import { createClient } from "@/lib/supabase/server";
import {
  calendarDateInTimeZone,
  monthToDate,
  utcDayRangeForCalendarDate,
} from "@/lib/finance-dates";

export type DashboardBundle = {
  today_stats?: Record<string, number>;
  mtd_pnl?: {
    net_profit?: number;
    revenue?: number;
    cogs?: number;
    gross_profit?: number;
    operating_expenses?: number;
    gross_margin_pct?: number;
    net_margin_pct?: number;
  };
  prev_pnl?: { net_profit?: number };
  mtd_cash_flow?: { inflows?: number; outflows?: number; net_change?: number; closing_cash?: number };
  ar_total?: number | null;
  ap_total?: number | null;
  sales_trend_14d?: { date: string; total: number }[];
  product_count?: number;
  recent_expenses?: { expense_date: string; vendor_name: string | null; amount: number }[];
  recent_sales?: {
    id: string;
    receipt_no: string;
    total: number;
    status: string;
    created_at: string;
    stores: { name: string } | null;
  }[];
  mtd_from?: string;
  mtd_to?: string;
};

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTodayStats(raw: Record<string, unknown> | null | undefined): Record<string, number> {
  return {
    sales_total: asNumber(raw?.sales_total),
    transaction_count: asNumber(raw?.transaction_count),
    cash_total: asNumber(raw?.cash_total),
    mobile_total: asNumber(raw?.mobile_total),
    bank_total: asNumber(raw?.bank_total),
  };
}

async function fetchOrgTimezone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string
): Promise<string> {
  const { data } = await supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  return data?.timezone?.trim() || "Africa/Addis_Ababa";
}

/** Live today KPIs using org-local day bounds (works even if dashboard_stats SQL is stale). */
async function fetchTodayStatsLive(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  timeZone: string
): Promise<Record<string, number>> {
  const ymd = calendarDateInTimeZone(new Date(), timeZone);
  const { from, to } = utcDayRangeForCalendarDate(ymd, timeZone);

  const [salesRes, paymentsRes] = await Promise.all([
    supabase
      .from("sales")
      .select("total")
      .eq("organization_id", orgId)
      .eq("status", "completed")
      .gte("created_at", from)
      .lte("created_at", to),
    supabase
      .from("payments")
      .select("amount, method, sales!inner(status)")
      .eq("organization_id", orgId)
      .eq("sales.status", "completed")
      .gte("created_at", from)
      .lte("created_at", to),
  ]);

  const sales = salesRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  let cash = 0;
  let mobile = 0;
  let bank = 0;
  for (const p of payments) {
    const amt = asNumber(p.amount);
    if (p.method === "cash") cash += amt;
    else if (p.method === "mobile_money") mobile += amt;
    else if (p.method === "bank_transfer") bank += amt;
  }

  return {
    sales_total: sales.reduce((sum, row) => sum + asNumber(row.total), 0),
    transaction_count: sales.length,
    cash_total: cash,
    mobile_total: mobile,
    bank_total: bank,
  };
}

async function resolveTodayStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  fromBundle: Record<string, unknown> | null | undefined,
  timeZone: string
): Promise<Record<string, number>> {
  const normalized = normalizeTodayStats(fromBundle);
  if (normalized.sales_total > 0 || normalized.transaction_count > 0) {
    return normalized;
  }

  const { data: rpcStats } = await supabase.rpc("dashboard_stats", {
    p_organization_id: orgId,
  });
  const fromRpc = normalizeTodayStats(rpcStats as Record<string, unknown> | null);
  if (fromRpc.sales_total > 0 || fromRpc.transaction_count > 0) {
    return fromRpc;
  }

  return fetchTodayStatsLive(supabase, orgId, timeZone);
}

export async function loadDashboardBundle(
  orgId: string,
  options: { includeAccounting: boolean; includeExpenses: boolean }
): Promise<DashboardBundle> {
  const supabase = await createClient();

  const [timeZone, { data, error }] = await Promise.all([
    fetchOrgTimezone(supabase, orgId),
    supabase.rpc("dashboard_bundle", {
      p_org_id: orgId,
      p_include_accounting: options.includeAccounting,
      p_include_expenses: options.includeExpenses,
    }),
  ]);

  if (error) {
    console.error("[dashboard] dashboard_bundle RPC failed:", error.message);
  }

  const bundle = (data ?? {}) as DashboardBundle;
  const mtd = monthToDate();

  bundle.today_stats = await resolveTodayStats(
    supabase,
    orgId,
    bundle.today_stats as Record<string, unknown> | undefined,
    timeZone
  );

  if (!bundle.mtd_from) bundle.mtd_from = mtd.from;
  if (!bundle.mtd_to) bundle.mtd_to = mtd.to;

  if (!bundle.recent_sales?.length) {
    const { data: recent } = await supabase
      .from("sales")
      .select("id, receipt_no, total, status, created_at, stores(name)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10);
    bundle.recent_sales = (recent ?? []) as unknown as DashboardBundle["recent_sales"];
  }

  if (options.includeAccounting && !bundle.mtd_pnl) {
    const { data: pnl } = await supabase.rpc("profit_and_loss", {
      p_org_id: orgId,
      p_from: bundle.mtd_from,
      p_to: bundle.mtd_to,
    });
    bundle.mtd_pnl = (pnl ?? {}) as DashboardBundle["mtd_pnl"];
  }

  return bundle;
}
