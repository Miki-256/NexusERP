"use client";

import { cn } from "@/lib/utils";

export function PageLoader({
  message = "Loading workspace…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center bg-background/85 backdrop-blur-md",
        className
      )}
      role="alert"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="nexus-page-loader-card relative flex flex-col items-center gap-5 px-10 py-9">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <span className="nexus-orbit absolute inset-0 rounded-full border border-primary/25" aria-hidden />
          <span
            className="nexus-orbit nexus-orbit-delay absolute inset-1 rounded-full border border-primary/40"
            aria-hidden
          />
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20">
            N
          </span>
        </div>
        <div className="text-center">
          <p className="font-heading text-sm font-semibold tracking-tight text-foreground">{message}</p>
          <p className="mt-1 text-xs text-muted-foreground">Nexus ERP</p>
        </div>
        <div className="h-0.5 w-32 overflow-hidden rounded-full bg-muted">
          <div className="nexus-loader-bar h-full w-1/2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.5)]" />
        </div>
      </div>
    </div>
  );
}
