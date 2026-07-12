"use client";

import { TabBar } from "@/components/layout/tab-bar";
import { cn } from "@/lib/utils";
import {
  AREA_TABS,
  FINANCIAL_SHELL_AREAS,
  TAB_LABELS,
  type FinancialShellAreaId,
  type FinancialShellTab,
} from "@/lib/finance/financial-shell-config";

export function FinancialShellNav({
  area,
  tab,
  onAreaChange,
  onTabChange,
  tabCounts,
}: {
  area: FinancialShellAreaId;
  tab: FinancialShellTab;
  onAreaChange: (area: FinancialShellAreaId) => void;
  onTabChange: (tab: FinancialShellTab) => void;
  tabCounts?: Partial<Record<FinancialShellTab, number>>;
}) {
  const areaTabs = AREA_TABS[area].filter((t) => t !== "home");

  return (
    <div className="space-y-3">
      <div
        className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1"
        role="tablist"
        aria-label="Financial areas"
      >
        {FINANCIAL_SHELL_AREAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={area === a.id}
            onClick={() => onAreaChange(a.id)}
            className={cn(
              "fiori-area-pill shrink-0 cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              area === a.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {area !== "home" && areaTabs.length > 0 && (
        <TabBar
          tabs={areaTabs.map((key) => ({
            key,
            label: TAB_LABELS[key],
            count: tabCounts?.[key],
          }))}
          value={tab}
          onChange={onTabChange}
          className="border-none"
        />
      )}
    </div>
  );
}

export function FinancialShellBreadcrumb({
  area,
  tab,
}: {
  area: FinancialShellAreaId;
  tab: FinancialShellTab;
}) {
  const areaLabel = FINANCIAL_SHELL_AREAS.find((a) => a.id === area)?.label ?? "Financials";
  const tabLabel = tab === "home" ? "Launchpad" : TAB_LABELS[tab];

  return (
    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      Financials · {areaLabel} · {tabLabel}
    </p>
  );
}
