import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ReportsPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data: stats } = await supabase.rpc("dashboard_stats", {
    p_organization_id: ctx.organization.id,
  });

  const s = (stats ?? {}) as Record<string, number>;

  const { data: sessions } = await supabase
    .from("register_sessions")
    .select("*, registers(name, stores(name))")
    .eq("organization_id", ctx.organization.id)
    .order("opened_at", { ascending: false })
    .limit(20);

  const { data: audit } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reports</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Today sales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">
              {formatCurrency(s.sales_total ?? 0, ctx.organization.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Cash</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">
              {formatCurrency(s.cash_total ?? 0, ctx.organization.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Mobile + Bank
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">
              {formatCurrency(
                (s.mobile_total ?? 0) + (s.bank_total ?? 0),
                ctx.organization.currency
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent shifts</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left">Register</th>
                <th className="p-2 text-left">Opened</th>
                <th className="p-2 text-left">Closed</th>
                <th className="p-2 text-right">Float</th>
                <th className="p-2 text-right">Counted</th>
              </tr>
            </thead>
            <tbody>
              {(sessions ?? []).map((sess) => {
                const regRaw = sess.registers as
                  | { name: string; stores: { name: string } | { name: string }[] }
                  | { name: string; stores: { name: string } | { name: string }[] }[];
                const reg = Array.isArray(regRaw) ? regRaw[0] : regRaw;
                const storeRel = reg?.stores;
                const storeName = Array.isArray(storeRel)
                  ? storeRel[0]?.name
                  : storeRel?.name;
                return (
                  <tr key={sess.id} className="border-b">
                    <td className="p-2">
                      {reg?.name} — {storeName}
                    </td>
                    <td className="p-2">
                      {new Date(sess.opened_at).toLocaleString()}
                    </td>
                    <td className="p-2">
                      {sess.closed_at
                        ? new Date(sess.closed_at).toLocaleString()
                        : "Open"}
                    </td>
                    <td className="p-2 text-right">{sess.opening_float}</td>
                    <td className="p-2 text-right">
                      {sess.closing_cash_counted ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {(audit ?? []).map((a) => (
              <li key={a.id} className="text-muted-foreground">
                {new Date(a.created_at).toLocaleString()} — {a.action} on{" "}
                {a.entity_type}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
