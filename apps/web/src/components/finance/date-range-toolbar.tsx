"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { dateRangeForPreset, type DatePreset } from "@/lib/finance-dates";
import { cn } from "@/lib/utils";

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "MTD" },
  { key: "last_month", label: "Last month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "YTD" },
];

export function DateRangeToolbar({
  from,
  to,
  className,
}: {
  from: string;
  to: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyRange(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams();
    params.set("from", nextFrom);
    params.set("to", nextTo);
    const pnl = searchParams.get("pnl");
    if (pnl) params.set("pnl", pnl);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const range = dateRangeForPreset(p.key);
          const active = from === range.from && to === range.to;
          return (
            <Button
              key={p.key}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              className="h-8"
              onClick={() => applyRange(range.from, range.to)}
            >
              {p.label}
            </Button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <DatePicker
          value={from}
          onChange={(next) => applyRange(next, to < next ? next : to)}
          className="h-9 w-[160px]"
          aria-label="From date"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <DatePicker
          value={to}
          onChange={(next) => applyRange(from > next ? next : from, next)}
          className="h-9 w-[160px]"
          min={from}
          aria-label="To date"
        />
      </div>
    </div>
  );
}
