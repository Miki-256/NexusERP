"use client";

import { useRef } from "react";
import { formatCurrency } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print-document";
import { Button } from "@/components/ui/button";

export type ZReportData = {
  registerName: string;
  storeName: string;
  orgName: string;
  currency: string;
  openedAt: string;
  activeStaffName: string | null;
  saleCount: number;
  voidCount: number;
  grossTotal: number;
  openingFloat: number;
  expectedCash: number;
  closingCash: number | null;
  cashVariance: number | null;
  paymentBreakdown: { method: string; total: number }[];
  printedAt: string;
};

export function ZReportPrint({
  report,
  onDone,
}: {
  report: ZReportData;
  onDone: () => void;
}) {
  const reportRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    const html = reportRef.current?.innerHTML;
    if (html) {
      printHtmlDocument("Z-Report", html);
      return;
    }
    window.print();
  }

  return (
    <div>
      <div className="no-print mb-4 flex gap-2">
        <Button onClick={handlePrint}>Print Z-report</Button>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
      <div
        ref={reportRef}
        className="receipt-print mx-auto max-w-[80mm] bg-white p-4 font-mono text-xs text-black"
      >
        <p className="text-center font-bold">{report.orgName}</p>
        <p className="text-center">{report.storeName}</p>
        <p className="text-center">{report.registerName}</p>
        <p className="my-2 text-center font-bold">Z-REPORT</p>
        <p>Opened: {new Date(report.openedAt).toLocaleString()}</p>
        <p>Printed: {new Date(report.printedAt).toLocaleString()}</p>
        {report.activeStaffName && <p>Cashier: {report.activeStaffName}</p>}
        <hr className="my-2 border-dashed border-black" />
        <p>Sales count: {report.saleCount}</p>
        <p>Voids: {report.voidCount}</p>
        <p>Gross: {formatCurrency(report.grossTotal, report.currency)}</p>
        <p>Opening float: {formatCurrency(report.openingFloat, report.currency)}</p>
        <p>Expected cash: {formatCurrency(report.expectedCash, report.currency)}</p>
        {report.closingCash != null && (
          <p>Counted cash: {formatCurrency(report.closingCash, report.currency)}</p>
        )}
        {report.cashVariance != null && Math.abs(report.cashVariance) > 0.01 && (
          <p>
            Variance: {report.cashVariance >= 0 ? "+" : ""}
            {formatCurrency(report.cashVariance, report.currency)}
          </p>
        )}
        {report.paymentBreakdown.length > 0 && (
          <>
            <hr className="my-2 border-dashed border-black" />
            <p className="font-bold">Payment mix</p>
            {report.paymentBreakdown.map((p) => (
              <div key={p.method} className="flex justify-between capitalize">
                <span>{p.method.replace(/_/g, " ")}</span>
                <span>{formatCurrency(p.total, report.currency)}</span>
              </div>
            ))}
          </>
        )}
        <hr className="my-2 border-dashed border-black" />
        <p className="text-center text-[10px]">End of Z-report</p>
      </div>
    </div>
  );
}
