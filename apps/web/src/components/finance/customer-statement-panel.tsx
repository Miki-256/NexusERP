"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
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
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";

type StatementLine = {
  txn_date: string;
  type: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance_effect: number;
};

export function CustomerStatementPanel({
  orgId,
  currency,
  customers,
}: {
  orgId: string;
  currency: string;
  customers: { id: string; name: string | null }[];
}) {
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [statement, setStatement] = useState<{
    customer_name: string;
    opening_balance: number;
    closing_balance: number;
    current_exposure: number;
    lines: StatementLine[];
  } | null>(null);

  const money = (n: number) => formatCurrency(n, currency);

  const csvRows = useMemo(
    () =>
      (statement?.lines ?? []).map((l) => ({
        date: l.txn_date,
        type: l.type,
        reference: l.reference,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    [statement]
  );

  async function loadStatement(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_customer_statement", {
      p_org_id: orgId,
      p_customer_id: customerId,
      p_from: from,
      p_to: to,
    });
    setLoading(false);
    if (error || !data) {
      toast({ title: "Could not load statement", description: error?.message, variant: "destructive" });
      return;
    }
    const row = data as {
      customer_name: string;
      opening_balance: number;
      closing_balance: number;
      current_exposure: number;
      lines: StatementLine[];
    };
    setStatement(row);
  }

  return (
    <div className="space-y-6">
      <ReportSection title="Customer statement" subtitle="Opening balance, invoices, payments, and credits for a period">
        <form onSubmit={loadStatement} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2 sm:col-span-2">
            <Label>Customer</Label>
            <select className={SELECT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>From</Label>
            <DatePicker value={from} onChange={setFrom} />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <DatePicker value={to} onChange={setTo} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={loading}>
              {loading ? "Loading…" : "Generate statement"}
            </Button>
          </div>
        </form>
      </ReportSection>

      {statement && (
        <ReportSection
          title={`${statement.customer_name} — ${from} to ${to}`}
          subtitle={`Current exposure ${money(statement.current_exposure)}`}
          actions={
            <ExportCsvButton
              filename={`statement-${customerId.slice(0, 8)}`}
              rows={csvRows}
              columns={[
                { key: "date", label: "Date" },
                { key: "type", label: "Type" },
                { key: "reference", label: "Reference" },
                { key: "description", label: "Description" },
                { key: "debit", label: "Debit" },
                { key: "credit", label: "Credit" },
              ]}
            />
          }
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Opening balance</p>
              <p className="font-mono font-semibold">{money(statement.opening_balance)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Closing balance</p>
              <p className="font-mono font-semibold">{money(statement.closing_balance)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Current exposure</p>
              <p className="font-mono font-semibold text-amber-700">{money(statement.current_exposure)}</p>
            </div>
          </div>

          <DataTable>
            <table className="w-full text-sm">
              <DataTableHeader>
                <DataTableHead>Date</DataTableHead>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead>Reference</DataTableHead>
                <DataTableHead>Description</DataTableHead>
                <DataTableHead align="right">Debit</DataTableHead>
                <DataTableHead align="right">Credit</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {statement.lines.length === 0 ? (
                  <DataTableEmpty colSpan={6} message="No activity in this period." />
                ) : (
                  statement.lines.map((l, i) => (
                    <DataTableRow key={`${l.reference}-${i}`}>
                      <DataTableCell>{l.txn_date}</DataTableCell>
                      <DataTableCell className="capitalize">{l.type.replace(/_/g, " ")}</DataTableCell>
                      <DataTableCell className="font-mono text-xs">{l.reference}</DataTableCell>
                      <DataTableCell className="text-muted-foreground">{l.description}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">
                        {l.debit > 0 ? money(l.debit) : "—"}
                      </DataTableCell>
                      <DataTableCell align="right" className="font-mono">
                        {l.credit > 0 ? money(l.credit) : "—"}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}
    </div>
  );
}
