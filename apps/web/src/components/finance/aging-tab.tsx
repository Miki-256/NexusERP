"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { ReportSection, StatementTable } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
import { TabBar } from "@/components/layout/tab-bar";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";

type AgingBuckets = {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  over_90: number;
};

type ArRow = {
  kind: string;
  id: string;
  reference: string;
  customer_name: string | null;
  amount: number;
  due_date: string;
  days_overdue: number;
  bucket: string;
};

type ApRow = {
  id: string;
  reference: string;
  vendor_name: string | null;
  amount: number;
  due_date: string;
  days_overdue: number;
  bucket: string;
};

export type ArAging = {
  as_of: string;
  buckets: AgingBuckets;
  total: number;
  rows: ArRow[];
};

export type ApAging = {
  as_of: string;
  buckets: AgingBuckets;
  total: number;
  rows: ApRow[];
};

const BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  days_1_30: "1–30 days",
  days_31_60: "31–60 days",
  days_61_90: "61–90 days",
  over_90: "90+ days",
};

export function AgingTab({
  currency,
  arAging,
  apAging,
}: {
  currency: string;
  arAging: ArAging;
  apAging: ApAging;
}) {
  const [sub, setSub] = useState<"ar" | "ap">("ar");
  const money = (n: number) => formatCurrency(n, currency);

  const active = sub === "ar" ? arAging : apAging;
  const bucketRows = useMemo(
    () =>
      Object.entries(active.buckets).map(([key, value]) => ({
        label: BUCKET_LABELS[key] ?? key,
        value: money(value),
      })),
    [active.buckets, money]
  );

  return (
    <div className="space-y-6">
      <TabBar
        tabs={[
          { key: "ar" as const, label: "Receivables" },
          { key: "ap" as const, label: "Payables" },
        ]}
        value={sub}
        onChange={setSub}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(active.buckets).map(([key, val]) => (
          <StatCard key={key} label={BUCKET_LABELS[key] ?? key} value={money(val)} />
        ))}
      </div>

      <ReportSection
        title={sub === "ar" ? "Accounts receivable aging" : "Accounts payable aging"}
        subtitle={`As of ${active.as_of} · Total ${money(active.total)}`}
        actions={
          sub === "ar" ? (
            <ExportCsvButton
              filename={`ar-aging-${active.as_of}`}
              rows={arAging.rows.map((r) => ({
                kind: r.kind,
                reference: r.reference,
                customer: r.customer_name ?? "",
                amount: r.amount,
                due_date: r.due_date,
                days_overdue: r.days_overdue,
                bucket: BUCKET_LABELS[r.bucket] ?? r.bucket,
              }))}
              columns={[
                { key: "kind", label: "Type" },
                { key: "reference", label: "Reference" },
                { key: "customer", label: "Customer" },
                { key: "amount", label: "Amount" },
                { key: "due_date", label: "Due" },
                { key: "days_overdue", label: "Days overdue" },
                { key: "bucket", label: "Bucket" },
              ]}
            />
          ) : (
            <ExportCsvButton
              filename={`ap-aging-${active.as_of}`}
              rows={apAging.rows.map((r) => ({
                reference: r.reference,
                vendor: r.vendor_name ?? "",
                amount: r.amount,
                due_date: r.due_date,
                days_overdue: r.days_overdue,
                bucket: BUCKET_LABELS[r.bucket] ?? r.bucket,
              }))}
              columns={[
                { key: "reference", label: "Reference" },
                { key: "vendor", label: "Vendor" },
                { key: "amount", label: "Amount" },
                { key: "due_date", label: "Due" },
                { key: "days_overdue", label: "Days overdue" },
                { key: "bucket", label: "Bucket" },
              ]}
            />
          )
        }
      >
        <div className="mb-6">
          <StatementTable rows={bucketRows.map((r) => ({ label: r.label, value: r.value }))} />
        </div>
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              {sub === "ar" ? (
                <>
                  <DataTableHead>Type</DataTableHead>
                  <DataTableHead>Reference</DataTableHead>
                  <DataTableHead>Customer</DataTableHead>
                </>
              ) : (
                <>
                  <DataTableHead>Reference</DataTableHead>
                  <DataTableHead>Vendor</DataTableHead>
                </>
              )}
              <DataTableHead align="right">Amount</DataTableHead>
              <DataTableHead>Due</DataTableHead>
              <DataTableHead align="right">Days</DataTableHead>
              <DataTableHead>Bucket</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {(sub === "ar" ? arAging.rows : apAging.rows).length === 0 ? (
                <DataTableEmpty
                  colSpan={sub === "ar" ? 7 : 6}
                  message={sub === "ar" ? "No open receivables." : "No open payables."}
                />
              ) : sub === "ar" ? (
                arAging.rows.map((r) => (
                  <DataTableRow key={`${r.kind}-${r.id}`}>
                    <DataTableCell className="capitalize">{r.kind.replace("_", " ")}</DataTableCell>
                    <DataTableCell>{r.reference}</DataTableCell>
                    <DataTableCell>{r.customer_name ?? "—"}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {money(r.amount)}
                    </DataTableCell>
                    <DataTableCell>{r.due_date}</DataTableCell>
                    <DataTableCell align="right">{r.days_overdue}</DataTableCell>
                    <DataTableCell>{BUCKET_LABELS[r.bucket] ?? r.bucket}</DataTableCell>
                  </DataTableRow>
                ))
              ) : (
                apAging.rows.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell>{r.reference}</DataTableCell>
                    <DataTableCell>{r.vendor_name ?? "—"}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {money(r.amount)}
                    </DataTableCell>
                    <DataTableCell>{r.due_date}</DataTableCell>
                    <DataTableCell align="right">{r.days_overdue}</DataTableCell>
                    <DataTableCell>{BUCKET_LABELS[r.bucket] ?? r.bucket}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>
    </div>
  );
}
