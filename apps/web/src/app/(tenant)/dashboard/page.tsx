import { Suspense } from "react";
import dynamic from "next/dynamic";
import { getMemberPermissions } from "@/lib/org-context";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardPageSkeleton } from "@/components/ui/loading";
import { ShoppingCart, FileSpreadsheet } from "lucide-react";
import type { ErpAppId } from "@/lib/app-permissions";
import {
  DashboardFinancialPanel,
  DashboardKpis,
  DashboardRecentSales,
  DashboardSalesTrend,
  DashboardSidebar,
} from "./dashboard-sections";
import { loadDashboardBundle } from "./dashboard-bundle";

const AppsLauncher = dynamic(
  () => import("@/components/layout/apps-launcher").then((m) => m.AppsLauncher),
  { loading: () => <Skeleton className="h-48 rounded-lg" /> }
);

function DashboardDataSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[100px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-lg" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </div>
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

      {canAccessAccounting && <DashboardFinancialPanel bundle={bundle} currency={currency} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <DashboardSalesTrend bundle={bundle} currency={currency} />
          <DashboardRecentSales bundle={bundle} currency={currency} />
        </div>
        <DashboardSidebar bundle={bundle} currency={currency} accessibleApps={accessibleApps} />
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
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Executive overview"
        title={`${ctx.organization.name} — Dashboard`}
        description={
          canAccessAccounting
            ? "Real-time POS performance, ledger profitability, cash position, and receivables at a glance."
            : "Real-time POS performance and sales activity at a glance."
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports">
                <FileSpreadsheet className="h-4 w-4" />
                Export reports
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/pos">
                <ShoppingCart className="h-4 w-4" />
                Open POS
              </Link>
            </Button>
          </div>
        }
      />

      <Suspense fallback={<DashboardDataSkeleton />}>
        <DashboardBody
          orgId={orgId}
          currency={currency}
          canAccessAccounting={canAccessAccounting}
          accessibleApps={accessibleApps}
        />
      </Suspense>

      <div className="border-t border-border/60 pt-10">
        <AppsLauncher accessibleAppIds={Array.from(ctx.accessibleApps)} compact />
      </div>
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
