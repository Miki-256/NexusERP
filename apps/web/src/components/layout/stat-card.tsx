import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  highlight,
  className,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  trend?: { value: string; positive?: boolean };
  highlight?: "positive" | "negative";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-5 py-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="enterprise-kpi-label">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={1.5} />}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
          highlight === "positive" && "text-success",
          highlight === "negative" && "text-destructive"
        )}
      >
        {value}
      </p>
      {(sub || trend) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {trend && (
            <span
              className={cn(
                "text-xs font-medium tabular-nums",
                trend.positive ? "text-success" : "text-destructive"
              )}
            >
              {trend.value}
            </span>
          )}
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      )}
    </div>
  );
}
