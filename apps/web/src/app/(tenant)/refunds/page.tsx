import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { monthToDate } from "@/lib/finance-dates";
import { RefundsClient } from "./refunds-client";

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireAppAccess("refunds");
  const params = await searchParams;
  const mtd = monthToDate();
  const from = params.from ?? mtd.from;
  const to = params.to ?? mtd.to;

  const supabase = await createClient();
  const { data } = await supabase.rpc("list_refunds_register", {
    p_organization_id: ctx.organization.id,
    p_from: `${from}T00:00:00.000Z`,
    p_to: `${to}T23:59:59.999Z`,
    p_limit: 200,
  });

  const payload = (data ?? { voided_sales: [], partial_returns: [] }) as {
    voided_sales: Record<string, unknown>[];
    partial_returns: Record<string, unknown>[];
  };

  return (
    <RefundsClient
      currency={ctx.organization.currency}
      from={from}
      to={to}
      voidedSales={payload.voided_sales}
      partialReturns={payload.partial_returns}
    />
  );
}
