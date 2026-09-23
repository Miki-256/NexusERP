import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getMemberPermissions } from "@/lib/org-context";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardPageSkeleton } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { ErpAppId } from "@/lib/app-permissions";
import {
  DashboardFinancialPanel,
  DashboardKpis,
  DashboardRecentSales,
  DashboardSalesTrend,
  DashboardSidebar,
} from "./dashboard-sections";
import { loadDashboardBundle } from "./dashboard-bundle";
import { DashboardPageHeader } from "./dashboard-page-header";
import { ShoppingCart, Receipt, Package } from "lucide-react";

const AppsLauncher = dynamic(
  () => import("@/components/layout/apps-launcher").then((m) => m.AppsLauncher),
  { loading: () => <Skeleton className="h-32 rounded-lg" /> }
);

function DashboardDataSkeleton() {
  return (
    <div className={PAGE_SHELL}>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
      <div className="grid gap-3 lg:grid-cols-3 lg:gap-4">
        <div className={`${PAGE_SHELL} lg:col-span-2`}>
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

function DashboardQuickActions({
  canAccessSales,
  canAccessPurchasing,
}: {
  canAccessSales: boolean;
  canAccessPurchasing: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 lg:hidden">
      <Button asChild size="sm" className="h-9 justify-center">
        <Link href="/pos">
          <ShoppingCart className="h-3.5 w-3.5" />
          POS
        </Link>
      </Button>
      {canAccessSales && (
        <Button asChild size="sm" variant="outline" className="h-9 justify-center">
          <Link href="/sales">
            <Receipt className="h-3.5 w-3.5" />
            Sales
          </Link>
        </Button>
      )}
      {canAccessPurchasing && (
        <Button asChild size="sm" variant="outline" className="h-9 justify-center">
          <Link href="/purchasing">
            <Package className="h-3.5 w-3.5" />
            Buy
          </Link>
        </Button>
      )}
    </div>
  );
}

async function DashboardBody({
  orgId,
  currency,
  canAccessAccounting,
  accessibleApps,
}: {
  orgId: string;
  currency: string;
  canAccessAccounting: boolean;
  accessibleApps: ErpAppId[];
}) {
  const bundle = await loadDashboardBundle(orgId, {
    includeAccounting: canAccessAccounting,
    includeExpenses: accessibleApps.includes("expenses"),
  });

  return (
    <>
      <DashboardKpis bundle={bundle} currency={currency} canAccessAccounting={canAccessAccounting} />

      <DashboardQuickActions
        canAccessSales={accessibleApps.includes("sales")}
        canAccessPurchasing={accessibleApps.includes("purchasing")}
      />

      {canAccessAccounting && (
        <div className="hidden lg:block">
          <DashboardFinancialPanel bundle={bundle} currency={currency} />
        </div>
      )}

      {canAccessAccounting && (
        <details className="rounded-lg border border-border bg-card lg:hidden">
          <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
            Financial performance
          </summary>
          <div className="border-t border-border p-2">
            <DashboardFinancialPanel bundle={bundle} currency={currency} />
          </div>
        </details>
      )}

      <div className="grid gap-2 sm:gap-3 lg:grid-cols-3 lg:gap-3">
        <div className={`${PAGE_SHELL} lg:col-span-2`}>
          <DashboardRecentSales bundle={bundle} currency={currency} />
          <details className="rounded-lg border border-border bg-card lg:hidden">
            <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium marker:content-none [&::-webkit-details-marker]:hidden">
              Analytics
            </summary>
            <div className="border-t border-border p-2">
              <DashboardSalesTrend bundle={bundle} currency={currency} />
            </div>
          </details>
          <div className="hidden lg:block">
            <DashboardSalesTrend bundle={bundle} currency={currency} />
          </div>
        </div>
        <div className="hidden lg:block">
          <DashboardSidebar bundle={bundle} currency={currency} accessibleApps={accessibleApps} />
        </div>
      </div>
    </>
  );
}

async function DashboardPageContent() {
  const ctx = await getMemberPermissions();
  if (!ctx) redirect("/onboarding");

  const orgId = ctx.organization.id;
  const currency = ctx.organization.currency?.trim() || "ETB";
  const canAccessAccounting = ctx.canAccessApp("accounting");
  const accessibleApps = Array.from(ctx.accessibleApps) as ErpAppId[];

  return (
    <div className={PAGE_SHELL}>
      <DashboardPageHeader
        orgName={ctx.organization.name}
        canAccessAccounting={canAccessAccounting}
      />

      <Suspense fallback={<DashboardDataSkeleton />}>
        <DashboardBody
          orgId={orgId}
          currency={currency}
          canAccessAccounting={canAccessAccounting}
          accessibleApps={accessibleApps}
        />
      </Suspense>

      <details className="border-t border-border/60 pt-3 lg:pt-4">
        <summary className="cursor-pointer list-none text-[13px] font-medium text-muted-foreground marker:content-none hover:text-foreground [&::-webkit-details-marker]:hidden">
          All modules
        </summary>
        <div className="mt-3">
          <AppsLauncher accessibleAppIds={Array.from(ctx.accessibleApps)} compact pinned />
        </div>
      </details>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardPageSkeleton />}>
      <DashboardPageContent />
    </Suspense>
  );
}
