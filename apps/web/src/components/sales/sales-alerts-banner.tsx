"use client";

import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SalesAlert } from "@/lib/sales-register";
import { refreshPreservingTenantScroll } from "@/lib/tenant-scroll";

export function SalesAlertsBanner({ alerts }: { alerts: SalesAlert[] }) {
  const router = useRouter();

  if (!alerts.length) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <button
          key={`${alert.type}-${alert.message}`}
          type="button"
          onClick={() => refreshPreservingTenantScroll(router)}
          className={cn(
            "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
            alert.severity === "high"
              ? "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100"
              : "border-sky-200 bg-sky-50 text-sky-950 hover:bg-sky-100"
          )}
        >
          {alert.severity === "high" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="flex-1">{alert.message}</p>
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </button>
      ))}
    </div>
  );
}
