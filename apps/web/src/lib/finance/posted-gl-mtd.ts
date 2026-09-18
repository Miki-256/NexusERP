/**
 * Shared posted-GL MTD KPI path (NX-AUDIT-001).
 * Dashboard and Accounting hub must use the same org-TZ window + p_mode='gl'.
 * Hub overview still loads via fetch_financial_report(..., p_mode:'gl', p_force_refresh)
 * which resolves to the same profit_and_loss SQL with identical dates.
 */
import { monthToDateInTimeZone, DEFAULT_ORG_TIMEZONE } from "@/lib/finance-dates";

export type PostedGlMtdArgs = {
  orgId: string;
  timeZone?: string;
  from?: string;
  to?: string;
};

export type PostedGlMtdResult = {
  from: string;
  to: string;
  mode: "gl";
  pnl: Record<string, unknown> | null;
};

type RpcClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

/** Canonical MTD bounds + posted-GL P&L for ledger KPIs. */
export async function fetchPostedGlMtdPnl(
  supabase: RpcClient,
  args: PostedGlMtdArgs
): Promise<PostedGlMtdResult> {
  const tz = args.timeZone?.trim() || DEFAULT_ORG_TIMEZONE;
  const mtd = monthToDateInTimeZone(tz);
  const from = args.from ?? mtd.from;
  const to = args.to ?? mtd.to;

  const { data, error } = await supabase.rpc("profit_and_loss", {
    p_org_id: args.orgId,
    p_from: from,
    p_to: to,
    p_mode: "gl",
  });

  if (error) {
    console.error("[posted-gl-mtd] profit_and_loss failed:", (error as { message: string }).message);
  }

  return {
    from,
    to,
    mode: "gl",
    pnl: (data ?? null) as Record<string, unknown> | null,
  };
}

/** Build the exact RPC args both surfaces must share for a given window. */
export function postedGlMtdRpcArgs(orgId: string, from: string, to: string) {
  return {
    p_org_id: orgId,
    p_from: from,
    p_to: to,
    p_mode: "gl" as const,
  };
}
