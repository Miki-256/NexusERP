"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

type LiveStats = {
  saleCount: number;
  grossTotal: number;
  paymentBreakdown: { method: string; total: number }[];
  topProducts: { name: string; qty: number; total: number }[];
};

export function ShiftStatsBar({
  sessionId,
  sessionToken,
  currency,
}: {
  sessionId: string;
  sessionToken?: string;
  currency: string;
}) {
  const [stats, setStats] = useState<LiveStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_pos_live_stats", {
        p_session_id: sessionId,
        p_session_token: sessionToken ?? null,
      });
      if (!cancelled && data) setStats(data as LiveStats);
    }

    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, sessionToken]);

  if (!stats) return null;

  const top = stats.topProducts?.[0];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200/80 bg-slate-100/90 px-5 py-2 text-xs text-slate-600">
      <span>
        <strong className="tabular-nums text-slate-900">{stats.saleCount}</strong> sales
      </span>
      <span>
        Gross{" "}
        <strong className="tabular-nums text-slate-900">
          {formatCurrency(stats.grossTotal, currency)}
        </strong>
      </span>
      {stats.paymentBreakdown?.slice(0, 3).map((p) => (
        <span key={p.method} className="capitalize">
          {p.method.replace(/_/g, " ")}{" "}
          <strong className="tabular-nums">{formatCurrency(p.total, currency)}</strong>
        </span>
      ))}
      {top && (
        <span className="hidden md:inline">
          Top: <strong>{top.name}</strong> ({top.qty})
        </span>
      )}
    </div>
  );
}
