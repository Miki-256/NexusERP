"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, Receipt, ShoppingCart, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "@/components/layout/shell-context";

const PRIMARY_LINKS = [
  { appId: "dashboard", href: "/dashboard", label: "Apps", icon: LayoutDashboard, match: (p: string) => p === "/dashboard" },
  { appId: "pos", href: "/pos", label: "POS", icon: ShoppingCart, match: (p: string) => p.startsWith("/pos") },
  { appId: "sales", href: "/sales", label: "Sales", icon: Receipt, match: (p: string) => p.startsWith("/sales") },
  { appId: "products", href: "/products", label: "Products", icon: Package, match: (p: string) => p.startsWith("/products") },
] as const;

export function MobileBottomNav({ accessibleAppIds }: { accessibleAppIds: string[] }) {
  const pathname = usePathname();
  const { setMobileOpen, mobileOpen } = useShell();
  const allowed = new Set(accessibleAppIds);

  const links = PRIMARY_LINKS.filter((l) => allowed.has(l.appId));

  if (links.length === 0 || mobileOpen) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Primary navigation"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around" style={{ minHeight: "var(--mobile-nav-height)" }}>
        {links.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "touch-target flex min-h-[var(--mobile-nav-height)] min-w-[4rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors active:scale-95",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0", active && "stroke-[2.5]")} />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="touch-target flex min-h-[var(--mobile-nav-height)] min-w-[4rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium text-muted-foreground active:scale-95"
          aria-label="Open full menu"
        >
          <Menu className="h-5 w-5 shrink-0" />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}
