"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  Store,
  BarChart3,
  Settings,
  ShoppingCart,
  Receipt,
  Users,
  Wallet,
  Landmark,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/inventory", label: "Inventory", icon: Warehouse },
  { href: "/sales", label: "Sales", icon: Receipt },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/financials", label: "Financials", icon: Landmark },
  { href: "/stores", label: "Stores", icon: Store },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  orgName,
  canManageTeam,
}: {
  orgName: string;
  canManageTeam: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const visibleLinks = links.filter(
    (l) => l.href !== "/team" || canManageTeam
  );

  return (
    <aside className="flex w-56 flex-col border-r bg-card">
      <div className="border-b p-4">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Organization
        </p>
        <p className="truncate font-semibold">{orgName}</p>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {visibleLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
        <Link
          href="/pos"
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
            pathname.startsWith("/pos")
              ? "bg-emerald-600 text-white"
              : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          )}
        >
          <ShoppingCart className="h-4 w-4" />
          Open POS
        </Link>
      </nav>
      <div className="border-t p-2">
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
