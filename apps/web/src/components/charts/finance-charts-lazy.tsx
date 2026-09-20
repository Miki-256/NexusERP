"use client";

import dynamic from "next/dynamic";

/** Light shell — no recharts. Re-export ChartCard from the charts module on HEAD. */
export { ChartCard } from "./finance-charts";

const loading = () => (
  <div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
    …
  </div>
);

/** Named exports must return `{ default: Comp }` for next/dynamic + React.lazy. */
export const TrendAreaChart = dynamic(
  () =>
    import("./finance-charts").then((m) => {
      if (!m.TrendAreaChart) throw new Error("finance-charts: missing TrendAreaChart");
      return { default: m.TrendAreaChart };
    }),
  { ssr: false, loading }
);

export const FinanceBarChart = dynamic(
  () =>
    import("./finance-charts").then((m) => {
      if (!m.FinanceBarChart) throw new Error("finance-charts: missing FinanceBarChart");
      return { default: m.FinanceBarChart };
    }),
  { ssr: false, loading }
);

export const FinanceDonutChart = dynamic(
  () =>
    import("./finance-charts").then((m) => {
      if (!m.FinanceDonutChart) throw new Error("finance-charts: missing FinanceDonutChart");
      return { default: m.FinanceDonutChart };
    }),
  { ssr: false, loading }
);

export const PnlWaterfallChart = dynamic(
  () =>
    import("./finance-charts").then((m) => {
      if (!m.PnlWaterfallChart) throw new Error("finance-charts: missing PnlWaterfallChart");
      return { default: m.PnlWaterfallChart };
    }),
  { ssr: false, loading }
);

export const DualMetricChart = dynamic(
  () =>
    import("./finance-charts").then((m) => {
      if (!m.DualMetricChart) throw new Error("finance-charts: missing DualMetricChart");
      return { default: m.DualMetricChart };
    }),
  { ssr: false, loading }
);
