import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReceiptPrint } from "@/components/pos/receipt-print";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data: sale } = await supabase
    .from("sales")
    .select(
      "*, stores(name, address), sale_lines(*), payments(*), organizations(name, currency, receipt_footer, tax_id)"
    )
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .single();

  if (!sale) notFound();

  const org = sale.organizations as {
    name: string;
    currency: string;
    receipt_footer: string | null;
    tax_id: string | null;
  };
  const storeRaw = sale.stores as
    | { name: string; address: string | null }
    | { name: string; address: string | null }[];
  const store = Array.isArray(storeRaw) ? storeRaw[0] : storeRaw;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sale {sale.receipt_no}</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Status: {sale.status}</p>
            <p>Total: {formatCurrency(sale.total, org.currency)}</p>
            <p>Subtotal: {formatCurrency(sale.subtotal, org.currency)}</p>
            <p>Tax: {formatCurrency(sale.tax_amount, org.currency)}</p>
            <ul className="mt-4 divide-y">
              {(sale.sale_lines as { product_name: string; quantity: number; line_total: number }[]).map(
                (line, i) => (
                  <li key={i} className="flex justify-between py-2">
                    <span>
                      {line.product_name} × {line.quantity}
                    </span>
                    <span>{formatCurrency(line.line_total, org.currency)}</span>
                  </li>
                )
              )}
            </ul>
          </CardContent>
        </Card>
        <ReceiptPrint
          sale={{
            receipt_no: sale.receipt_no,
            created_at: sale.created_at,
            subtotal: sale.subtotal,
            tax_amount: sale.tax_amount,
            discount_amount: sale.discount_amount,
            total: sale.total,
            status: sale.status,
          }}
          lines={
            sale.sale_lines as {
              product_name: string;
              variant_name: string | null;
              quantity: number;
              unit_price: number;
              line_total: number;
            }[]
          }
          payments={
            sale.payments as {
              method: string;
              amount: number;
              reference: string | null;
              cash_tendered: number | null;
              change_given: number | null;
            }[]
          }
          orgName={org.name}
          storeName={store.name}
          currency={org.currency}
          footer={org.receipt_footer}
        />
      </div>
    </div>
  );
}
