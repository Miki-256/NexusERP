"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Placeholder while client sidebar loads (avoids SSR hydration drift in dev).
 * Must NOT use useShell — also rendered from TenantAuthFallback outside ShellProvider.
 */
export function SidebarPlaceholder() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("nexus-sidebar-collapsed") === "true");
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-150 lg:flex",
        collapsed ? "w-14" : "w-60"
      )}
      aria-hidden
    />
  );
}
