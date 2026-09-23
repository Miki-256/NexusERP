"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, Receipt, ShoppingCart, Package } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useShell } from "@/components/layout/shell-context";

const PRIMARY_LINKS = [
  {
    appId: "dashboard",
    href: "/dashboard",
    labelKey: "mobile.home" as const,
    icon: LayoutDashboard,
    match: (p: string) => p === "/dashboard",
  },
  {
    appId: "pos",
    href: "/pos",
    labelKey: "mobile.pos" as const,
    icon: ShoppingCart,
    match: (p: string) => p.startsWith("/pos"),
  },
  {
    appId: "sales",
    href: "/sales",
    labelKey: "mobile.sales" as const,
    icon: Receipt,
    match: (p: string) => p.startsWith("/sales"),
  },
  {
    appId: "products",
    href: "/products",
    labelKey: "mobile.products" as const,
    icon: Package,
    match: (p: string) => p.startsWith("/products"),
  },
] as const;

export function MobileBottomNav({ accessibleAppIds }: { accessibleAppIds: string[] }) {
  const pathname = usePathname();
  const { setMobileOpen, mobileOpen } = useShell();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const allowed = new Set(accessibleAppIds);

  const links = PRIMARY_LINKS.filter((l) => allowed.has(l.appId));

  if (links.length === 0 || mobileOpen) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md lg:hidden"
      aria-label={tCommon("primaryNav")}
    >
      <div
        className="mx-auto flex max-w-lg items-stretch justify-around"
        style={{ minHeight: "var(--mobile-nav-height)" }}
      >
        {links.map(({ href, labelKey, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "touch-target flex h-[var(--mobile-nav-height)] min-w-[4rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors active:scale-95",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0", active && "stroke-[2.5]")} />
              <span className="truncate">{t(labelKey)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="touch-target flex h-[var(--mobile-nav-height)] min-w-[4rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-muted-foreground active:scale-95"
          aria-label={tCommon("openFullMenu")}
        >
          <Menu className="h-5 w-5 shrink-0" />
          <span>{tCommon("menu")}</span>
        </button>
      </div>
    </nav>
  );
}
