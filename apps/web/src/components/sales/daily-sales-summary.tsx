"use client";

import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import type { SalesRegisterSummary } from "@/lib/sales-register";

export function DailySalesSummaryPrint({
  from,
  to,
  storeName,
  orgName,
  currency,
  summary,
  byStore,
}: {
  from: string;
  to: string;
  storeName?: string;
  orgName: string;
  currency: string;
  summary: SalesRegisterSummary;
  byStore: { name: string; value: number }[];
}) {
  const money = (n: number) => formatCurrency(n, currency);
  const avg = summary.count > 0 ? summary.gross / summary.count : 0;

  function printSummary() {
    window.print();
  }

  return (
    <div>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={printSummary}>
        <Printer className="h-3.5 w-3.5" />
        Print daily summary
      </Button>
      <div className="daily-sales-summary-print hidden print:block">
        <div className="mx-auto max-w-lg p-8 font-mono text-sm">
          <h1 className="text-center text-lg font-bold">{orgName}</h1>
          <p className="text-center text-xs">Sales summary · {from}{from !== to ? ` → ${to}` : ""}</p>
          {storeName && <p className="text-center text-xs">Store: {storeName}</p>}
          <hr className="my-4 border-dashed" />
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Completed sales</span>
              <span>{summary.count}</span>
            </div>
            <div className="flex justify-between">
              <span>Gross revenue</span>
              <span>{money(summary.gross)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax collected</span>
              <span>{money(summary.tax)}</span>
            </div>
            <div className="flex justify-between">
              <span>Discounts</span>
              <span>{money(summary.discounts)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tips</span>
              <span>{money(summary.tips)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>Avg ticket</span>
              <span>{money(avg)}</span>
            </div>
            <div className="flex justify-between">
              <span>Voided</span>
              <span>{summary.voided}</span>
            </div>
            <div className="flex justify-between">
              <span>Returned</span>
              <span>{summary.returned}</span>
            </div>
          </div>
          {byStore.length > 1 && (
            <>
              <hr className="my-4 border-dashed" />
              <p className="mb-2 font-bold">By store</p>
              {byStore.map((s) => (
                <div key={s.name} className="flex justify-between">
                  <span>{s.name}</span>
                  <span>{money(s.value)}</span>
                </div>
              ))}
            </>
          )}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Generated {new Date().toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
