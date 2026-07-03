"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/layout/status-badge";
import { FormCard } from "@/components/layout/form-card";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { SalesActions } from "@/app/(tenant)/sales/sales-actions";
import { useToast } from "@/components/ui/toast";
import type { SaleDetailBundle, SaleDetailLine } from "@/lib/sales-register";
import { Mail, RotateCcw } from "lucide-react";

type RefundMethod = "cash" | "store_credit";

export function SaleDetailClient({
  bundle,
  currency,
  orgName,
  receiptFooter,
  canManage,
}: {
  bundle: SaleDetailBundle;
  currency: string;
  orgName: string;
  receiptFooter?: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const sale = bundle.sale;
  const lines = bundle.lines as SaleDetailLine[];
  const payments = bundle.payments;
  const returns = bundle.returns;
  const audit = bundle.audit;

  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);

  const money = (n: number) => formatCurrency(n, currency);
  const hasPending = payments.some((p) => p.status === "pending");
  const canReturn = canManage && (sale.status === "completed" || sale.status === "returned");

  const returnLines = useMemo(
    () =>
      lines
        .map((line) => ({
          saleLineId: line.id,
          quantity: returnQty[line.id] ?? 0,
          line,
        }))
        .filter((e) => e.quantity > 0),
    [lines, returnQty]
  );

  const estimatedRefund = useMemo(
    () =>
      returnLines.reduce((sum, entry) => {
        const { line, quantity } = entry;
        if (line.quantity <= 0) return sum;
        return sum + line.line_total * (quantity / line.quantity);
      }, 0),
    [returnLines]
  );

  async function confirmPayment(paymentId: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("confirm_sale_payment_backoffice", {
      p_payment_id: paymentId,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not confirm payment", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Payment confirmed" });
    router.refresh();
  }

  async function submitReturn() {
    const reason = returnReason.trim();
    if (!reason) {
      toast({ title: "Enter a reason", variant: "destructive" });
      return;
    }
    if (returnLines.length === 0) {
      toast({ title: "Select items to return", variant: "destructive" });
      return;
    }
    if (refundMethod === "store_credit" && !sale.customer_id) {
      toast({ title: "Customer required for store credit", variant: "destructive" });
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("partial_return_sale_backoffice", {
      p_sale_id: sale.id as string,
      p_lines: returnLines.map((e) => ({
        saleLineId: e.saleLineId,
        quantity: e.quantity,
      })),
      p_reason: reason,
      p_refund_method: refundMethod,
    });
    setBusy(false);

    if (error) {
      toast({ title: "Return failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Return processed", description: money(estimatedRefund) });
    setShowReturnForm(false);
    setReturnReason("");
    setReturnQty({});
    router.refresh();
  }

  function shareReceipt() {
    const subject = encodeURIComponent(`Receipt ${sale.receipt_no}`);
    const body = encodeURIComponent(
      `${orgName}\nReceipt: ${sale.receipt_no}\nDate: ${new Date(sale.created_at).toLocaleString()}\nTotal: ${money(sale.total)}\n\nView in NexusERP: ${window.location.href}`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <FormCard title="Sale info">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Store</dt>
              <dd className="font-medium">{sale.store_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Register</dt>
              <dd className="font-medium">{sale.register_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cashier</dt>
              <dd className="font-medium">{sale.staff_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Customer</dt>
              <dd className="font-medium">
                {sale.customer_id ? (
                  <Link href={`/customers?highlight=${sale.customer_id}`} className="text-primary hover:underline">
                    {String(
                      sale.customer_linked_name ??
                        sale.customer_name ??
                        sale.customer_phone ??
                        "Linked customer"
                    )}
                  </Link>
                ) : (
                  sale.customer_name ?? sale.customer_phone ?? "Walk-in"
                )}
              </dd>
            </div>
            {(sale.promotion_name || sale.promotion_code) && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Promotion</dt>
                <dd className="font-medium">
                  {String(sale.promotion_name ?? "")}
                  {sale.promotion_code ? ` (${String(sale.promotion_code)})` : ""}
                </dd>
              </div>
            )}
            {Number(sale.tip_amount) > 0 && (
              <div>
                <dt className="text-muted-foreground">Tip</dt>
                <dd className="font-medium">{money(Number(sale.tip_amount))}</dd>
              </div>
            )}
            {sale.void_reason && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="font-medium">{sale.void_reason}</dd>
              </div>
            )}
          </dl>
        </FormCard>

        <FormCard title="Line items">
          <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Subtotal</p>
              <p className="font-mono font-medium">{money(sale.subtotal)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tax</p>
              <p className="font-mono font-medium">{money(sale.tax_amount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Discount</p>
              <p className="font-mono font-medium">{money(sale.discount_amount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total</p>
              <p className="font-mono text-lg font-bold">{money(sale.total)}</p>
            </div>
          </div>
          <ul className="divide-y rounded-lg border">
            {lines.map((line) => {
              const available = line.quantity - (line.returned_quantity ?? 0);
              return (
                <li key={line.id} className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-medium">{line.product_name}</p>
                      {line.variant_name && line.variant_name !== "Default" && (
                        <p className="text-xs text-muted-foreground">{line.variant_name}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {money(line.unit_price)} × {line.quantity}
                        {(line.returned_quantity ?? 0) > 0 && (
                          <span className="text-amber-700"> · {line.returned_quantity} returned</span>
                        )}
                      </p>
                    </div>
                    <span className="font-mono font-medium">{money(line.line_total)}</span>
                  </div>
                  {showReturnForm && available > 0 && canReturn && (
                    <div className="mt-2 flex items-center gap-2">
                      <Label className="text-xs">Return qty (max {available})</Label>
                      <Input
                        type="number"
                        min={0}
                        max={available}
                        className="h-8 w-20"
                        value={returnQty[line.id] ?? 0}
                        onChange={(e) =>
                          setReturnQty((prev) => ({
                            ...prev,
                            [line.id]: Math.min(available, Math.max(0, parseInt(e.target.value, 10) || 0)),
                          }))
                        }
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </FormCard>

        {returns.length > 0 && (
          <FormCard title="Return history">
            <ul className="divide-y rounded-lg border">
              {returns.map((ret) => (
                <li key={ret.id} className="px-4 py-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium capitalize">{ret.refund_method.replace(/_/g, " ")}</span>
                    <span className="font-mono">{money(ret.total)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ret.created_at).toLocaleString()} · {ret.reason}
                  </p>
                </li>
              ))}
            </ul>
          </FormCard>
        )}

        {audit.length > 0 && (
          <FormCard title="Activity">
            <ul className="space-y-3">
              {audit.map((entry) => (
                <li key={entry.id} className="flex gap-3 text-sm">
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div>
                    <p className="font-medium capitalize">{entry.action.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          </FormCard>
        )}
      </div>

      <div className="space-y-6">
        <FormCard title="Payments">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment records.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium capitalize">{p.method.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.reference && `Ref: ${p.reference} · `}
                      {new Date(p.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{money(p.amount)}</span>
                    <StatusBadge status={p.status} />
                    {canManage && p.status === "pending" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => confirmPayment(p.id)}>
                        Confirm
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasPending && (
            <p className="mt-2 text-xs text-amber-700">One or more mobile money payments are still pending.</p>
          )}
        </FormCard>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={shareReceipt}>
            <Mail className="h-3.5 w-3.5" />
            Share receipt
          </Button>
          {canManage && canReturn && sale.status === "completed" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowReturnForm((v) => !v)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {showReturnForm ? "Cancel return" : "Partial return"}
            </Button>
          )}
          {canManage && sale.status === "completed" && <SalesActions saleId={sale.id as string} />}
        </div>

        {showReturnForm && canReturn && (
          <FormCard title="Process partial return">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Reason</Label>
                <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Damaged item, wrong size…" />
              </div>
              <div className="space-y-2">
                <Label>Refund method</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value as RefundMethod)}
                >
                  <option value="cash">Cash</option>
                  <option value="store_credit" disabled={!sale.customer_id}>
                    Store credit{!sale.customer_id ? " (needs customer)" : ""}
                  </option>
                </select>
              </div>
              <p className="text-sm text-muted-foreground">
                Estimated refund: <span className="font-mono font-medium">{money(estimatedRefund)}</span>
              </p>
              <Button disabled={busy || returnLines.length === 0} onClick={submitReturn}>
                {busy ? "Processing…" : "Submit return"}
              </Button>
            </div>
          </FormCard>
        )}

        <ReceiptPrint
          sale={{
            receipt_no: sale.receipt_no,
            created_at: sale.created_at,
            subtotal: sale.subtotal,
            tax_amount: sale.tax_amount,
            discount_amount: sale.discount_amount,
            tip_amount: Number(sale.tip_amount) || 0,
            total: sale.total,
            status: sale.status,
          }}
          lines={lines.map((l) => ({
            product_name: l.product_name,
            variant_name: l.variant_name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            line_total: l.line_total,
          }))}
          payments={payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            reference: p.reference,
            cash_tendered: p.cash_tendered,
            change_given: p.change_given,
          }))}
          orgName={orgName}
          storeName={(sale.store_name as string) ?? ""}
          currency={currency}
          footer={receiptFooter ?? null}
          saleId={sale.id as string}
          pollPaymentStatus={hasPending}
        />
      </div>
    </div>
  );
}
