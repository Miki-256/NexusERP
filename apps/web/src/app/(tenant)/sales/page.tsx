import { requireAppAccess } from "@/lib/require-app-access";
import { createReportingClient } from "@/lib/supabase/server";
import { monthToDate } from "@/lib/finance-dates";
import { SalesClient } from "./sales-client";
import type { SalesAnalytics, SalesRegisterListResult } from "@/lib/sales-register";

const PAGE_SIZE = 25;

function parseFilters(params: Record<string, string | undefined>) {
  const mtd = monthToDate();
  const from = params.from ?? mtd.from;
  const to = params.to ?? mtd.to;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  return {
    from,
    to,
    fromIso: `${from}T00:00:00.000Z`,
    toIso: `${to}T23:59:59.999Z`,
    page,
    status: params.status ?? "all",
    storeId: params.store ?? undefined,
    registerId: params.register ?? undefined,
    staffId: params.staff ?? undefined,
    paymentMethod: params.method ?? "all",
    paymentStatus: params.payStatus ?? "all",
    search: params.q ?? undefined,
    view: params.view ?? undefined,
  };
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireAppAccess("sales");
  const params = await searchParams;
  const filters = parseFilters(params);

  if (filters.view === "pending") {
    filters.paymentStatus = "pending";
    filters.status = "completed";
  } else if (filters.view === "voided") {
    filters.status = "voided";
  }

  const supabase = await createReportingClient();
  const offset = (filters.page - 1) * PAGE_SIZE;

  const [
    { data: registerRaw },
    { data: analyticsRaw },
    { data: stores },
    { data: registers },
    { data: staff },
    { data: lineExportSales },
  ] = await Promise.all([
    supabase.rpc("list_sales_register", {
      p_organization_id: ctx.organization.id,
      p_from: filters.fromIso,
      p_to: filters.toIso,
      p_status: filters.status,
      p_store_id: filters.storeId ?? null,
      p_register_id: filters.registerId ?? null,
      p_staff_id: filters.staffId ?? null,
      p_payment_method: filters.paymentMethod,
      p_payment_status: filters.paymentStatus,
      p_search: filters.search ?? null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    }),
    supabase.rpc("sales_register_analytics", {
      p_organization_id: ctx.organization.id,
      p_from: filters.fromIso,
      p_to: filters.toIso,
      p_store_id: filters.storeId ?? null,
    }),
    supabase.from("stores").select("id, name").eq("organization_id", ctx.organization.id).order("name"),
    supabase.from("registers").select("id, name, store_id").eq("organization_id", ctx.organization.id).order("name"),
    supabase
      .from("pos_staff")
      .select("id, display_name")
      .eq("organization_id", ctx.organization.id)
      .eq("is_active", true)
      .order("display_name"),
    supabase
      .from("sales")
      .select(
        `receipt_no, created_at, status, stores(name),
         sale_lines(product_name, variant_name, quantity, unit_price, discount_amount, line_total)`
      )
      .eq("organization_id", ctx.organization.id)
      .gte("created_at", filters.fromIso)
      .lte("created_at", filters.toIso)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const registerData = (registerRaw ?? { rows: [], total: 0, summary: {} }) as SalesRegisterListResult;
  const analytics = (analyticsRaw ?? {
    daily_trend: [],
    hourly: [],
    by_store: [],
    top_products: [],
    top_staff: [],
    kpis: { discount_rate_pct: 0, void_rate_pct: 0, avg_ticket: 0 },
    alerts: [],
  }) as SalesAnalytics;

  const lineExportRows: Record<string, unknown>[] = [];
  for (const sale of lineExportSales ?? []) {
    const storeRaw = sale.stores as { name: string } | { name: string }[] | null;
    const store = Array.isArray(storeRaw) ? storeRaw[0]?.name : storeRaw?.name;
    for (const line of (sale.sale_lines as Record<string, unknown>[]) ?? []) {
      lineExportRows.push({
        receipt_no: sale.receipt_no,
        date: new Date(sale.created_at as string).toLocaleString(),
        store: store ?? "",
        status: sale.status,
        product: line.product_name,
        variant: line.variant_name ?? "",
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount: line.discount_amount,
        line_total: line.line_total,
      });
    }
  }

  return (
    <SalesClient
      currency={ctx.organization.currency}
      canManage={ctx.canManageApp("sales")}
      orgName={ctx.organization.name}
      registerData={registerData}
      analytics={analytics}
      lineExportRows={lineExportRows}
      filters={filters}
      pageSize={PAGE_SIZE}
      stores={(stores ?? []).map((s) => ({ id: s.id, name: s.name }))}
      registers={(registers ?? []).map((r) => ({ id: r.id, name: r.name, storeId: r.store_id }))}
      staff={(staff ?? []).map((s) => ({ id: s.id, name: s.display_name }))}
    />
  );
}
