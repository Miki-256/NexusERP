"use client";

import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SalesAlert } from "@/lib/sales-register";

export function SalesAlertsBanner({ alerts }: { alerts: SalesAlert[] }) {
  if (!alerts.length) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div
          key={`${alert.type}-${alert.message}`}
          className={cn(
            "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
            alert.severity === "high"
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : "border-sky-200 bg-sky-50 text-sky-950"
          )}
        >
          {alert.severity === "high" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p>{alert.message}</p>
        </div>
      ))}
    </div>
  );
}
