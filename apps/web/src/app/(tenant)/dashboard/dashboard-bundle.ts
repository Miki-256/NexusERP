import { createReportingClient } from "@/lib/supabase/server";

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

export async function loadDashboardBundle(
  orgId: string,
  options: { includeAccounting: boolean; includeExpenses: boolean }
): Promise<DashboardBundle> {
  const supabase = await createReportingClient();
  const { data } = await supabase.rpc("dashboard_bundle", {
    p_org_id: orgId,
    p_include_accounting: options.includeAccounting,
    p_include_expenses: options.includeExpenses,
  });
  return (data ?? {}) as DashboardBundle;
}
