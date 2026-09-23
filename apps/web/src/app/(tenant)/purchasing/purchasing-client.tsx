"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
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
import { useTranslations } from "next-intl";
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
import { cn, formatCurrency, relationName } from "@/lib/utils";
import { groupByField } from "@/lib/finance-aggregates";
import { ChartCard, FinanceBarChart, FinanceDonutChart, TrendAreaChart } from "@/components/charts/finance-charts-lazy";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Building2, ChevronDown, ChevronRight, FileText, Package, Truck } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import { PurchasingScmPanel } from "@/components/scm/purchasing-scm-panel";
import { StandaloneBillForm } from "@/components/finance/standalone-bill-form";
import { ApPaymentRunsTab, type OpenBillOption, type PaymentRunRow } from "@/components/finance/ap-payment-runs-tab";
import { ProductVariantSearchSelect, type ProductVariantSearchOption } from "@/components/purchasing/product-variant-search-select";
import {
  PoQuickCreateProductModal,
  type PoQuickCreateResult,
} from "@/components/purchasing/po-quick-create-product";
import { fromBasePrice, formatPriceInput } from "@/lib/scm/uom-pricing";
import type { VendorRow, PORow, POLineRow, BillRow, VariantOption, ProductUomOption } from "./page";

type Tab = "orders" | "planning" | "vendors" | "bills" | "payment_runs";

function canCancelPo(status: PORow["status"]) {
  return status === "draft" || status === "ordered";
}

function canReceivePo(status: PORow["status"]) {
  return status === "ordered" || status === "partially_received";
}

function poLines(po: PORow): POLineRow[] {
  return po.purchase_order_lines ?? [];
}

function lineRemaining(line: POLineRow): number {
  return Math.max(Number(line.quantity) - Number(line.qty_received ?? 0), 0);
}

function formatPoLineQty(line: POLineRow): string {
  const uom = (line.uom_code || "ea").trim() || "ea";
  const ordered = Number(line.quantity);
  const received = Number(line.qty_received ?? 0);
  if (received > 0.0005) {
    return `${received}/${ordered} ${uom}`;
  }
  return `${ordered} ${uom}`;
}

function poItemsSummary(po: PORow): string {
  const lines = poLines(po);
  if (lines.length === 0) return "";
  return lines.map((l) => `${l.product_name} (${formatPoLineQty(l)})`).join("; ");
}

function billBalanceDue(b: BillRow) {
  if (b.balance_due != null) return Number(b.balance_due);
  if (b.status === "paid") return 0;
  return Math.max(Number(b.amount) - Number(b.amount_paid ?? 0), 0);
}

function isPayableBill(b: BillRow) {
  return b.status === "open" || b.status === "partially_paid";
}

function purchaseUomsForProduct(uoms: ProductUomOption[], productId: string): ProductUomOption[] {
  const list = uoms.filter((u) => u.product_id === productId && (u.is_purchase || u.is_base));
  if (list.length === 0) {
    return [
      {
        product_id: productId,
        uom_code: "ea",
        uom_name: "Each",
        conversion_factor: 1,
        is_base: true,
        is_purchase: true,
        is_sale: true,
      },
    ];
  }
  return list;
}

function defaultPurchaseUom(uoms: ProductUomOption[], productId: string) {
  const list = purchaseUomsForProduct(uoms, productId);
  return (
    list.find((u) => u.is_purchase)?.uom_code ??
    list.find((u) => u.is_base)?.uom_code ??
    list[0]?.uom_code ??
    "ea"
  );
}

function uomFactor(uoms: ProductUomOption[], productId: string, code: string): number {
  const list = purchaseUomsForProduct(uoms, productId);
  const match = list.find((u) => u.uom_code.toLowerCase() === code.toLowerCase());
  return Number(match?.conversion_factor) || 1;
}

function baseUomCode(uoms: ProductUomOption[], productId: string): string {
  return purchaseUomsForProduct(uoms, productId).find((u) => u.is_base)?.uom_code ?? "ea";
}

type DraftLine = {
  variantId: string;
  productName: string;
  quantity: string;
  unitCost: string;
  uomCode: string;
};

