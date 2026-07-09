"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { formatCurrency } from "@/lib/utils";
import type { PayslipSummary } from "@/lib/hr/types";
import { ExternalLink } from "lucide-react";

export function PayslipsTab({ payslips, currency }: { payslips: PayslipSummary[]; currency: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Posted payslips for your employee profile.</p>

      <ResponsiveTableLayout
        mobile={
          payslips.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No payslips yet.</p>
          ) : (
            payslips.map((p) => (
              <MobileRecordCard key={p.id}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p className="font-semibold">
                    {p.period_start} → {p.period_end}
                  </p>
                  <StatusBadge status={p.run_status} />
                </div>
                <div className="space-y-1.5">
                  <MobileRecordCardRow label="Gross">{formatCurrency(p.gross, currency)}</MobileRecordCardRow>
                  <MobileRecordCardRow label="Deductions">{formatCurrency(p.deductions, currency)}</MobileRecordCardRow>
                  <MobileRecordCardRow label="Tax">{formatCurrency(p.tax, currency)}</MobileRecordCardRow>
                  <MobileRecordCardRow label="Net pay">
                    <span className="font-semibold">{formatCurrency(p.net, currency)}</span>
                  </MobileRecordCardRow>
                </div>
                <Button size="sm" variant="outline" className="mt-3 w-full" asChild>
                  <Link href={`/hr/payroll/${p.run_id}`}>
                    <ExternalLink className="h-4 w-4" />
                    View breakdown
                  </Link>
                </Button>
              </MobileRecordCard>
            ))
          )
        }
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Period</DataTableHead>
              <DataTableHead align="right">Gross</DataTableHead>
              <DataTableHead align="right">Deductions</DataTableHead>
              <DataTableHead align="right">Tax</DataTableHead>
              <DataTableHead align="right">Net</DataTableHead>
              <DataTableHead align="right">Details</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {payslips.length === 0 ? (
                <DataTableEmpty colSpan={6} message="No payslips yet." />
              ) : (
                payslips.map((p) => (
                  <DataTableRow key={p.id}>
                    <DataTableCell className="font-medium">
                      {p.period_start} → {p.period_end}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {formatCurrency(p.gross, currency)}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {formatCurrency(p.deductions, currency)}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {formatCurrency(p.tax, currency)}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono font-semibold">
                      {formatCurrency(p.net, currency)}
                    </DataTableCell>
                    <DataTableCell align="right">
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/hr/payroll/${p.run_id}`}>
                          <ExternalLink className="h-4 w-4" />
                          View
                        </Link>
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ResponsiveTableLayout>
    </div>
  );
}
