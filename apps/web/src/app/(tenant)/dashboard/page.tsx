import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, relationName } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) return null;

  const supabase = await createClient();
  const { data: stats } = await supabase.rpc("dashboard_stats", {
    p_organization_id: ctx.organization.id,
  });

  const s = (stats ?? {}) as {
    sales_total?: number;
    transaction_count?: number;
    cash_total?: number;
    mobile_total?: number;
    bank_total?: number;
  };

  const { data: registers } = await supabase
    .from("registers")
    .select("id, name, stores(name)")
    .eq("organization_id", ctx.organization.id)
    .eq("is_active", true);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Today&apos;s overview</p>
        </div>
        <Button asChild>
          <Link href="/pos">Open POS</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sales today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(s.sales_total ?? 0, ctx.organization.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{s.transaction_count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cash
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(s.cash_total ?? 0, ctx.organization.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Mobile money
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(s.mobile_total ?? 0, ctx.organization.currency)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registers</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(registers ?? []).map((reg) => (
              <li
                key={reg.id}
                className="flex items-center justify-between py-3"
              >
                <span>
                  {reg.name}{" "}
                  <span className="text-muted-foreground">
                    — {relationName(reg.stores as { name: string } | { name: string }[])}
                  </span>
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/pos/${reg.id}`}>Start selling</Link>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
