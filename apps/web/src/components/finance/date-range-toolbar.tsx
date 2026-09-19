"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { dateRangeForPreset, type DatePreset } from "@/lib/finance-dates";
import { replaceTenantUrl } from "@/lib/tenant-scroll";
import { cn } from "@/lib/utils";

const PRESET_KEYS: { key: DatePreset; labelKey: "today" | "week" | "mtd" | "lastMonth" | "quarter" | "ytd" }[] = [
  { key: "today", labelKey: "today" },
  { key: "week", labelKey: "week" },
  { key: "month", labelKey: "mtd" },
  { key: "last_month", labelKey: "lastMonth" },
  { key: "quarter", labelKey: "quarter" },
  { key: "year", labelKey: "ytd" },
];

export function DateRangeToolbar({
  from,
  to,
  className,
  timeZone,
}: {
  from: string;
  to: string;
  className?: string;
  /** Org IANA zone for MTD/today presets (default Africa/Addis_Ababa). */
  timeZone?: string;
}) {
  const t = useTranslations("dates");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function applyRange(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", nextFrom);
    params.set("to", nextTo);
    startTransition(() => {
      replaceTenantUrl(router, pathname, params);
    });
  }

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className, isPending && "opacity-80 transition-opacity")}>
      <div className="flex flex-wrap gap-1.5">
        {PRESET_KEYS.map((p) => {
          const range = dateRangeForPreset(p.key, timeZone);
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
              {t(p.labelKey)}
            </Button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <DatePicker
          value={from}
          onChange={(next) => applyRange(next, to < next ? next : to)}
          className="h-9 w-[160px]"
          aria-label={tCommon("fromDate")}
        />
        <span className="text-sm text-muted-foreground">{tCommon("to")}</span>
        <DatePicker
          value={to}
          onChange={(next) => applyRange(from > next ? next : from, next)}
          className="h-9 w-[160px]"
          min={from}
          aria-label={tCommon("toDate")}
        />
      </div>
    </div>
  );
}
