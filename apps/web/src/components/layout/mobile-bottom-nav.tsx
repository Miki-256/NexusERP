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
  const { setMobileOpen } = useShell();
  const allowed = new Set(accessibleAppIds);

  const links = PRIMARY_LINKS.filter((l) => allowed.has(l.appId));

  if (links.length === 0) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      aria-label="Primary navigation"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {links.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-h-[52px] min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex min-h-[52px] min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium text-muted-foreground"
          aria-label="Open full menu"
        >
          <Menu className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}
