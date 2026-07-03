"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { ChartCard, TrendAreaChart } from "@/components/charts/finance-charts";
import { Button } from "@/components/ui/button";

export function SalesTrendChart({
  data,
  total,
  currency,
}: {
  data: { label: string; value: number }[];
  total: number;
  currency: string;
}) {
  return (
    <ChartCard
      title="14-day sales trend"
      subtitle={`${formatCurrency(total, currency)} gross · completed sales`}
    >
      <div className="mb-3 flex justify-end">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reports">View reports</Link>
        </Button>
      </div>
      <TrendAreaChart data={data} formatValue={(v) => formatCurrency(v, currency)} height={240} />
    </ChartCard>
  );
}