export function PurchasingClient({
  organizationId,
  currency,
  canManage,
  vendors,
  stores,
  purchaseOrders,
  bills,
  variants,
  productUoms = [],
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
  productUoms?: ProductUomOption[];
  openBills: OpenBillOption[];
  paymentRuns: PaymentRunRow[];
}) {
  const t = useTranslations("purchasing");
  const tCommon = useTranslations("common");
  const tPos = useTranslations("pos");
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("orders");
  const [busy, setBusy] = useState<string>("");
  const [payBillId, setPayBillId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "mobile_money" | "bank_transfer">("bank_transfer");
  const [localVariants, setLocalVariants] = useState(variants);
  const [localProductUoms, setLocalProductUoms] = useState(productUoms);
  const [quickCreateLine, setQuickCreateLine] = useState<number | null>(null);
  const [quickCreateName, setQuickCreateName] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [expandedPos, setExpandedPos] = useState<Set<string>>(() => {
    // Auto-open receivable POs so ordered products are visible without an extra click.
    return new Set(
      purchaseOrders.filter((p) => canReceivePo(p.status) && poLines(p).length > 0).map((p) => p.id)
    );
  });
  const [confirmReceiveId, setConfirmReceiveId] = useState<string | null>(null);

  function togglePoExpanded(id: string) {
    setExpandedPos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Keep local lists in sync when server props refresh
  useEffect(() => {
    setLocalVariants(variants);
    setLocalProductUoms(productUoms);
  }, [variants, productUoms]);

  // Keep receivable POs expanded after refresh so receive still shows products.
  useEffect(() => {
    setExpandedPos((prev) => {
      const next = new Set(prev);
      for (const p of purchaseOrders) {
        if (canReceivePo(p.status) && poLines(p).length > 0) next.add(p.id);
      }
      // Drop ids that no longer exist
      for (const id of [...next]) {
        if (!purchaseOrders.some((p) => p.id === id)) next.delete(id);
      }
      return next;
    });
  }, [purchaseOrders]);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("categories")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name")
        .limit(200);
      setCategories((data as { id: string; name: string }[] | null) ?? []);
    })();
  }, [organizationId]);

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
        (b) => relationName(b.vendors) || t("po.unknownVendor"),
        (b) => billBalanceDue(b)
      ).slice(0, 8),
    [bills, t]
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
    if (err)
      return toast({
        title: editingVendorId ? t("toast.vendorUpdateFailed") : t("toast.vendorAddFailed"),
        description: err.message,
        variant: "destructive",
      });
    toast({ title: editingVendorId ? t("toast.vendorUpdated") : t("toast.vendorAdded"), description: vName });
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
    if (err) return toast({ title: t("toast.vendorUpdateFailed"), description: err.message, variant: "destructive" });
    toast({ title: active ? t("toast.vendorActivated") : t("toast.vendorDeactivated") });
    router.refresh();
  }

  async function deleteVendor(vendorId: string, vendorName: string) {
    setBusy("vendor");
    const supabase = createClient();
    const { error: err } = await supabase.from("vendors").delete().eq("id", vendorId).eq("organization_id", organizationId);
    setBusy("");
    if (err) {
      return toast({ title: t("toast.vendorDeleteFailed"), description: deleteBlockedMessage(err), variant: "destructive" });
    }
    toast({ title: t("toast.vendorDeleted"), description: vendorName });
    if (editingVendorId === vendorId) resetVendorForm();
    router.refresh();
  }

  // --- PO form ---
  const [poVendor, setPoVendor] = useState("");
  const [poStore, setPoStore] = useState(stores[0]?.id ?? "");
  const [poExpected, setPoExpected] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { variantId: "", productName: "", quantity: "", unitCost: "", uomCode: "ea" },
  ]);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  const mergeRemoteVariants = useCallback((items: ProductVariantSearchOption[]) => {
    setLocalVariants((prev) => {
      const map = new Map(prev.map((v) => [v.id, v]));
      for (const item of items) {
        if (!item.product_id) continue;
        map.set(item.id, {
          id: item.id,
          name: item.name,
          sku: item.sku ?? null,
          barcode: item.barcode ?? null,
          cost_price: item.cost_price,
          product_id: item.product_id,
          products: item.products,
        });
      }
      return [...map.values()];
    });
  }, []);

  function onPickVariant(i: number, variantId: string) {
    const v = localVariants.find((x) => x.id === variantId);
    if (!v) {
      updateLine(i, { variantId, productName: "", unitCost: "", uomCode: "ea" });
      return;
    }
    void ensureUomsForProduct(v.product_id).then((uoms) => {
      const uom = defaultPurchaseUom(uoms, v.product_id);
      const factor = uomFactor(uoms, v.product_id, uom);
      const baseCost = Number(v.cost_price) || 0;
      const lineCost = fromBasePrice(baseCost, factor);
      updateLine(i, {
        variantId,
        productName: variantLabel(v),
        unitCost: baseCost ? formatPriceInput(lineCost) : "",
        uomCode: uom,
      });
    });
  }

  async function ensureUomsForProduct(productId: string): Promise<ProductUomOption[]> {
    const existing = localProductUoms.filter((u) => u.product_id === productId);
    if (existing.length > 0) return localProductUoms;
    const supabase = createClient();
    const { data } = await supabase
      .from("product_uoms")
      .select("product_id, uom_code, uom_name, conversion_factor, is_base, is_purchase, is_sale")
      .eq("organization_id", organizationId)
      .eq("product_id", productId);
    const rows = (data as ProductUomOption[] | null) ?? [];
    if (rows.length === 0) return localProductUoms;
    setLocalProductUoms((prev) => {
      const without = prev.filter((u) => u.product_id !== productId);
      return [...without, ...rows];
    });
    return [...localProductUoms.filter((u) => u.product_id !== productId), ...rows];
  }

  function handleQuickCreated(lineIndex: number, result: PoQuickCreateResult) {
    setLocalVariants((prev) => {
      if (prev.some((v) => v.id === result.variant.id)) return prev;
      return [result.variant, ...prev];
    });
    setLocalProductUoms((prev) => {
      const without = prev.filter((u) => u.product_id !== result.variant.product_id);
      return [...result.uoms, ...without];
    });
    const uom = defaultPurchaseUom(result.uoms, result.variant.product_id);
    const factor = uomFactor(result.uoms, result.variant.product_id, uom);
    const lineCost = fromBasePrice(result.baseCost, factor);
    updateLine(lineIndex, {
      variantId: result.variant.id,
      productName: variantLabel(result.variant),
      unitCost: result.baseCost ? formatPriceInput(lineCost) : "",
      uomCode: uom,
    });
    setQuickCreateLine(null);
    setQuickCreateName("");
    toast({ title: t("toast.productCreatedForPo") });
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
        uomCode: l.uomCode || "ea",
      }));
    if (!poVendor || !poStore || validLines.length === 0) {
      return toast({ title: t("toast.incompletePo"), description: t("toast.incompletePoDesc"), variant: "destructive" });
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
    if (err) return toast({ title: t("toast.poFailed"), description: err.message, variant: "destructive" });
    toast({ title: t("toast.poCreated") });
    setPoVendor("");
    setPoExpected("");
    setLines([{ variantId: "", productName: "", quantity: "", unitCost: "", uomCode: "ea" }]);
    router.refresh();
  }

  async function receivePO(id: string) {
    const po = purchaseOrders.find((p) => p.id === id);
    const lines = po ? poLines(po) : [];
    const remaining = lines.filter((l) => lineRemaining(l) > 0.0005);
    setBusy(id);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("receive_purchase_order", { p_po_id: id });
    setBusy("");
    if (err) return toast({ title: t("toast.receiveFailed"), description: err.message, variant: "destructive" });
    toast({
      title: t("toast.poReceived"),
      description:
        remaining.length > 0
          ? t("toast.poReceivedLines", {
              count: remaining.length,
              items: remaining.map((l) => l.product_name).slice(0, 4).join(", "),
            })
          : t("toast.poReceivedDesc"),
    });
    setConfirmReceiveId(null);
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
    if (err) return toast({ title: t("toast.cancelFailed"), description: err.message, variant: "destructive" });
    toast({ title: t("toast.poCancelled") });
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
    if (err) return toast({ title: t("toast.paymentFailed"), description: err.message, variant: "destructive" });
    toast({ title: pay >= balance - 0.01 ? t("toast.billPaidFull") : t("toast.partialPayment") });
    setPayBillId(null);
    setPayAmount("");
    router.refresh();
  }

  async function postBill(id: string) {
    setBusy(id + "post");
    const supabase = createClient();
    const { error } = await supabase.rpc("post_vendor_bill", { p_bill_id: id });
    setBusy("");
    if (error) return toast({ title: t("toast.postFailed"), description: error.message, variant: "destructive" });
    toast({ title: t("toast.billPosted") });
    router.refresh();
  }

  async function validateMatch(id: string) {
    setBusy(id + "match");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("validate_vendor_bill_match", { p_bill_id: id });
    setBusy("");
    if (error) return toast({ title: t("toast.matchFailed"), description: error.message, variant: "destructive" });
    const row = data as { match_status?: string; variance?: number };
    toast({
      title: t("toast.matchResult", { status: row.match_status ?? t("toast.matchUnknown") }),
      description: row.variance ? t("toast.variance", { value: row.variance }) : undefined,
    });
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
      compact
      breadcrumb={t("title")}
        title={t("title")}
        description={t("description")}
        action={
          <TabBar
            tabs={[
              { key: "orders" as const, label: t("purchaseOrders") },
              ...(canManage ? [{ key: "planning" as const, label: t("planning") }] : []),
              { key: "vendors" as const, label: t("vendors") },
              { key: "bills" as const, label: t("bills") },
              { key: "payment_runs" as const, label: t("paymentRuns") },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label={t("stats.openAp")}
          value={money(summary.apOpen)}
          sub={t("stats.billsCount", { count: summary.openBills })}
          icon={FileText}
        />
        <StatCard label={t("stats.pendingPos")} value={summary.pendingPo} sub={money(summary.poValue)} icon={Package} />
        <StatCard label={t("stats.activeVendors")} value={vendors.length} icon={Building2} />
        <StatCard label={t("stats.totalPos")} value={purchaseOrders.length} icon={Truck} />
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <ChartCard title={t("charts.openApByVendor")} subtitle={t("charts.unpaidBills")}>
          {apByVendor.length > 0 ? (
            <FinanceDonutChart data={apByVendor} formatValue={money} innerRadius={44} height={180} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("charts.noOpenBills")}</p>
          )}
        </ChartCard>
        <ChartCard title={t("charts.poValueByStatus")} subtitle={t("charts.allPos")}>
          {poByStatus.length > 0 ? (
            <FinanceBarChart data={poByStatus} formatValue={money} height={180} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("charts.noPos")}</p>
          )}
        </ChartCard>
        <ChartCard title={t("charts.billsByStatus")} subtitle={t("charts.vendorPayables")}>
          {billsByStatus.length > 0 ? (
            <FinanceDonutChart data={billsByStatus} formatValue={money} innerRadius={44} height={180} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("charts.noBills")}</p>
          )}
        </ChartCard>
        <ChartCard title={t("charts.spendTrend")} subtitle={t("charts.spendTrendSub")}>
          {spendTrend.length > 0 ? (
            <TrendAreaChart data={spendTrend} formatValue={money} height={180} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("charts.noSpendHistory")}</p>
          )}
        </ChartCard>
      </div>

      {tab === "planning" && canManage && (
        <PurchasingScmPanel organizationId={organizationId} stores={stores} canManage={canManage} />
      )}

      {tab === "orders" && (
        <>
          {canManage && (
            <FormCard title={t("po.newPo")}>
                <form onSubmit={createPO} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>{tCommon("vendor")}</Label>
                      <select
                        className={SELECT_CLS}
                        value={poVendor}
                        onChange={(e) => setPoVendor(e.target.value)}
                        required
                      >
                        <option value="">{tCommon("selectEllipsis")}</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("po.receivingStore")}</Label>
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
                      <Label>{t("po.expectedDate")}</Label>
                      <DatePicker value={poExpected} onChange={setPoExpected} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("po.lines")}</Label>
                    {lines.map((l, i) => {
                      const v = localVariants.find((x) => x.id === l.variantId);
                      const uomOptions = v ? purchaseUomsForProduct(localProductUoms, v.product_id) : [];
                      const qty = parseFloat(l.quantity) || 0;
                      const factor = v ? uomFactor(localProductUoms, v.product_id, l.uomCode) : 1;
                      const baseCode = v ? baseUomCode(localProductUoms, v.product_id) : "ea";
                      const baseQty = qty * factor;
                      const baseCost = Number(v?.cost_price) || 0;
                      return (
                      <div key={i} className="space-y-1">
                      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                        <ProductVariantSearchSelect
                          variants={localVariants}
                          value={l.variantId}
                          onChange={(variantId) => onPickVariant(i, variantId)}
                          placeholder={t("po.searchProduct")}
                          organizationId={organizationId}
                          onRemoteResults={mergeRemoteVariants}
                          onCreateProduct={
                            canManage
                              ? (suggested) => {
                                  setQuickCreateLine(i);
                                  setQuickCreateName(suggested);
                                }
                              : undefined
                          }
                        />
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder={t("po.qty")}
                          value={l.quantity}
                          onChange={(e) => updateLine(i, { quantity: e.target.value })}
                        />
                        <select
                          className={SELECT_CLS}
                          value={l.uomCode}
                          disabled={!v}
                          onChange={(e) => {
                            if (!v) {
                              updateLine(i, { uomCode: e.target.value });
                              return;
                            }
                            const next = e.target.value;
                            const prevFactor = uomFactor(localProductUoms, v.product_id, l.uomCode);
                            const nextFactor = uomFactor(localProductUoms, v.product_id, next);
                            const unit = parseFloat(l.unitCost) || 0;
                            const nextBaseCost = prevFactor > 0 ? unit / prevFactor : unit;
                            const nextUnit =
                              nextFactor > 0
                                ? Math.round(nextBaseCost * nextFactor * 10000) / 10000
                                : unit;
                            updateLine(i, {
                              uomCode: next,
                              unitCost: l.unitCost === "" ? "" : String(nextUnit),
                            });
                          }}
                          aria-label={tPos("unitOfMeasure")}
                        >
                          {(uomOptions.length ? uomOptions : [{ uom_code: "ea", uom_name: "Each" }]).map((u) => (
                            <option key={u.uom_code} value={u.uom_code}>
                              {u.uom_name} ({u.uom_code})
                            </option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={t("po.unitCost")}
                          value={l.unitCost}
                          onChange={(e) => updateLine(i, { unitCost: e.target.value })}
                        />
                        <button
                          type="button"
                          className="text-sm text-muted-foreground hover:text-red-600"
                          onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          {tCommon("remove")}
                        </button>
                      </div>
                      {v && (
                        <p className="text-xs text-muted-foreground pl-1">
                          {t("po.costUomHint", {
                            baseCost: formatPriceInput(baseCost),
                            baseUom: baseCode,
                            unitCost: l.unitCost || "0",
                            uom: l.uomCode,
                          })}
                          {qty > 0
                            ? ` · ${t("po.baseEquivalent", {
                                qty,
                                uom: l.uomCode,
                                baseQty: Number(baseQty.toFixed(6)),
                                baseUom: baseCode,
                              })}`
                            : ""}
                        </p>
                      )}
                      </div>
                      );
                    })}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setLines((prev) => [
                          ...prev,
                          { variantId: "", productName: "", quantity: "", unitCost: "", uomCode: "ea" },
                        ])
                      }
                    >
                      {t("po.addLine")}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{t("po.totalLabel", { amount: money(poTotal) })}</p>
                    <Button type="submit" disabled={busy === "po"}>
                      {busy === "po" ? tCommon("creating") : t("createPo")}
                    </Button>
                  </div>
                </form>
            </FormCard>
          )}

          <ReportSection
            title={t("purchaseOrders")}
            subtitle={t("po.ordersCount", { count: purchaseOrders.length })}
            actions={
              <ExportCsvButton
                filename="purchase-orders"
                rows={purchaseOrders.map((po) => ({
                  date: po.order_date,
                  vendor: relationName(po.vendors) || "",
                  store: relationName(po.stores) || "",
                  status: po.status,
                  total: po.total,
                  items: poItemsSummary(po),
                  line_count: poLines(po).length,
                }))}
                columns={[
                  { key: "date", label: tCommon("date") },
                  { key: "vendor", label: tCommon("vendor") },
                  { key: "store", label: tCommon("store") },
                  { key: "status", label: tCommon("status") },
                  { key: "total", label: tCommon("total") },
                  { key: "line_count", label: t("po.lines") },
                  { key: "items", label: t("po.items") },
                ]}
              />
            }
          >
          <ResponsiveTableLayout
            mobile={
              purchaseOrders.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("po.empty")}</p>
              ) : (
                purchaseOrders.map((po) => {
                  const lines = poLines(po);
                  const open = expandedPos.has(po.id);
                  return (
                  <MobileRecordCard key={po.id}>
                    <button
                      type="button"
                      className="mb-3 flex w-full items-start justify-between gap-2 text-left"
                      onClick={() => togglePoExpanded(po.id)}
                      aria-expanded={open}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{relationName(po.vendors) || tCommon("vendor")}</p>
                        <p className="text-xs text-muted-foreground">{po.order_date}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {lines.length === 0
                            ? t("po.noLines")
                            : t("po.lineCount", { count: lines.length })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={po.status} />
                        {open ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                        )}
                      </div>
                    </button>
                    <div className="space-y-1.5">
                      <MobileRecordCardRow label={tCommon("store")}>{relationName(po.stores) || "—"}</MobileRecordCardRow>
                      <MobileRecordCardRow label={tCommon("total")}>{money(po.total)}</MobileRecordCardRow>
                    </div>
                    {open && (
                      <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
                        <p className="text-xs font-medium text-muted-foreground">{t("po.orderedProducts")}</p>
                        {lines.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t("po.noLines")}</p>
                        ) : (
                          lines.map((line) => (
                            <div key={line.id} className="flex items-start justify-between gap-2 text-sm">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{line.product_name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {t("po.qtyReceived", {
                                    received: Number(line.qty_received ?? 0),
                                    ordered: Number(line.quantity),
                                    uom: (line.uom_code || "ea").trim() || "ea",
                                  })}
                                </p>
                              </div>
                              <p className="shrink-0 font-mono text-xs">{money(Number(line.line_total))}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                    {canManage && (canReceivePo(po.status) || canCancelPo(po.status)) && (
                      <div className="mt-3 flex flex-col gap-2">
                        {canReceivePo(po.status) &&
                          (confirmReceiveId === po.id ? (
                            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2.5">
                              <p className="text-xs text-muted-foreground">
                                {lines.length > 0
                                  ? t("po.receiveMessage", { items: poItemsSummary(po) })
                                  : t("po.receiveMessageEmpty")}
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  disabled={busy === po.id}
                                  onClick={() => receivePO(po.id)}
                                >
                                  {busy === po.id ? "…" : t("po.confirmReceive")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy === po.id}
                                  onClick={() => setConfirmReceiveId(null)}
                                >
                                  {tCommon("cancel")}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={busy === po.id || busy === `cancel-${po.id}`}
                              onClick={() => {
                                setExpandedPos((prev) => new Set(prev).add(po.id));
                                setConfirmReceiveId(po.id);
                              }}
                            >
                              {t("receive")}
                            </Button>
                          ))}
                        {canCancelPo(po.status) && (
                          <ConfirmDeleteButton
                            label={t("po.cancelOrder")}
                            confirmLabel={t("po.confirmCancel")}
                            message={t("po.cancelMessage")}
                            disabled={busy === po.id || busy === `cancel-${po.id}`}
                            onConfirm={() => cancelPO(po.id)}
                          />
                        )}
                      </div>
                    )}
                  </MobileRecordCard>
                  );
                })
              )
            }
          >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead className="w-8">{""}</DataTableHead>
                <DataTableHead>{tCommon("date")}</DataTableHead>
                <DataTableHead>{tCommon("vendor")}</DataTableHead>
                <DataTableHead>{t("po.items")}</DataTableHead>
                <DataTableHead>{tCommon("store")}</DataTableHead>
                <DataTableHead>{tCommon("status")}</DataTableHead>
                <DataTableHead align="right">{tCommon("total")}</DataTableHead>
                <DataTableHead align="right">{tCommon("action")}</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {purchaseOrders.length === 0 ? (
                  <DataTableEmpty colSpan={8} message={t("po.empty")} />
                ) : (
                  purchaseOrders.map((po) => {
                    const lines = poLines(po);
                    const open = expandedPos.has(po.id);
                    return (
                      <Fragment key={po.id}>
                        <DataTableRow
                          className={cn("cursor-pointer", open && "bg-muted/20")}
                          onClick={() => togglePoExpanded(po.id)}
                        >
                          <DataTableCell className="w-8 pr-0">
                            {open ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                            )}
                          </DataTableCell>
                          <DataTableCell>{po.order_date}</DataTableCell>
                          <DataTableCell>{relationName(po.vendors)}</DataTableCell>
                          <DataTableCell className="max-w-[14rem]">
                            {lines.length === 0 ? (
                              <span className="text-muted-foreground">{t("po.noLines")}</span>
                            ) : (
                              <span className="line-clamp-2 text-sm" title={poItemsSummary(po)}>
                                {t("po.lineCount", { count: lines.length })}
                                {": "}
                                {lines.map((l) => l.product_name).slice(0, 3).join(", ")}
                                {lines.length > 3 ? "…" : ""}
                              </span>
                            )}
                          </DataTableCell>
                          <DataTableCell>{relationName(po.stores)}</DataTableCell>
                          <DataTableCell><StatusBadge status={po.status} /></DataTableCell>
                          <DataTableCell align="right" className="font-mono">{money(po.total)}</DataTableCell>
                          <DataTableCell align="right" onClick={(e) => e.stopPropagation()}>
                            {canManage && (canReceivePo(po.status) || canCancelPo(po.status)) ? (
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {canReceivePo(po.status) &&
                                  (confirmReceiveId === po.id ? (
                                    <div className="flex max-w-xs flex-col items-end gap-1.5">
                                      <p className="text-right text-xs text-muted-foreground">
                                        {lines.length > 0
                                          ? t("po.receiveMessage", { items: poItemsSummary(po) })
                                          : t("po.receiveMessageEmpty")}
                                      </p>
                                      <div className="flex gap-2">
                                        <Button
                                          size="sm"
                                          disabled={busy === po.id}
                                          onClick={() => receivePO(po.id)}
                                        >
                                          {busy === po.id ? "…" : t("po.confirmReceive")}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          disabled={busy === po.id}
                                          onClick={() => setConfirmReceiveId(null)}
                                        >
                                          {tCommon("cancel")}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <Button
                                      size="sm"
                                      disabled={busy === po.id || busy === `cancel-${po.id}`}
                                      onClick={() => {
                                        setExpandedPos((prev) => new Set(prev).add(po.id));
                                        setConfirmReceiveId(po.id);
                                      }}
                                    >
                                      {t("receive")}
                                    </Button>
                                  ))}
                                {canCancelPo(po.status) && (
                                  <ConfirmDeleteButton
                                    label={tCommon("cancel")}
                                    confirmLabel={tCommon("confirm")}
                                    message={t("po.cancelShort")}
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
                        {open && (
                          <tr className="border-b border-border bg-muted/15">
                            <td colSpan={8} className="px-4 py-3">
                              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {t("po.orderedProducts")}
                              </p>
                              {lines.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t("po.noLines")}</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full min-w-[32rem] text-sm">
                                    <thead>
                                      <tr className="text-left text-xs text-muted-foreground">
                                        <th className="pb-1.5 font-medium">{tCommon("product")}</th>
                                        <th className="pb-1.5 font-medium">{t("po.qty")}</th>
                                        <th className="pb-1.5 font-medium">{t("po.received")}</th>
                                        <th className="pb-1.5 text-right font-medium">{t("po.unitCost")}</th>
                                        <th className="pb-1.5 text-right font-medium">{tCommon("total")}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {lines.map((line) => {
                                        const uom = (line.uom_code || "ea").trim() || "ea";
                                        const ordered = Number(line.quantity);
                                        const received = Number(line.qty_received ?? 0);
                                        return (
                                          <tr key={line.id} className="border-t border-border/60">
                                            <td className="py-1.5 pr-3 font-medium">{line.product_name}</td>
                                            <td className="py-1.5 pr-3 font-mono text-xs">
                                              {ordered} {uom}
                                            </td>
                                            <td className="py-1.5 pr-3 font-mono text-xs">
                                              {received} {uom}
                                              {canReceivePo(po.status) && lineRemaining(line) > 0.0005 ? (
                                                <span className="ml-1 text-muted-foreground">
                                                  ({t("po.remaining", { qty: lineRemaining(line), uom })})
                                                </span>
                                              ) : null}
                                            </td>
                                            <td className="py-1.5 pr-3 text-right font-mono text-xs">
                                              {money(Number(line.unit_cost))}
                                            </td>
                                            <td className="py-1.5 text-right font-mono text-xs">
                                              {money(Number(line.line_total))}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
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
            <FormCard title={editingVendorId ? t("vendorsTab.editVendor") : t("vendorsTab.addVendor")}>
                <form onSubmit={saveVendor} className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{tCommon("name")}</Label>
                    <Input value={vName} onChange={(e) => setVName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>{tCommon("phone")}</Label>
                    <Input value={vPhone} onChange={(e) => setVPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{tCommon("email")}</Label>
                    <Input type="email" value={vEmail} onChange={(e) => setVEmail(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy === "vendor"}>{editingVendorId ? tCommon("update") : tCommon("add")}</Button>
                    {editingVendorId && (
                      <Button type="button" variant="outline" onClick={resetVendorForm}>{tCommon("cancel")}</Button>
                    )}
                  </div>
                </form>
            </FormCard>
          )}
          <ReportSection
            title={t("vendorsTab.directory")}
            subtitle={t("vendorsTab.suppliersCount", { count: vendors.length })}
            actions={
              <ExportCsvButton
                filename="vendors"
                rows={vendors.map((v) => ({
                  name: v.name,
                  phone: v.phone || "",
                  email: v.email || "",
                }))}
                columns={[
                  { key: "name", label: tCommon("name") },
                  { key: "phone", label: tCommon("phone") },
                  { key: "email", label: tCommon("email") },
                ]}
              />
            }
          >
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>{tCommon("name")}</DataTableHead>
                  <DataTableHead>{tCommon("phone")}</DataTableHead>
                  <DataTableHead>{tCommon("email")}</DataTableHead>
                  {canManage && <DataTableHead align="right">{tCommon("actions")}</DataTableHead>}
                </DataTableHeader>
                <DataTableBody>
                  {vendors.length === 0 ? (
                    <DataTableEmpty colSpan={canManage ? 4 : 3} message={t("vendorsTab.empty")} />
                  ) : (
                    vendors.map((v) => (
                      <DataTableRow key={v.id}>
                        <DataTableCell className="font-medium">
                          {v.name}
                          {!v.is_active && (
                            <span className="ml-2 text-xs text-muted-foreground">{t("vendorsTab.inactive")}</span>
                          )}
                        </DataTableCell>
                        <DataTableCell>{v.phone || "—"}</DataTableCell>
                        <DataTableCell>{v.email || "—"}</DataTableCell>
                        {canManage && (
                          <DataTableCell align="right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => startEditVendor(v)}>{tCommon("edit")}</Button>
                              <Button variant="outline" size="sm" onClick={() => setVendorActive(v.id, !v.is_active)}>
                                {v.is_active ? tCommon("deactivate") : tCommon("activate")}
                              </Button>
                              <ConfirmDeleteButton
                                message={t("vendorsTab.deleteMessage")}
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
          title={t("billsTab.title")}
          subtitle={t("billsTab.summary", { count: bills.length, amount: money(summary.apOpen) })}
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
                { key: "date", label: tCommon("date") },
                { key: "vendor", label: tCommon("vendor") },
                { key: "status", label: tCommon("status") },
                { key: "amount", label: tCommon("amount") },
              ]}
            />
          }
        >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>{tCommon("date")}</DataTableHead>
              <DataTableHead>{tCommon("vendor")}</DataTableHead>
              <DataTableHead>{tCommon("status")}</DataTableHead>
              <DataTableHead>{t("billsTab.match")}</DataTableHead>
              <DataTableHead align="right">{tCommon("amount")}</DataTableHead>
              <DataTableHead align="right">{tCommon("balance")}</DataTableHead>
              <DataTableHead align="right">{tCommon("action")}</DataTableHead>
            </DataTableHeader>
          <DataTableBody>
            {bills.length === 0 ? (
              <DataTableEmpty colSpan={7} message={t("billsTab.empty")} />
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
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => postBill(b.id)}>{t("billsTab.post")}</Button>
                    )}
                    {canManage && b.po_id && isPayableBill(b) && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => validateMatch(b.id)}>{t("billsTab.match")}</Button>
                    )}
                    {canManage && isPayableBill(b) && billBalanceDue(b) > 0.01 && (
                      <Button size="sm" disabled={busy === b.id} onClick={() => openPayDialog(b)}>{t("billsTab.pay")}</Button>
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
            title={t("billsTab.payTitle")}
            onSubmit={(e) => {
              e.preventDefault();
              void payBill(payBillId, Number(payAmount) || undefined);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{tCommon("amount")}</Label>
                <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>{t("billsTab.method")}</Label>
                <select className={SELECT_CLS} value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
                  <option value="bank_transfer">{t("billsTab.bankTransfer")}</option>
                  <option value="cash">{t("billsTab.cash")}</option>
                  <option value="mobile_money">{t("billsTab.mobileMoney")}</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="submit" disabled={!!busy}>{t("billsTab.applyPayment")}</Button>
              <Button type="button" variant="outline" onClick={() => setPayBillId(null)}>{tCommon("cancel")}</Button>
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

      {quickCreateLine != null && (
        <PoQuickCreateProductModal
          organizationId={organizationId}
          categories={categories}
          initialName={quickCreateName}
          onClose={() => {
            setQuickCreateLine(null);
            setQuickCreateName("");
          }}
          onCreated={(result) => handleQuickCreated(quickCreateLine, result)}
        />
      )}
    </div>
  );
}
