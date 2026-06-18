"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CartLine } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PROVIDERS = [
  { value: "telebirr", label: "Telebirr" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "cbe_birr", label: "CBE Birr" },
  { value: "m_pesa", label: "M-Pesa (alt)" },
  { value: "other", label: "Other" },
] as const;

type PaymentRow = {
  method: "cash" | "mobile_money" | "bank_transfer";
  amount: number;
  cashTendered?: number;
  changeGiven?: number;
  provider?: string;
  reference?: string;
  phone?: string;
  bankName?: string;
};

export function PaymentModal({
  total,
  currency,
  lines,
  cartDiscount,
  registerId,
  storeId,
  sessionId,
  organizationId,
  onClose,
  onComplete,
}: {
  total: number;
  currency: string;
  lines: CartLine[];
  cartDiscount: number;
  registerId: string;
  storeId: string;
  sessionId: string;
  organizationId: string;
  onClose: () => void;
  onComplete: (result: {
    receipt_no: string;
    total: number;
    sale_id: string;
  }) => void;
}) {
  const [method, setMethod] = useState<"cash" | "mobile_money" | "bank_transfer">(
    "cash"
  );
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [cashTendered, setCashTendered] = useState("");
  const [reference, setReference] = useState("");
  const [provider, setProvider] = useState("telebirr");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, total - paid);

  function addPayment() {
    const amt = parseFloat(amount) || remaining;
    if (amt <= 0) return;

    if (method === "cash") {
      const tendered = parseFloat(cashTendered) || amt;
      const change = Math.max(0, tendered - amt);
      setPayments([
        ...payments,
        {
          method: "cash",
          amount: amt,
          cashTendered: tendered,
          changeGiven: change,
        },
      ]);
    } else if (method === "mobile_money") {
      if (!reference.trim()) {
        setError("Transaction reference is required");
        return;
      }
      setPayments([
        ...payments,
        {
          method: "mobile_money",
          amount: amt,
          provider,
          reference: reference.trim(),
          phone: phone || undefined,
        },
      ]);
    } else {
      if (!reference.trim()) {
        setError("Transfer reference is required");
        return;
      }
      setPayments([
        ...payments,
        {
          method: "bank_transfer",
          amount: amt,
          reference: reference.trim(),
          bankName: bankName || undefined,
        },
      ]);
    }
    setAmount("");
    setCashTendered("");
    setReference("");
    setError(null);
  }

  async function completeSale() {
    if (Math.abs(paid - total) > 0.01 && payments.length === 0) {
      setError("Add payments that match the total");
      return;
    }
    const finalPayments =
      payments.length > 0
        ? payments
        : [
            {
              method: "cash" as const,
              amount: total,
              cashTendered: parseFloat(cashTendered) || total,
              changeGiven: Math.max(
                0,
                (parseFloat(cashTendered) || total) - total
              ),
            },
          ];

    const payTotal = finalPayments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(payTotal - total) > 0.01) {
      setError(`Payment total ${payTotal} must equal ${total}`);
      return;
    }

    setLoading(true);
    setError(null);
    const supabase = createClient();
    const idempotencyKey = crypto.randomUUID();

    const rpcPayments = finalPayments.map((p) => {
      if (p.method === "cash") {
        return {
          method: "cash",
          amount: p.amount,
          cashTendered: p.cashTendered,
          changeGiven: p.changeGiven,
        };
      }
      if (p.method === "mobile_money") {
        return {
          method: "mobile_money",
          amount: p.amount,
          provider: p.provider,
          reference: p.reference,
          phone: p.phone,
        };
      }
      return {
        method: "bank_transfer",
        amount: p.amount,
        reference: p.reference,
        bankName: p.bankName,
      };
    });

    const rpcLines = lines.map((l) => ({
      variantId: l.variantId,
      productName: l.productName,
      variantName: l.variantName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountAmount: l.discountAmount,
    }));

    const { data, error: rpcError } = await supabase.rpc("complete_sale", {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_register_id: registerId,
      p_session_id: sessionId,
      p_idempotency_key: idempotencyKey,
      p_lines: rpcLines,
      p_discount_amount: cartDiscount,
      p_customer_name: null,
      p_customer_phone: null,
      p_payments: rpcPayments,
    });

    setLoading(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const result = data as {
      sale_id: string;
      receipt_no: string;
      total: number;
      duplicate?: boolean;
    };

    onComplete({
      sale_id: result.sale_id,
      receipt_no: result.receipt_no,
      total: result.total,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold mb-1">Payment</h2>
        <p className="text-2xl font-bold text-primary mb-4">
          {formatCurrency(total, currency)}
        </p>
        {remaining > 0.01 && payments.length > 0 && (
          <p className="text-sm text-amber-600 mb-2">
            Remaining: {formatCurrency(remaining, currency)}
          </p>
        )}

        <div className="flex gap-2 mb-4">
          {(["cash", "mobile_money", "bank_transfer"] as const).map((m) => (
            <Button
              key={m}
              variant={method === m ? "default" : "outline"}
              size="sm"
              onClick={() => setMethod(m)}
              className="capitalize"
            >
              {m.replace("_", " ")}
            </Button>
          ))}
        </div>

        <div className="space-y-3 mb-4">
          <div className="space-y-2">
            <Label>Amount</Label>
            <Input
              type="number"
              placeholder={String(remaining || total)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {method === "cash" && (
            <div className="space-y-2">
              <Label>Cash tendered</Label>
              <Input
                type="number"
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
              />
            </div>
          )}
          {method === "mobile_money" && (
            <>
              <div className="space-y-2">
                <Label>Provider</Label>
                <select
                  className="flex h-10 w-full rounded-md border px-3 text-sm"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Transaction ID *</Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone (optional)</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </>
          )}
          {method === "bank_transfer" && (
            <>
              <div className="space-y-2">
                <Label>Reference *</Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Bank name</Label>
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </div>
            </>
          )}
          <Button variant="secondary" onClick={addPayment} className="w-full">
            Add payment
          </Button>
        </div>

        {payments.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm border rounded p-2">
            {payments.map((p, i) => (
              <li key={i} className="flex justify-between capitalize">
                <span>{p.method.replace("_", " ")}</span>
                <span>{formatCurrency(p.amount, currency)}</span>
              </li>
            ))}
            <li className="flex justify-between font-bold border-t pt-1">
              <span>Paid</span>
              <span>{formatCurrency(paid, currency)}</span>
            </li>
          </ul>
        )}

        {error && <p className="text-sm text-destructive mb-2">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            size="lg"
            disabled={loading}
            onClick={completeSale}
          >
            {loading ? "Processing…" : "Complete sale"}
          </Button>
        </div>
      </div>
    </div>
  );
}
