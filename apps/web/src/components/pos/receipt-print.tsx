"use client";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

type ReceiptProps = {
  sale: {
    receipt_no: string;
    created_at: string;
    subtotal: number;
    tax_amount: number;
    discount_amount: number;
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
  }[];
  orgName: string;
  storeName: string;
  currency: string;
  footer: string | null;
};

export function ReceiptPrint({
  sale,
  lines,
  payments,
  orgName,
  storeName,
  currency,
  footer,
}: ReceiptProps) {
  function handlePrint() {
    window.print();
  }

  return (
    <div>
      <Button onClick={handlePrint} className="no-print mb-4">
        Print receipt
      </Button>
      <div className="receipt-print mx-auto max-w-xs rounded border bg-white p-4 font-mono text-xs text-black">
        <p className="text-center font-bold">{orgName}</p>
        <p className="text-center">{storeName}</p>
        <p className="text-center text-[10px]">
          {new Date(sale.created_at).toLocaleString()}
        </p>
        <p className="text-center">#{sale.receipt_no}</p>
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
        <div className="flex justify-between font-bold">
          <span>TOTAL</span>
          <span>{formatCurrency(sale.total, currency)}</span>
        </div>
        <hr className="my-2 border-dashed border-black" />
        {payments.map((p, i) => (
          <div key={i} className="flex justify-between capitalize">
            <span>
              {p.method.replace("_", " ")}
              {p.reference ? ` (${p.reference})` : ""}
            </span>
            <span>{formatCurrency(p.amount, currency)}</span>
          </div>
        ))}
        {payments.some((p) => p.change_given) && (
          <div className="flex justify-between">
            <span>Change</span>
            <span>
              {formatCurrency(
                payments.find((p) => p.change_given)?.change_given ?? 0,
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
