"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { TabBar } from "@/components/layout/tab-bar";
import { FormCard } from "@/components/layout/form-card";
import { StatCard } from "@/components/layout/stat-card";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import { ReportSection } from "@/components/finance/report-section";
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
import { formatCurrency, relationName } from "@/lib/utils";
import { groupByField } from "@/lib/finance-aggregates";
import { ChartCard, FinanceBarChart, FinanceDonutChart, TrendAreaChart } from "@/components/charts/finance-charts";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Building2, FileText, Package, Truck } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import { PurchasingScmPanel } from "@/components/scm/purchasing-scm-panel";
import { StandaloneBillForm } from "@/components/finance/standalone-bill-form";
import { ApPaymentRunsTab, type OpenBillOption, type PaymentRunRow } from "@/components/finance/ap-payment-runs-tab";
import { ProductVariantSearchSelect } from "@/components/purchasing/product-variant-search-select";
import type { VendorRow, PORow, BillRow, VariantOption } from "./page";

type Tab = "orders" | "planning" | "vendors" | "bills" | "payment_runs";

function canCancelPo(status: PORow["status"]) {
  return status === "draft" || status === "ordered";
}

function canReceivePo(status: PORow["status"]) {
  return status === "ordered" || status === "partially_received";
}

function billBalanceDue(b: BillRow) {
  if (b.balance_due != null) return Number(b.balance_due);
  if (b.status === "paid") return 0;
  return Math.max(Number(b.amount) - Number(b.amount_paid ?? 0), 0);
}

function isPayableBill(b: BillRow) {
  return b.status === "open" || b.status === "partially_paid";
}
type DraftLine = { variantId: string; productName: string; quantity: string; unitCost: string };

