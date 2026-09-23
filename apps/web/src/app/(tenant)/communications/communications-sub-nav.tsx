"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  FileText,
  History,
  LayoutDashboard,
  ListOrdered,
  ScrollText,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/communications", label: "Dashboard", icon: LayoutDashboard },
  { href: "/communications/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/communications/queue", label: "Queue", icon: ListOrdered },
  { href: "/communications/failed", label: "Failed", icon: AlertTriangle },
  { href: "/communications/rules", label: "Rules", icon: Zap },
  { href: "/communications/groups", label: "Groups", icon: Users },
  { href: "/communications/history", label: "History", icon: History },
  { href: "/communications/schedules", label: "Schedules", icon: Calendar },
  { href: "/communications/audit", label: "Audit", icon: ScrollText },
  { href: "/communications/templates", label: "Templates", icon: FileText },
  { href: "/communications/settings", label: "Channels", icon: Settings },
] as const;

export function CommunicationsSubNav({ active }: { active: string }) {
  return (
    <div
      className="flex gap-0.5 overflow-x-auto border-b border-border scrollbar-thin"
      role="navigation"
      aria-label="Communications"
    >
      {ITEMS.map((item) => {
        const selected = active === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
              selected
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
