"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ShoppingCart,
  ShieldCheck,
  LayoutGrid,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_CATEGORIES, appIconById, type SerializedNavApp } from "@/lib/apps-registry";
import { useShell } from "@/components/layout/shell-context";
import { usePlatformAdmin } from "@/components/layout/use-platform-admin";
import { useNavigation } from "@/components/layout/navigation-context";
import { useState } from "react";

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  onNavigate,
  pending,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  pending?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-white/10 text-sidebar-foreground"
          : "text-sidebar-muted hover:bg-white/[0.05] hover:text-sidebar-foreground",
        pending && !active && "bg-white/[0.06] text-sidebar-foreground",
        collapsed && "justify-center px-2"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-sidebar-foreground/80" />
      )}
      <Icon className={cn("h-[18px] w-[18px] shrink-0 opacity-90", active && "text-sidebar-foreground")} strokeWidth={1.5} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function NavGroup({
  label,
  collapsed,
  defaultOpen = true,
  children,
}: {
  label: string;
  collapsed: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (collapsed) {
    return <div className="space-y-0.5">{children}</div>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-muted transition-colors hover:text-sidebar-foreground"
      >
        {label}
        <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div
        className={cn(
          "space-y-0.5 overflow-hidden transition-all duration-200",
          open ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        {children}
      </div>
    </div>
  );
}

function SidebarInner({
  orgName,
  userId,
  navApps,
  collapsed,
  onNavigate,
}: {
  orgName: string;
  userId: string;
  navApps: SerializedNavApp[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { toggleSidebar } = useShell();
  const { pendingPath } = useNavigation();
  const { isPlatformAdmin } = usePlatformAdmin(userId);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  const groups = APP_CATEGORIES.map((cat) => ({
    label: cat.label,
    items: navApps.filter((a) => a.category === cat.key),
  })).filter((g) => g.items.length > 0);

  const showBilling = navApps.some((a) => a.id === "settings");

  return (
    <>
      <div className={cn("flex h-14 items-center border-b border-sidebar-border", collapsed ? "justify-center px-2" : "justify-between px-3")}>
        <div className={cn("flex items-center gap-2.5 min-w-0", collapsed && "justify-center")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-xs font-bold text-sidebar-foreground">
            N
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-heading text-sm font-semibold text-sidebar-foreground">Nexus ERP</p>
              <p className="truncate text-xs text-sidebar-muted">{orgName}</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white lg:block"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4 scrollbar-thin">
        <NavGroup label="Home" collapsed={collapsed}>
          <NavLink
            href="/dashboard"
            label="Apps"
            icon={LayoutGrid}
            active={isActive("/dashboard")}
            collapsed={collapsed}
            onNavigate={onNavigate}
            pending={pendingPath === "/dashboard"}
          />
        </NavGroup>

        {groups.map((group) => (
          <NavGroup key={group.label} label={group.label} collapsed={collapsed}>
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.name}
                icon={appIconById(item.id)}
                active={isActive(item.href)}
                collapsed={collapsed}
                onNavigate={onNavigate}
                pending={pendingPath === item.href || pendingPath?.startsWith(item.href + "/")}
              />
            ))}
            {group.label === "Settings" && showBilling && (
              <NavLink
                href="/settings/billing"
                label="Billing & plan"
                icon={CreditCard}
                active={isActive("/settings/billing")}
                collapsed={collapsed}
                onNavigate={onNavigate}
                pending={pendingPath === "/settings/billing"}
              />
            )}
          </NavGroup>
        ))}

        <div className="space-y-1 border-t border-sidebar-border pt-3">
          <Link
            href="/pos"
            prefetch
            onClick={onNavigate}
            title={collapsed ? "Open POS" : undefined}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-md border px-2.5 py-2.5 text-sm font-medium transition-colors duration-150",
              isActive("/pos")
                ? "border-white/20 bg-white/10 text-sidebar-foreground"
                : "border-white/10 text-sidebar-muted hover:border-white/15 hover:bg-white/[0.05] hover:text-sidebar-foreground",
              collapsed && "justify-center px-2"
            )}
          >
            <ShoppingCart className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && "Open POS"}
          </Link>
          {isPlatformAdmin && (
            <NavLink
              href="/admin"
              label="Super Admin"
              icon={ShieldCheck}
              active={isActive("/admin")}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          )}
        </div>
      </nav>

      {collapsed && (
        <div className="hidden border-t border-sidebar-border p-2 lg:block">
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex w-full items-center justify-center rounded-lg p-2 text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

export function Sidebar({
  orgName,
  userId,
  navApps,
}: {
  orgName: string;
  userId: string;
  navApps: SerializedNavApp[];
}) {
  const { sidebarCollapsed, mobileOpen, setMobileOpen } = useShell();

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-out lg:flex",
          sidebarCollapsed ? "w-[68px]" : "w-60"
        )}
      >
        <SidebarInner
          orgName={orgName}
          userId={userId}
          navApps={navApps}
          collapsed={sidebarCollapsed}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-sidebar text-sidebar-foreground shadow-elevated-lg animate-slide-in-from-left">
            <div className="flex items-center justify-end border-b border-sidebar-border p-2">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-sidebar-muted hover:bg-white/5 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarInner
              orgName={orgName}
              userId={userId}
              navApps={navApps}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}
