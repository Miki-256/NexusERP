import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { InvoicingClient } from "./invoicing-client";
import type { CollectionsQueueRow } from "@/components/finance/ar-collections-tab";

export type InvoiceRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  status: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid?: number;
  amount_credited?: number;
  balance_due?: number;
  collection_status?: string;
  customer_id: string | null;
  customers: { name: string | null } | { name: string | null }[] | null;
};

export type CreditNoteRow = {
  id: string;
  credit_note_no: string;
  credit_date: string;
  settlement_method: string;
  status: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  customer_id: string;
  customers: { name: string | null } | { name: string | null }[] | null;
};

export default async function InvoicingPage() {
  const ctx = await requireAppAccess("invoicing");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const canManage = ctx.canManageApp("invoicing");
  if (canManage) {
    await supabase.rpc("ensure_default_tax_codes", { p_org_id: orgId });
  }

  const [{ data: invoices }, { data: creditNotes }, { data: customers }, { data: taxCodesData }, { data: collectionsQueue }] =
    await Promise.all([
    supabase
      .from("customer_invoices")
      .select(
        "id, invoice_no, invoice_date, due_date, status, subtotal, tax_amount, total, amount_paid, amount_credited, collection_status, customer_id, customers(name)"
      )
      .eq("organization_id", orgId)
      .order("invoice_date", { ascending: false })
      .limit(200),
    supabase
      .from("customer_credit_notes")
      .select("id, credit_note_no, credit_date, settlement_method, status, subtotal, tax_amount, total, customer_id, customers(name)")
      .eq("organization_id", orgId)
      .order("credit_date", { ascending: false })
      .limit(200),
    supabase.from("customers").select("id, name").eq("organization_id", orgId).order("name"),
    supabase.rpc("list_tax_codes", { p_org_id: orgId }),
    supabase.rpc("list_ar_collections_queue", { p_org_id: orgId }),
  ]);

  const taxCodes = (Array.isArray(taxCodesData) ? taxCodesData : []) as {
    id: string;
    code: string;
    name: string;
    rate: number;
  }[];

  return (
    <InvoicingClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      taxRate={Number(ctx.organization.tax_rate ?? 0)}
      taxCodes={taxCodes}
      canManage={ctx.canManageApp("invoicing")}
      invoices={((invoices as unknown as InvoiceRow[]) ?? []).map((inv) => ({
        ...inv,
        balance_due: Math.max(
          Number(inv.total) - Number(inv.amount_paid ?? 0) - Number(inv.amount_credited ?? 0),
          0
        ),
      }))}
      creditNotes={(creditNotes as unknown as CreditNoteRow[]) ?? []}
      customers={(customers as { id: string; name: string | null }[]) ?? []}
      collectionsQueue={(collectionsQueue as CollectionsQueueRow[]) ?? []}
    />
  );
}
