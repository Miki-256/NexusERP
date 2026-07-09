"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Calendar,
  Clock,
  FileText,
  History,
  LayoutDashboard,
  ListOrdered,
  Mail,
  ScrollText,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-wrap gap-2">
      {ITEMS.map((item) => (
        <Button key={item.href} variant={active === item.href ? "default" : "outline"} size="sm" asChild>
          <Link href={item.href}>
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}
