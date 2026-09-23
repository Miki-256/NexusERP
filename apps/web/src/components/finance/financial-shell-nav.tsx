"use client";

import { TabBar } from "@/components/layout/tab-bar";
import { cn } from "@/lib/utils";
import {
  AREA_TABS,
  FINANCIAL_SHELL_AREAS,
  type FinancialShellAreaId,
  type FinancialShellTab,
} from "@/lib/finance/financial-shell-config";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("finance");
  const areaTabs = AREA_TABS[area].filter((tKey) => tKey !== "home");

  return (
    <div className="sticky top-0 z-10 space-y-2 bg-background/95 py-1 backdrop-blur-sm">
      <div
        className="flex gap-1 overflow-x-auto rounded-md border bg-muted/30 p-0.5 scrollbar-thin"
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
              "fiori-area-pill shrink-0 cursor-pointer rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors duration-150 lg:px-2.5 lg:py-1.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              area === a.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            )}
          >
            {t(`areas.${a.id}`)}
          </button>
        ))}
      </div>

      {area !== "home" && areaTabs.length > 0 && (
        <TabBar
          tabs={areaTabs.map((key) => ({
            key,
            label: t(`tabs.${key}`),
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
  const t = useTranslations("finance");
  const tNav = useTranslations("nav");
  const areaLabel = t(`areas.${area}`);
  const tabLabel = tab === "home" ? t("tabs.home") : t(`tabs.${tab}`);

  return (
    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {tNav("apps.accounting.name")} · {areaLabel} · {tabLabel}
    </p>
  );
}
