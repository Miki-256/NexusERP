"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/layout/status-badge";
import { DateRangeToolbar } from "@/components/finance/date-range-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { formatCurrency } from "@/lib/utils";
import { PAGE_SHELL } from "@/lib/ui-classes";

type VoidedSale = {
  id: string;
  receipt_no: string;
  total: number;
  status: string;
  void_reason: string | null;
  created_at: string;
  store_name: string | null;
  kind: string;
};

type PartialReturn = {
  return_id: string;
  sale_id: string;
  receipt_no: string;
  total: number;
  refund_method: string;
  reason: string;
  created_at: string;
  store_name: string | null;
  sale_status: string;
  kind: string;
};

export function RefundsClient({
  currency,
  from,
  to,
  voidedSales,
  partialReturns,
}: {
  currency: string;
  from: string;
  to: string;
  voidedSales: Record<string, unknown>[];
  partialReturns: Record<string, unknown>[];
}) {
  const money = (n: number) => formatCurrency(Number(n), currency);
  const voided = voidedSales as unknown as VoidedSale[];
  const partials = partialReturns as unknown as PartialReturn[];

  const combined = [
    ...voided.map((s) => ({
      key: s.id,
      receipt_no: s.receipt_no,
      sale_id: s.id,
      store_name: s.store_name,
      created_at: s.created_at,
      status: s.status,
      reason: s.void_reason,
      total: s.total,
      kind: "Full void / returned" as const,
    })),
    ...partials.map((p) => ({
      key: p.return_id,
      receipt_no: p.receipt_no,
      sale_id: p.sale_id,
      store_name: p.store_name,
      created_at: p.created_at,
      status: p.sale_status,
      reason: `${p.reason} (${p.refund_method})`,
      total: p.total,
      kind: "Partial return" as const,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Refunds"
        description="Voided sales, full returns, and partial returns"
      />

      <DateRangeToolbar from={from} to={to} className="mb-6" />

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Receipt</DataTableHead>
            <DataTableHead>Type</DataTableHead>
            <DataTableHead>Store</DataTableHead>
            <DataTableHead>Date</DataTableHead>
            <DataTableHead>Sale status</DataTableHead>
            <DataTableHead>Reason</DataTableHead>
            <DataTableHead align="right">Amount</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {combined.length === 0 ? (
              <DataTableEmpty colSpan={7} message="No voided or returned sales in this period." />
            ) : (
              combined.map((row) => (
                <DataTableRow key={row.key}>
                  <DataTableCell>
                    <Link href={`/sales/${row.sale_id}`} className="font-medium text-primary hover:underline">
                      {row.receipt_no}
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">{row.kind}</DataTableCell>
                  <DataTableCell>{row.store_name ?? "—"}</DataTableCell>
                  <DataTableCell>{new Date(row.created_at).toLocaleDateString()}</DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={row.status} />
                  </DataTableCell>
                  <DataTableCell className="max-w-xs truncate text-muted-foreground">
                    {row.reason ?? "—"}
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono">
                    {money(row.total)}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
    </div>
  );
}
