"use client";

import { cn } from "@/lib/utils";

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
    <div className={cn("enterprise-panel p-2.5 sm:p-3", className)}>
      <div className="mb-2 border-b border-border pb-2">
        <h3 className="font-heading text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
