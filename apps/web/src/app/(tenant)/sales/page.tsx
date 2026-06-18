import { getCurrentMembership, canManage } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { formatCurrency, relationName } from "@/lib/utils";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { SalesActions } from "./sales-actions";

export default async function SalesPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data: sales } = await supabase
    .from("sales")
    .select("id, receipt_no, total, status, created_at, stores(name)")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sales</h1>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left">Receipt</th>
                <th className="p-3 text-left">Store</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {(sales ?? []).map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="p-3">
                    <Link
                      href={`/sales/${s.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.receipt_no}
                    </Link>
                  </td>
                  <td className="p-3">
                    {relationName(s.stores as { name: string } | { name: string }[])}
                  </td>
                  <td className="p-3 text-right">
                    {formatCurrency(s.total, ctx.organization.currency)}
                  </td>
                  <td className="p-3 capitalize">{s.status}</td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                  <td className="p-3">
                    {canManage(ctx.member.role) && s.status === "completed" && (
                      <SalesActions saleId={s.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
