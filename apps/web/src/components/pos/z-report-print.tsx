"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
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
  tipsTotal?: number;
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
  const t = useTranslations("pos");
  const reportRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    const html = reportRef.current?.innerHTML;
    if (html) {
      printHtmlDocument(t("zReportDocTitle"), html);
      return;
    }
    window.print();
  }

  const varianceAmount =
    report.cashVariance != null
      ? `${report.cashVariance >= 0 ? "+" : ""}${formatCurrency(report.cashVariance, report.currency)}`
      : "";

  return (
    <div>
      <div className="no-print mb-4 flex gap-2">
        <Button onClick={handlePrint}>{t("printZReport")}</Button>
        <Button variant="outline" onClick={onDone}>
          {t("done")}
        </Button>
      </div>
      <div
        ref={reportRef}
        className="receipt-print mx-auto max-w-[80mm] bg-white p-4 font-mono text-xs text-black"
      >
        <p className="text-center font-bold">{report.orgName}</p>
        <p className="text-center">{report.storeName}</p>
        <p className="text-center">{report.registerName}</p>
        <p className="my-2 text-center font-bold">{t("zReportTitle")}</p>
        <p>{t("opened", { datetime: new Date(report.openedAt).toLocaleString() })}</p>
        <p>{t("printed", { datetime: new Date(report.printedAt).toLocaleString() })}</p>
        {report.activeStaffName && <p>{t("cashier", { name: report.activeStaffName })}</p>}
        <hr className="my-2 border-dashed border-black" />
        <p>{t("salesCount", { count: report.saleCount })}</p>
        <p>{t("voids", { count: report.voidCount })}</p>
        <p>{t("gross", { amount: formatCurrency(report.grossTotal, report.currency) })}</p>
        {(report.tipsTotal ?? 0) > 0 && (
          <p>{t("tipsLine", { amount: formatCurrency(report.tipsTotal!, report.currency) })}</p>
        )}
        <p>
          {t("openingFloatLine", {
            amount: formatCurrency(report.openingFloat, report.currency),
          })}
        </p>
        <p>
          {t("expectedCashLine", {
            amount: formatCurrency(report.expectedCash, report.currency),
          })}
        </p>
        {report.closingCash != null && (
          <p>
            {t("countedCashLine", {
              amount: formatCurrency(report.closingCash, report.currency),
            })}
          </p>
        )}
        {report.cashVariance != null && Math.abs(report.cashVariance) > 0.01 && (
          <p>{t("varianceLine", { amount: varianceAmount })}</p>
        )}
        {report.paymentBreakdown.length > 0 && (
          <>
            <hr className="my-2 border-dashed border-black" />
            <p className="font-bold">{t("paymentMix")}</p>
            {report.paymentBreakdown.map((p) => (
              <div key={p.method} className="flex justify-between capitalize">
                <span>{p.method.replace(/_/g, " ")}</span>
                <span>{formatCurrency(p.total, report.currency)}</span>
              </div>
            ))}
          </>
        )}
        <hr className="my-2 border-dashed border-black" />
        <p className="text-center text-[10px]">{t("endOfZReport")}</p>
      </div>
    </div>
  );
}
