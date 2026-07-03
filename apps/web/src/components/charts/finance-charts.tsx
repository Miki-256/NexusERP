"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "hsl(222 47% 31%)",
  "hsl(215 16% 47%)",
  "hsl(199 70% 38%)",
  "hsl(142 45% 36%)",
  "hsl(32 65% 42%)",
  "hsl(0 45% 45%)",
];

type TooltipProps = {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  formatter?: (v: number) => string;
};

function ChartTooltip({ active, payload, label, formatter }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/80 bg-popover px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1.5 font-medium text-foreground">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}:</span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatter ? formatter(p.value) : p.value.toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("enterprise-panel p-5", className)}>
      <div className="mb-4 border-b border-border pb-3">
        <h3 className="font-heading text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function TrendAreaChart({
  data,
  dataKey = "value",
  secondaryKey,
  height = 280,
  formatValue,
  primaryLabel = "Revenue",
  secondaryLabel = "Expenses",
}: {
  data: { label: string; value: number; secondary?: number }[];
  dataKey?: string;
  secondaryKey?: string;
  height?: number;
  formatValue?: (v: number) => string;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="financeAreaPrimary" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(222 47% 31%)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="hsl(222 47% 31%)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="financeAreaSecondary" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(215 16% 47%)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="hsl(215 16% 47%)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
          width={48}
        />
        <Tooltip content={<ChartTooltip formatter={fmt} />} />
        {secondaryKey && (
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value) => <span className="text-muted-foreground">{value}</span>}
          />
        )}
        <Area
          type="monotone"
          dataKey={dataKey}
          name={primaryLabel}
          stroke="hsl(222 47% 31%)"
          strokeWidth={2}
          fill="url(#financeAreaPrimary)"
        />
        {secondaryKey && (
          <Area
            type="monotone"
            dataKey={secondaryKey}
            name={secondaryLabel}
            stroke="hsl(215 16% 47%)"
            strokeWidth={2}
            fill="url(#financeAreaSecondary)"
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function FinanceBarChart({
  data,
  height = 260,
  formatValue,
  layout = "horizontal",
}: {
  data: { name: string; value: number; fill?: string }[];
  height?: number;
  formatValue?: (v: number) => string;
  layout?: "horizontal" | "vertical";
}) {
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());
  const isHorizontal = layout === "horizontal";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, left: isHorizontal ? 8 : 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={!isHorizontal} vertical={isHorizontal} />
        {isHorizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} width={48} />
          </>
        )}
        <Tooltip content={<ChartTooltip formatter={fmt} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
        <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={entry.fill ?? CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FinanceDonutChart({
  data,
  height = 260,
  formatValue,
  innerRadius = 58,
}: {
  data: { name: string; value: number }[];
  height?: number;
  formatValue?: (v: number) => string;
  innerRadius?: number;
}) {
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={innerRadius + 36}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatter={fmt} />} />
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            wrapperStyle={{ fontSize: 12, paddingLeft: 8 }}
            formatter={(value) => <span className="text-muted-foreground">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      {total > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pr-[35%]">
          <div className="text-center">
            <p className="text-2xs uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="text-sm font-bold tabular-nums">{fmt(total)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function PnlWaterfallChart({
  revenue,
  cogs,
  opex,
  netProfit,
  formatValue,
  height = 240,
}: {
  revenue: number;
  cogs: number;
  opex: number;
  netProfit: number;
  formatValue: (v: number) => string;
  height?: number;
}) {
  const data = [
    { name: "Revenue", value: revenue, fill: "hsl(222 47% 31%)" },
    { name: "COGS", value: -Math.abs(cogs), fill: "hsl(0 45% 45%)" },
    { name: "Gross", value: revenue - cogs, fill: "hsl(215 16% 47%)" },
    { name: "OpEx", value: -Math.abs(opex), fill: "hsl(32 65% 42%)" },
    { name: "Net Profit", value: netProfit, fill: netProfit >= 0 ? "hsl(142 45% 36%)" : "hsl(0 45% 45%)" },
  ];

  return (
    <FinanceBarChart data={data} height={height} formatValue={formatValue} layout="vertical" />
  );
}

export function DualMetricChart({
  data,
  formatValue,
  height = 280,
}: {
  data: { label: string; revenue: number; expenses: number }[];
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const mapped = data.map((d) => ({ label: d.label, value: d.revenue, secondary: d.expenses }));
  return (
    <TrendAreaChart
      data={mapped}
      secondaryKey="secondary"
      height={height}
      formatValue={formatValue}
      primaryLabel="Revenue"
      secondaryLabel="Expenses"
    />
  );
}