export function PurchasingClient({
  organizationId,
  currency,
  canManage,
  vendors,
  stores,
  purchaseOrders,
  bills,
  variants,
  openBills,
  paymentRuns,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  vendors: VendorRow[];
  stores: { id: string; name: string }[];
  purchaseOrders: PORow[];
  bills: BillRow[];
  variants: VariantOption[];
  openBills: OpenBillOption[];
  paymentRuns: PaymentRunRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("orders");
  const [busy, setBusy] = useState<string>("");
  const [payBillId, setPayBillId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "mobile_money" | "bank_transfer">("bank_transfer");

  const money = (n: number) => formatCurrency(Number(n), currency);
  const variantLabel = (v: VariantOption) =>
    `${relationName(v.products)}${v.name && v.name !== "Default" ? ` (${v.name})` : ""}`;

  const summary = useMemo(() => {
    const openBillRows = bills.filter((b) => isPayableBill(b) && billBalanceDue(b) > 0.01);
    const pendingPo = purchaseOrders.filter((p) => p.status === "ordered");
    return {
      apOpen: openBillRows.reduce((s, b) => s + billBalanceDue(b), 0),
      openBills: openBillRows.length,
      pendingPo: pendingPo.length,
      poValue: pendingPo.reduce((s, p) => s + Number(p.total), 0),
    };
  }, [bills, purchaseOrders]);

  const apByVendor = useMemo(
    () =>
      groupByField(
        bills.filter((b) => isPayableBill(b) && billBalanceDue(b) > 0.01),
        (b) => relationName(b.vendors) || "Unknown",
        (b) => billBalanceDue(b)
      ).slice(0, 8),
    [bills]
  );

  const poByStatus = useMemo(
    () =>
      groupByField(
        purchaseOrders,
        (p) => p.status.replace(/_/g, " "),
        (p) => Number(p.total)
      ),
    [purchaseOrders]
  );

  const billsByStatus = useMemo(
    () =>
      groupByField(
        bills,
        (b) => b.status,
        (b) => Number(b.amount)
      ),
    [bills]
  );

  const spendTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const po of purchaseOrders) {
      const key = po.order_date.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(po.total));
    }
    for (const b of bills) {
      const key = b.bill_date.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(b.amount));
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, value]) => ({
        label: new Date(`${month}-01`).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        value,
      }));
  }, [purchaseOrders, bills]);

  // --- Vendor form ---
  const [vName, setVName] = useState("");
  const [vPhone, setVPhone] = useState("");
  const [vEmail, setVEmail] = useState("");
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);

  function resetVendorForm() {
    setVName("");
    setVPhone("");
    setVEmail("");
    setEditingVendorId(null);
  }

  function startEditVendor(v: { id: string; name: string; phone: string | null; email: string | null }) {
    setEditingVendorId(v.id);
    setVName(v.name);
    setVPhone(v.phone ?? "");
    setVEmail(v.email ?? "");
  }

  async function saveVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!vName.trim()) return;
    setBusy("vendor");
    const supabase = createClient();
    const payload = {
      name: vName.trim(),
      phone: vPhone || null,
      email: vEmail || null,
    };
    const { error: err } = editingVendorId
      ? await supabase.from("vendors").update(payload).eq("id", editingVendorId).eq("organization_id", organizationId)
      : await supabase.from("vendors").insert({ organization_id: organizationId, ...payload });
    setBusy("");
    if (err) return toast({ title: editingVendorId ? "Could not update vendor" : "Could not add vendor", description: err.message, variant: "destructive" });
    toast({ title: editingVendorId ? "Vendor updated" : "Vendor added", description: vName });
    resetVendorForm();
    router.refresh();
  }

  async function setVendorActive(vendorId: string, active: boolean) {
    setBusy("vendor");
    const supabase = createClient();
    const { error: err } = await supabase
      .from("vendors")
      .update({ is_active: active })
      .eq("id", vendorId)
      .eq("organization_id", organizationId);
    setBusy("");
    if (err) return toast({ title: "Could not update vendor", description: err.message, variant: "destructive" });
    toast({ title: active ? "Vendor activated" : "Vendor deactivated" });
    router.refresh();
  }

  async function deleteVendor(vendorId: string, vendorName: string) {
    setBusy("vendor");
    const supabase = createClient();
    const { error: err } = await supabase.from("vendors").delete().eq("id", vendorId).eq("organization_id", organizationId);
    setBusy("");
    if (err) {
      return toast({ title: "Could not delete vendor", description: deleteBlockedMessage(err), variant: "destructive" });
    }
    toast({ title: "Vendor deleted", description: vendorName });
    if (editingVendorId === vendorId) resetVendorForm();
    router.refresh();
  }

  // --- PO form ---
  const [poVendor, setPoVendor] = useState("");
  const [poStore, setPoStore] = useState(stores[0]?.id ?? "");
  const [poExpected, setPoExpected] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { variantId: "", productName: "", quantity: "", unitCost: "" },
  ]);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function onPickVariant(i: number, variantId: string) {
    const v = variants.find((x) => x.id === variantId);
    updateLine(i, {
      variantId,
      productName: v ? variantLabel(v) : "",
      unitCost: v?.cost_price != null ? String(v.cost_price) : "",
    });
  }
  const poTotal = lines.reduce(
    (s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitCost) || 0),
    0
  );

  async function createPO(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const validLines = lines
      .filter((l) => l.variantId && parseFloat(l.quantity) > 0)
      .map((l) => ({
        variantId: l.variantId,
        productName: l.productName,
        quantity: parseFloat(l.quantity),
        unitCost: parseFloat(l.unitCost) || 0,
      }));
    if (!poVendor || !poStore || validLines.length === 0) {
      return toast({ title: "Incomplete PO", description: "Pick vendor, store, and at least one line.", variant: "destructive" });
    }
    setBusy("po");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("create_purchase_order", {
      p_org_id: organizationId,
      p_vendor_id: poVendor,
      p_store_id: poStore,
      p_expected_date: poExpected || null,
      p_notes: null,
      p_lines: validLines,
    });
    setBusy("");
    if (err) return toast({ title: "PO failed", description: err.message, variant: "destructive" });
    toast({ title: "Purchase order created" });
    setPoVendor("");
    setPoExpected("");
    setLines([{ variantId: "", productName: "", quantity: "", unitCost: "" }]);
    router.refresh();
  }

  async function receivePO(id: string) {
    setBusy(id);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("receive_purchase_order", { p_po_id: id });
    setBusy("");
    if (err) return toast({ title: "Receive failed", description: err.message, variant: "destructive" });
    toast({ title: "PO received", description: "Stock and vendor bill updated." });
    router.refresh();
  }

  async function cancelPO(id: string) {
    setBusy(`cancel-${id}`);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("cancel_purchase_order", {
      p_po_id: id,
      p_reason: "Cancelled by user",
    });
    setBusy("");
    if (err) return toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
    toast({ title: "Purchase order cancelled" });
    router.refresh();
  }

  async function payBill(id: string, amount?: number, method?: typeof payMethod) {
    const bill = bills.find((b) => b.id === id);
    const balance = bill ? billBalanceDue(bill) : 0;
    const pay = amount ?? balance;
    if (!pay || pay <= 0) return;
    setBusy(id);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("pay_vendor_bill", {
      p_bill_id: id,
      p_payment_method: method ?? payMethod,
      p_amount: pay,
    });
    setBusy("");
    if (err) return toast({ title: "Payment failed", description: err.message, variant: "destructive" });
    toast({ title: pay >= balance - 0.01 ? "Bill paid in full" : "Partial payment recorded" });
    setPayBillId(null);
    setPayAmount("");
    router.refresh();
  }

  async function postBill(id: string) {
    setBusy(id + "post");
    const supabase = createClient();
    const { error } = await supabase.rpc("post_vendor_bill", { p_bill_id: id });
    setBusy("");
    if (error) return toast({ title: "Post failed", description: error.message, variant: "destructive" });
    toast({ title: "Bill posted to ledger" });
    router.refresh();
  }

  async function validateMatch(id: string) {
    setBusy(id + "match");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("validate_vendor_bill_match", { p_bill_id: id });
    setBusy("");
    if (error) return toast({ title: "Match check failed", description: error.message, variant: "destructive" });
    const row = data as { match_status?: string; variance?: number };
    toast({ title: `Match: ${row.match_status ?? "unknown"}`, description: row.variance ? `Variance ${row.variance}` : undefined });
    router.refresh();
  }

  function openPayDialog(bill: BillRow) {
    setPayBillId(bill.id);
    setPayAmount(String(billBalanceDue(bill)));
    setPayMethod("bank_transfer");
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        breadcrumb="Accounts payable"
        title="Purchasing & Vendor Bills"
        description="Manage vendors, purchase orders, goods receipt, and vendor bill payments tied to inventory and AP."
        action={
          <TabBar
            tabs={[
              { key: "orders" as const, label: "Purchase Orders" },
              ...(canManage ? [{ key: "planning" as const, label: "MRP & requisitions" }] : []),
              { key: "vendors" as const, label: "Vendors" },
              { key: "bills" as const, label: "Vendor Bills" },
              { key: "payment_runs" as const, label: "Payment runs" },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open AP" value={money(summary.apOpen)} sub={`${summary.openBills} bills`} icon={FileText} />
        <StatCard label="Pending POs" value={summary.pendingPo} sub={money(summary.poValue)} icon={Package} />
        <StatCard label="Active vendors" value={vendors.length} icon={Building2} />
        <StatCard label="Total POs" value={purchaseOrders.length} icon={Truck} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        <ChartCard title="Open AP by vendor" subtitle="Unpaid bills">
          {apByVendor.length > 0 ? (
            <FinanceDonutChart data={apByVendor} formatValue={money} innerRadius={44} height={240} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No open bills</p>
          )}
        </ChartCard>
        <ChartCard title="PO value by status" subtitle="All purchase orders">
          {poByStatus.length > 0 ? (
            <FinanceBarChart data={poByStatus} formatValue={money} height={240} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No POs yet</p>
          )}
        </ChartCard>
        <ChartCard title="Bills by status" subtitle="Vendor payables">
          {billsByStatus.length > 0 ? (
            <FinanceDonutChart data={billsByStatus} formatValue={money} innerRadius={44} height={240} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No bills yet</p>
          )}
        </ChartCard>
        <ChartCard title="Spend trend" subtitle="POs + bills · last 6 months">
          {spendTrend.length > 0 ? (
            <TrendAreaChart data={spendTrend} formatValue={money} height={240} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No spend history</p>
          )}
        </ChartCard>
      </div>

      {tab === "planning" && canManage && (
        <PurchasingScmPanel organizationId={organizationId} stores={stores} canManage={canManage} />
      )}

      {tab === "orders" && (
        <>
          {canManage && (
            <FormCard title="New Purchase Order">
                <form onSubmit={createPO} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Vendor</Label>
                      <select
                        className={SELECT_CLS}
                        value={poVendor}
                        onChange={(e) => setPoVendor(e.target.value)}
                        required
                      >
                        <option value="">Select…</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Receiving store</Label>
                      <select
                        className={SELECT_CLS}
                        value={poStore}
                        onChange={(e) => setPoStore(e.target.value)}
                        required
                      >
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Expected date</Label>
                      <DatePicker value={poExpected} onChange={setPoExpected} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Lines</Label>
                    {lines.map((l, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                        <ProductVariantSearchSelect
                          variants={variants}
                          value={l.variantId}
                          onChange={(variantId) => onPickVariant(i, variantId)}
                          placeholder="Search product…"
                        />
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="Qty"
                          value={l.quantity}
                          onChange={(e) => updateLine(i, { quantity: e.target.value })}
                        />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Unit cost"
                          value={l.unitCost}
                          onChange={(e) => updateLine(i, { unitCost: e.target.value })}
                        />
                        <button
                          type="button"
                          className="text-sm text-muted-foreground hover:text-red-600"
                          onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setLines((prev) => [
                          ...prev,
                          { variantId: "", productName: "", quantity: "", unitCost: "" },
                        ])
                      }
                    >
                      + Add line
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Total: {money(poTotal)}</p>
                    <Button type="submit" disabled={busy === "po"}>
                      {busy === "po" ? "Creating…" : "Create PO"}
                    </Button>
                  </div>
                </form>
            </FormCard>
          )}

          <ReportSection
            title="Purchase orders"
            subtitle={`${purchaseOrders.length} orders`}
            actions={
              <ExportCsvButton
                filename="purchase-orders"
                rows={purchaseOrders.map((po) => ({
                  date: po.order_date,
                  vendor: relationName(po.vendors) || "",
                  store: relationName(po.stores) || "",
                  status: po.status,
                  total: po.total,
                }))}
                columns={[
                  { key: "date", label: "Date" },
                  { key: "vendor", label: "Vendor" },
                  { key: "store", label: "Store" },
                  { key: "status", label: "Status" },
                  { key: "total", label: "Total" },
                ]}
              />
            }
          >
          <ResponsiveTableLayout
            mobile={
              purchaseOrders.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No purchase orders yet.</p>
              ) : (
                purchaseOrders.map((po) => (
                  <MobileRecordCard key={po.id}>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{relationName(po.vendors) || "Vendor"}</p>
                        <p className="text-xs text-muted-foreground">{po.order_date}</p>
                      </div>
                      <StatusBadge status={po.status} />
                    </div>
                    <div className="space-y-1.5">
                      <MobileRecordCardRow label="Store">{relationName(po.stores) || "—"}</MobileRecordCardRow>
                      <MobileRecordCardRow label="Total">{money(po.total)}</MobileRecordCardRow>
                    </div>
                    {canManage && (canReceivePo(po.status) || canCancelPo(po.status)) && (
                      <div className="mt-3 flex flex-col gap-2">
                        {canReceivePo(po.status) && (
                          <Button
                            size="sm"
                            className="w-full"
                            disabled={busy === po.id || busy === `cancel-${po.id}`}
                            onClick={() => receivePO(po.id)}
                          >
                            {busy === po.id ? "…" : "Receive"}
                          </Button>
                        )}
                        {canCancelPo(po.status) && (
                          <ConfirmDeleteButton
                            label="Cancel order"
                            confirmLabel="Confirm cancel"
                            message="Cancel this purchase order? This cannot be undone."
                            disabled={busy === po.id || busy === `cancel-${po.id}`}
                            onConfirm={() => cancelPO(po.id)}
                          />
                        )}
                      </div>
                    )}
                  </MobileRecordCard>
                ))
              )
            }
          >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Date</DataTableHead>
                <DataTableHead>Vendor</DataTableHead>
                <DataTableHead>Store</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead align="right">Total</DataTableHead>
                <DataTableHead align="right">Action</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {purchaseOrders.length === 0 ? (
                  <DataTableEmpty colSpan={6} message="No purchase orders yet." />
                ) : (
                  purchaseOrders.map((po) => (
                    <DataTableRow key={po.id}>
                      <DataTableCell>{po.order_date}</DataTableCell>
                      <DataTableCell>{relationName(po.vendors)}</DataTableCell>
                      <DataTableCell>{relationName(po.stores)}</DataTableCell>
                      <DataTableCell><StatusBadge status={po.status} /></DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(po.total)}</DataTableCell>
                      <DataTableCell align="right">
                        {canManage && (canReceivePo(po.status) || canCancelPo(po.status)) ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {canReceivePo(po.status) && (
                              <Button
                                size="sm"
                                disabled={busy === po.id || busy === `cancel-${po.id}`}
                                onClick={() => receivePO(po.id)}
                              >
                                {busy === po.id ? "…" : "Receive"}
                              </Button>
                            )}
                            {canCancelPo(po.status) && (
                              <ConfirmDeleteButton
                                label="Cancel"
                                confirmLabel="Confirm"
                                message="Cancel this PO?"
                                disabled={busy === po.id || busy === `cancel-${po.id}`}
                                onConfirm={() => cancelPO(po.id)}
                              />
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
          </ResponsiveTableLayout>
          </ReportSection>
        </>
      )}

      {tab === "vendors" && (
        <>
          {canManage && (
            <FormCard title={editingVendorId ? "Edit Vendor" : "Add Vendor"}>
                <form onSubmit={saveVendor} className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Name</Label>
                    <Input value={vName} onChange={(e) => setVName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={vPhone} onChange={(e) => setVPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={vEmail} onChange={(e) => setVEmail(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy === "vendor"}>{editingVendorId ? "Update" : "Add"}</Button>
                    {editingVendorId && (
                      <Button type="button" variant="outline" onClick={resetVendorForm}>Cancel</Button>
                    )}
                  </div>
                </form>
            </FormCard>
          )}
          <ReportSection
            title="Vendor directory"
            subtitle={`${vendors.length} suppliers`}
            actions={
              <ExportCsvButton
                filename="vendors"
                rows={vendors.map((v) => ({
                  name: v.name,
                  phone: v.phone || "",
                  email: v.email || "",
                }))}
                columns={[
                  { key: "name", label: "Name" },
                  { key: "phone", label: "Phone" },
                  { key: "email", label: "Email" },
                ]}
              />
            }
          >
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Name</DataTableHead>
                  <DataTableHead>Phone</DataTableHead>
                  <DataTableHead>Email</DataTableHead>
                  {canManage && <DataTableHead align="right">Actions</DataTableHead>}
                </DataTableHeader>
                <DataTableBody>
                  {vendors.length === 0 ? (
                    <DataTableEmpty colSpan={canManage ? 4 : 3} message="No vendors yet." />
                  ) : (
                    vendors.map((v) => (
                      <DataTableRow key={v.id}>
                        <DataTableCell className="font-medium">
                          {v.name}
                          {!v.is_active && (
                            <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>
                          )}
                        </DataTableCell>
                        <DataTableCell>{v.phone || "—"}</DataTableCell>
                        <DataTableCell>{v.email || "—"}</DataTableCell>
                        {canManage && (
                          <DataTableCell align="right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => startEditVendor(v)}>Edit</Button>
                              <Button variant="outline" size="sm" onClick={() => setVendorActive(v.id, !v.is_active)}>
                                {v.is_active ? "Deactivate" : "Activate"}
                              </Button>
                              <ConfirmDeleteButton
                                message="Delete vendor permanently? Deactivate if linked to POs or bills."
                                onConfirm={() => deleteVendor(v.id, v.name)}
                              />
                            </div>
                          </DataTableCell>
                        )}
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
          </ReportSection>
        </>
      )}

      {tab === "bills" && (
        <>
          {canManage && (
            <StandaloneBillForm
              orgId={organizationId}
              vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
            />
          )}
        <ReportSection
          title="Vendor bills"
          subtitle={`${bills.length} bills · ${money(summary.apOpen)} open`}
          actions={
            <ExportCsvButton
              filename="vendor-bills"
              rows={bills.map((b) => ({
                date: b.bill_date,
                vendor: relationName(b.vendors) || "",
                status: b.status,
                amount: b.amount,
              }))}
              columns={[
                { key: "date", label: "Date" },
                { key: "vendor", label: "Vendor" },
                { key: "status", label: "Status" },
                { key: "amount", label: "Amount" },
              ]}
            />
          }
        >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Date</DataTableHead>
              <DataTableHead>Vendor</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Match</DataTableHead>
            <DataTableHead align="right">Amount</DataTableHead>
            <DataTableHead align="right">Balance</DataTableHead>
            <DataTableHead align="right">Action</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {bills.length === 0 ? (
              <DataTableEmpty colSpan={7} message="No vendor bills yet." />
            ) : (
              bills.map((b) => (
                <DataTableRow key={b.id}>
                  <DataTableCell>{b.bill_date}</DataTableCell>
                  <DataTableCell>{relationName(b.vendors)}</DataTableCell>
                  <DataTableCell><StatusBadge status={b.status} /></DataTableCell>
                  <DataTableCell className="text-xs capitalize text-muted-foreground">
                    {b.match_status?.replace(/_/g, " ") ?? "—"}
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono">{money(b.amount)}</DataTableCell>
                  <DataTableCell align="right" className="font-mono text-amber-700">
                    {isPayableBill(b) || b.status === "draft" ? money(billBalanceDue(b)) : "—"}
                  </DataTableCell>
                  <DataTableCell align="right" className="space-x-2">
                    {canManage && b.status === "draft" && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => postBill(b.id)}>Post</Button>
                    )}
                    {canManage && b.po_id && isPayableBill(b) && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => validateMatch(b.id)}>Match</Button>
                    )}
                    {canManage && isPayableBill(b) && billBalanceDue(b) > 0.01 && (
                      <Button size="sm" disabled={busy === b.id} onClick={() => openPayDialog(b)}>Pay</Button>
                    )}
                    {!canManage && "—"}
                  </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
        </ReportSection>

        {payBillId && (
          <FormCard
            title="Pay vendor bill"
            onSubmit={(e) => {
              e.preventDefault();
              void payBill(payBillId, Number(payAmount) || undefined);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Method</Label>
                <select className={SELECT_CLS} value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="submit" disabled={!!busy}>Apply payment</Button>
              <Button type="button" variant="outline" onClick={() => setPayBillId(null)}>Cancel</Button>
            </div>
          </FormCard>
        )}
        </>
      )}

      {tab === "payment_runs" && (
        <ApPaymentRunsTab
          orgId={organizationId}
          currency={currency}
          canManage={canManage}
          runs={paymentRuns}
          openBills={openBills}
        />
      )}
    </div>
  );
}
