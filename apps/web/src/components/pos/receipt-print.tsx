"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print-document";
import { createClient } from "@/lib/supabase/client";
import { isEscPosEnabled, printEscPosReceipt } from "@/lib/pos/escpos-print";
import { getPosAutoPrint } from "@/lib/pos/pos-preferences";

type ReceiptProps = {
  sale: {
    receipt_no: string;
    created_at: string;
    subtotal: number;
    tax_amount: number;
    discount_amount: number;
    tip_amount?: number;
    total: number;
    status: string;
  };
  lines: {
    product_name: string;
    variant_name: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
  payments: {
    method: string;
    amount: number;
    reference: string | null;
    cash_tendered: number | null;
    change_given: number | null;
    status?: string;
    webhook_confirmed_at?: string | null;
  }[];
  orgName: string;
  storeName: string;
  currency: string;
  footer: string | null;
  saleId?: string;
  sessionToken?: string | null;
  pollPaymentStatus?: boolean;
  autoPrint?: boolean;
  registerId?: string;
  onPaymentsUpdate?: (payments: ReceiptProps["payments"]) => void;
};

export function ReceiptPrint({
  sale,
  lines,
  payments,
  orgName,
  storeName,
  currency,
  footer,
  saleId,
  sessionToken,
  pollPaymentStatus = false,
  autoPrint = false,
  registerId,
  onPaymentsUpdate,
}: ReceiptProps) {
  const [escposMsg, setEscposMsg] = useState<string | null>(null);
  const [livePayments, setLivePayments] = useState(payments);
  const receiptRef = useRef<HTMLDivElement>(null);
  const autoPrintedRef = useRef(false);

  useEffect(() => {
    setLivePayments(payments);
  }, [payments]);

  useEffect(() => {
    if (!pollPaymentStatus || !saleId) return;

    const supabase = createClient();
    const id = window.setInterval(() => {
      void supabase
        .rpc("get_pos_sale_receipt", {
          p_sale_id: saleId,
          p_session_token: sessionToken ?? null,
        })
        .then(({ data }) => {
          if (!data) return;
          const payload = data as { payments?: ReceiptProps["payments"] };
          if (payload.payments) {
            setLivePayments(payload.payments);
            onPaymentsUpdate?.(payload.payments);
          }
        });
    }, 5000);

    return () => clearInterval(id);
  }, [pollPaymentStatus, saleId, sessionToken]);

  useEffect(() => {
    if (!isEscPosEnabled()) return;
    void printEscPosReceipt({
      orgName,
      storeName,
      currency,
      receiptNo: sale.receipt_no,
      createdAt: sale.created_at,
      lines,
      subtotal: sale.subtotal,
      tax: sale.tax_amount,
      discount: sale.discount_amount,
      tip: sale.tip_amount ?? 0,
      total: sale.total,
      payments: payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        reference: p.reference,
      })),
      footer,
    }).then((r) => {
      if (!r.ok) setEscposMsg(r.message ?? "ESC/POS print failed");
    });
  }, [sale, lines, payments, orgName, storeName, currency, footer]);

  function handlePrint() {
    const html = receiptRef.current?.innerHTML;
    if (html) {
      printHtmlDocument(`Receipt ${sale.receipt_no}`, html);
      return;
    }
    window.print();
  }

  useEffect(() => {
    if (!autoPrint || autoPrintedRef.current) return;
    const enabled = registerId ? getPosAutoPrint(registerId) : true;
    if (!enabled) return;
    autoPrintedRef.current = true;
    const id = window.setTimeout(() => handlePrint(), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, registerId, sale.receipt_no]);

  return (
    <div>
      <Button onClick={handlePrint} className="no-print mb-4">
        Print receipt
      </Button>
      {escposMsg && (
        <p className="no-print mb-2 text-xs text-amber-700">{escposMsg}</p>
      )}
      <div
        ref={receiptRef}
        className="receipt-print mx-auto max-w-xs rounded border bg-white p-4 font-mono text-xs text-black"
      >
        <p className="text-center font-bold">{orgName}</p>
        <p className="text-center">{storeName}</p>
        <p className="text-center text-[10px]">
          {new Date(sale.created_at).toLocaleString()}
        </p>
        <p className="text-center">#{sale.receipt_no}</p>
        {sale.status === "pending_sync" && (
          <p className="mt-1 text-center text-[10px] font-semibold text-amber-700">
            Pending sync — will update when online
          </p>
        )}
        <hr className="my-2 border-dashed border-black" />
        {lines.map((line, i) => (
          <div key={i} className="mb-1">
            <div className="flex justify-between">
              <span>
                {line.product_name}
                {line.variant_name && line.variant_name !== "Default"
                  ? ` (${line.variant_name})`
                  : ""}
              </span>
              <span>{formatCurrency(line.line_total, currency)}</span>
            </div>
            <div className="text-[10px] text-gray-600">
              {line.quantity} × {formatCurrency(line.unit_price, currency)}
            </div>
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatCurrency(sale.subtotal, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax</span>
          <span>{formatCurrency(sale.tax_amount, currency)}</span>
        </div>
        {sale.discount_amount > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{formatCurrency(sale.discount_amount, currency)}</span>
          </div>
        )}
        {(sale.tip_amount ?? 0) > 0 && (
          <div className="flex justify-between">
            <span>Tip</span>
            <span>{formatCurrency(sale.tip_amount!, currency)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold">
          <span>TOTAL</span>
          <span>{formatCurrency(sale.total, currency)}</span>
        </div>
        <hr className="my-2 border-dashed border-black" />
        {livePayments.map((p, i) => (
          <div key={i}>
            <div className="flex justify-between capitalize">
              <span>
                {p.method.replace("_", " ")}
                {p.reference ? ` (${p.reference})` : ""}
              </span>
              <span>{formatCurrency(p.amount, currency)}</span>
            </div>
            {p.method === "mobile_money" && p.status === "pending" && !p.webhook_confirmed_at && (
              <p className="text-[10px] text-amber-700">Awaiting provider confirmation</p>
            )}
            {p.webhook_confirmed_at && (
              <p className="text-[10px] text-emerald-700">
                Confirmed {new Date(p.webhook_confirmed_at).toLocaleTimeString()}
              </p>
            )}
          </div>
        ))}
        {livePayments.some((p) => p.change_given) && (
          <div className="flex justify-between">
            <span>Change</span>
            <span>
              {formatCurrency(
                livePayments.find((p) => p.change_given)?.change_given ?? 0,
                currency
              )}
            </span>
          </div>
        )}
        {footer && (
          <p className="mt-4 text-center text-[10px]">{footer}</p>
        )}
        <p className="mt-2 text-center text-[10px]">Thank you!</p>
      </div>
    </div>
  );
}
