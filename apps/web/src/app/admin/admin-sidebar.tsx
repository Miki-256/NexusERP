"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  ClipboardList,
  CreditCard,
  Flag,
  Headphones,
  LayoutDashboard,
  Settings,
  Shield,
  ShieldAlert,
  Upload,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, type PlatformAdminRole } from "@/lib/admin-types";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/support", label: "Support lookup", icon: Headphones },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/security", label: "Security", icon: ShieldAlert },
  { href: "/admin/plans", label: "Plans", icon: CreditCard },
  { href: "/admin/health", label: "Health", icon: Activity },
  { href: "/admin/features", label: "Features", icon: Flag },
  { href: "/admin/audit", label: "Audit log", icon: ClipboardList },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/admins", label: "Platform admins", icon: Shield },
  { href: "/admin/import", label: "Data import", icon: Upload },
];

export function AdminSidebar({ role }: { role: PlatformAdminRole }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 border-r border-border/60 bg-card/40 md:block">
      <div className="sticky top-[57px] p-4">
        <p className="mb-4 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {ROLE_LABELS[role]}
        </p>
        <nav className="space-y-1">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        {!["super_admin", "support"].includes(role) && (
          <p className="mt-6 px-2 text-xs leading-relaxed text-muted-foreground">
            Read-only access. Contact a super admin for write actions.
          </p>
        )}
      </div>
    </aside>
  );
}

export function AdminMobileNav({ role }: { role: PlatformAdminRole }) {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border/60 px-4 py-2 md:hidden">
      {NAV.map(({ href, label, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground"
            )}
          >
            {label}
          </Link>
        );
      })}
      <span className="sr-only">{ROLE_LABELS[role]}</span>
    </div>
  );
}
