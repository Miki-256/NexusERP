"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/page-header";
import { FormCard } from "@/components/layout/form-card";
import { TabBar } from "@/components/layout/tab-bar";
import { StatusBadge } from "@/components/layout/status-badge";
import { TablePagination, TableToolbar } from "@/components/layout/table-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { parsePaginatedRpc } from "@/lib/hr/mutations";
import type { InventoryLevelPageRow, StockMovementRow, StorageLocationRow, WarehouseRow } from "@/lib/scm/types";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { formatOrgDateTimeFull } from "@/lib/finance-dates";
import { AlertTriangle, ArrowRightLeft, Boxes, History, MapPin, Warehouse } from "lucide-react";
import { InventoryAnalyticsPanel } from "@/components/scm/inventory-analytics-panel";
import { InventoryOperationsPanel } from "@/components/scm/inventory-operations-panel";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";

type Tab = "stock" | "movements" | "transfers" | "warehouses" | "operations" | "analytics" | "alerts";

type LowStockItem = {
  store_id: string;
  store_name: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  quantity: number;
  reorder_point: number;
};

type VariantOption = {
  variant_id: string;
  label: string;
  product_id?: string;
};

type InvUomOption = {
  uom_code: string;
  uom_name: string;
  conversion_factor: number;
  is_base: boolean;
};

function productLabel(row: InventoryLevelPageRow) {
  return row.variant_name === "Default"
    ? row.product_name
    : `${row.product_name} (${row.variant_name})`;
}

function qtyWithUom(qty: number, uom?: string | null) {
  const code = uom?.trim() || "ea";
  return `${qty} ${code}`;
}

export function InventoryClient({
  organizationId,
  stores,
  storeId: initialStoreId,
  inventory: initialInventory,
  inventoryTotal,
  page,
  pageSize,
  search,
  canManage,
  currency,
  timeZone = "Africa/Addis_Ababa",
}: {
  organizationId: string;
  stores: { id: string; name: string }[];
  storeId: string;
  inventory: InventoryLevelPageRow[];
  inventoryTotal: number;
  page: number;
  pageSize: number;
  search: string;
  canManage: boolean;
  currency: string;
  timeZone?: string;
}) {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("stock");
  const [storeId, setStoreId] = useState(initialStoreId);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [lowStockLoaded, setLowStockLoaded] = useState(false);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [movementPage, setMovementPage] = useState(1);
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [adjustVariant, setAdjustVariant] = useState("");
  const [adjustUom, setAdjustUom] = useState("ea");
  const [adjustUoms, setAdjustUoms] = useState<InvUomOption[]>([]);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [fromStoreId, setFromStoreId] = useState(stores[0]?.id ?? "");
  const [toStoreId, setToStoreId] = useState(stores[1]?.id ?? stores[0]?.id ?? "");
  const [transferVariant, setTransferVariant] = useState("");
  const [transferUom, setTransferUom] = useState("ea");
  const [transferUoms, setTransferUoms] = useState<InvUomOption[]>([]);
  const [transferQty, setTransferQty] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehousesLoaded, setWarehousesLoaded] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [locations, setLocations] = useState<StorageLocationRow[]>([]);
  const [locationCode, setLocationCode] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationType, setLocationType] = useState("bin");

  function navigateStock(next: { store?: string; page?: number; q?: string }) {
    const params = new URLSearchParams();
    const sid = next.store ?? storeId;
    const pg = next.page ?? page;
    const q = next.q !== undefined ? next.q : search;
    if (sid) params.set("store", sid);
    if (pg > 1) params.set("page", String(pg));
    if (q) params.set("q", q);
    router.push(`/inventory?${params.toString()}`);
  }

  function submitSearch() {
    navigateStock({ q: searchInput.trim(), page: 1 });
  }

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const applied = search.trim();
    if (trimmed === applied) return;
    const id = window.setTimeout(() => {
      navigateStock({ q: trimmed, page: 1 });
    }, 280);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  async function loadMovements(pg = movementPage) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_stock_movements", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
      p_limit: 30,
      p_offset: (pg - 1) * 30,
    });
    if (error) {
      toast({ title: t("toast.movementsFailed"), description: error.message, variant: "destructive" });
      return;
    }
    const parsed = parsePaginatedRpc<StockMovementRow>(data);
    setMovements(parsed.items);
    setMovementsTotal(parsed.total_count);
    setMovementsLoaded(true);
    setMovementPage(pg);
  }

  async function loadVariants() {
    if (variantsLoaded) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("product_variants")
      .select("id, name, product_id, products(name)")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name")
      .limit(100);
    setVariantOptions(
      (data ?? []).map((v) => {
        const product = Array.isArray(v.products) ? v.products[0] : v.products;
        const productName = (product as { name?: string } | null)?.name ?? "Product";
        return {
          variant_id: v.id,
          product_id: v.product_id as string,
          label: v.name === "Default" ? productName : `${productName} (${v.name})`,
        };
      })
    );
    setVariantsLoaded(true);
  }

  async function loadUomsForProduct(productId: string | undefined): Promise<InvUomOption[]> {
    if (!productId) {
      return [{ uom_code: "ea", uom_name: "Each", conversion_factor: 1, is_base: true }];
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("product_uoms")
      .select("uom_code, uom_name, conversion_factor, is_base")
      .eq("product_id", productId)
      .order("is_base", { ascending: false });
    const rows = (data as InvUomOption[] | null) ?? [];
    if (rows.length === 0) {
      return [{ uom_code: "ea", uom_name: "Each", conversion_factor: 1, is_base: true }];
    }
    return rows;
  }

  async function loadWarehouses() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_warehouses", { p_org_id: organizationId });
    if (error) {
      toast({ title: t("toast.warehousesFailed"), description: error.message, variant: "destructive" });
      return;
    }
    const rows = (data ?? []) as WarehouseRow[];
    setWarehouses(rows);
    setWarehousesLoaded(true);
    if (!selectedWarehouseId && rows[0]) setSelectedWarehouseId(rows[0].id);
    if (rows[0]) void loadLocations(rows[0].id);
  }

  async function loadLocations(warehouseId: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_storage_locations", {
      p_warehouse_id: warehouseId,
      p_parent_id: null,
    });
    if (error) {
      toast({ title: t("toast.locationsFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setLocations((data ?? []) as StorageLocationRow[]);
  }

  async function handleAddLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !selectedWarehouseId || !locationCode.trim() || !locationName.trim()) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_storage_location", {
      p_warehouse_id: selectedWarehouseId,
      p_code: locationCode.trim(),
      p_name: locationName.trim(),
      p_location_type: locationType,
    });
    setLoading(false);
    if (error) {
      toast({ title: t("toast.locationAddFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("toast.locationSaved"), description: t("toast.locationSavedDesc", { code: locationCode }) });
    setLocationCode("");
    setLocationName("");
    void loadLocations(selectedWarehouseId);
    void loadWarehouses();
  }

  function storeNameForWarehouse(wh: WarehouseRow) {
    return stores.find((s) => s.id === wh.store_id)?.name ?? "—";
  }

  async function loadLowStock(sid?: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_low_stock_items", {
      p_organization_id: organizationId,
      p_store_id: sid || null,
    });
    if (error) {
      toast({ title: t("toast.alertsFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setLowStock((data ?? []) as LowStockItem[]);
    setLowStockLoaded(true);
  }

  async function handleTabChange(next: Tab) {
    setTab(next);
    if (next === "alerts" && !lowStockLoaded) void loadLowStock(storeId);
    if (next === "transfers") void loadVariants();
    if (next === "movements" && !movementsLoaded) void loadMovements(1);
    if (next === "warehouses" && !warehousesLoaded) void loadWarehouses();
    if (next === "operations") void loadVariants();
  }

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !adjustVariant) return;
    const factor = Number(adjustUoms.find((u) => u.uom_code === adjustUom)?.conversion_factor) || 1;
    const entered = parseFloat(delta);
    if (!Number.isFinite(entered)) return;
    const baseDelta = Math.round(entered * factor * 1e6) / 1e6;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("adjust_inventory", {
      p_store_id: storeId,
      p_variant_id: adjustVariant,
      p_delta: baseDelta,
      p_reason: reason,
    });
    setLoading(false);
    if (error) return toast({ title: t("toast.adjustFailed"), description: error.message, variant: "destructive" });
    toast({
      title: t("toast.adjusted"),
      description: t("toast.adjustedDesc", { delta: `${entered} ${adjustUom} (${baseDelta} base)` }),
    });
    setDelta("");
    setReason("");
    setAdjustVariant("");
    setAdjustUom("ea");
    setAdjustUoms([]);
    setMovementsLoaded(false);
    router.refresh();
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !transferVariant) return;
    const factor = Number(transferUoms.find((u) => u.uom_code === transferUom)?.conversion_factor) || 1;
    const entered = parseFloat(transferQty);
    if (!Number.isFinite(entered) || entered <= 0) return;
    const baseQty = Math.round(entered * factor * 1e6) / 1e6;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("transfer_stock", {
      p_from_store_id: fromStoreId,
      p_to_store_id: toStoreId,
      p_variant_id: transferVariant,
      p_quantity: baseQty,
      p_note: transferNote.trim() || null,
    });
    setLoading(false);
    if (error) {
      toast({ title: t("toast.transferFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("toast.transferred"), description: t("toast.transferredDesc") });
    setTransferQty("");
    setTransferNote("");
    setTransferVariant("");
    setTransferUom("ea");
    setTransferUoms([]);
    setMovementsLoaded(false);
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
      compact
      title={t("title")}
        description={t("skuCount", { count: inventoryTotal })}
        action={
          <select
            className={SELECT_CLS + " w-auto min-w-[180px]"}
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value);
              setMovementsLoaded(false);
              navigateStock({ store: e.target.value, page: 1 });
            }}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        }
      />

      <TabBar
        tabs={[
          { key: "stock", label: t("tabs.stock") },
          { key: "movements", label: t("tabs.movements") },
          { key: "warehouses", label: t("tabs.warehouses") },
          { key: "operations", label: t("tabs.operations") },
          { key: "analytics", label: t("tabs.analytics") },
          { key: "transfers", label: t("tabs.transfers") },
          {
            key: "alerts",
            label: lowStockLoaded && lowStock.length
              ? t("tabs.lowStockCount", { count: lowStock.length })
              : t("tabs.lowStock"),
          },
        ]}
        value={tab}
        onChange={(k) => void handleTabChange(k as Tab)}
        className="mb-4"
      />

      {tab === "stock" && canManage && (
        <FormCard title={t("adjust.title")}>
          <form onSubmit={handleAdjust} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label>{t("adjust.product")}</Label>
              <select
                className={SELECT_CLS}
                value={adjustVariant}
                onChange={(e) => {
                  const next = e.target.value;
                  setAdjustVariant(next);
                  const row = initialInventory.find((r) => r.variant_id === next);
                  void loadUomsForProduct(row?.product_id).then((uoms) => {
                    setAdjustUoms(uoms);
                    setAdjustUom(uoms.find((u) => u.is_base)?.uom_code ?? uoms[0]?.uom_code ?? "ea");
                  });
                }}
                required
              >
                <option value="">{t("adjust.select")}</option>
                {initialInventory.map((row) => (
                  <option key={row.variant_id} value={row.variant_id}>{productLabel(row)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t("adjust.uom")}</Label>
              <select className={SELECT_CLS} value={adjustUom} onChange={(e) => setAdjustUom(e.target.value)} disabled={!adjustVariant}>
                {(adjustUoms.length ? adjustUoms : [{ uom_code: "ea", uom_name: "Each", conversion_factor: 1, is_base: true }]).map((u) => (
                  <option key={u.uom_code} value={u.uom_code}>
                    {u.uom_name} ({u.uom_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2"><Label>{t("adjust.delta")}</Label><Input type="number" step="any" value={delta} onChange={(e) => setDelta(e.target.value)} required /></div>
            <div className="space-y-2"><Label>{t("adjust.reason")}</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} required /></div>
            <Button type="submit" disabled={loading} className="self-end">{loading ? t("adjust.applying") : t("adjust.apply")}</Button>
          </form>
        </FormCard>
      )}

      {tab === "transfers" && canManage && stores.length >= 2 && (
        <FormCard title={t("transfer.title")}>
          <form onSubmit={handleTransfer} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("transfer.fromStore")}</Label>
              <select className={SELECT_CLS} value={fromStoreId} onChange={(e) => setFromStoreId(e.target.value)} required>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t("transfer.toStore")}</Label>
              <select className={SELECT_CLS} value={toStoreId} onChange={(e) => setToStoreId(e.target.value)} required>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t("transfer.variant")}</Label>
              <select
                className={SELECT_CLS}
                value={transferVariant}
                onChange={(e) => {
                  const next = e.target.value;
                  setTransferVariant(next);
                  const opt = variantOptions.find((v) => v.variant_id === next);
                  const inv = initialInventory.find((r) => r.variant_id === next);
                  void loadUomsForProduct(opt?.product_id ?? inv?.product_id).then((uoms) => {
                    setTransferUoms(uoms);
                    setTransferUom(uoms.find((u) => u.is_base)?.uom_code ?? uoms[0]?.uom_code ?? "ea");
                  });
                }}
                required
              >
                <option value="">{t("transfer.select")}</option>
                {variantOptions.map((v) => (
                  <option key={v.variant_id} value={v.variant_id}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t("transfer.uom")}</Label>
              <select className={SELECT_CLS} value={transferUom} onChange={(e) => setTransferUom(e.target.value)} disabled={!transferVariant}>
                {(transferUoms.length ? transferUoms : [{ uom_code: "ea", uom_name: "Each", conversion_factor: 1, is_base: true }]).map((u) => (
                  <option key={u.uom_code} value={u.uom_code}>
                    {u.uom_name} ({u.uom_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2"><Label>{t("transfer.quantity")}</Label><Input type="number" min="0.001" step="any" value={transferQty} onChange={(e) => setTransferQty(e.target.value)} required /></div>
            <div className="space-y-2 sm:col-span-2"><Label>{t("transfer.note")}</Label><Input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder={t("transfer.optional")} /></div>
            <Button type="submit" disabled={loading} className="sm:col-span-2 lg:col-span-3 w-fit">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              {loading ? t("transfer.transferring") : t("transfer.submit")}
            </Button>
          </form>
        </FormCard>
      )}

      {tab === "transfers" && stores.length < 2 && (
        <FormCard title={t("transfer.title")}>
          <p className="text-sm text-muted-foreground">{t("transfer.needTwoStores")}</p>
        </FormCard>
      )}

      {tab === "stock" && (
        <>
          <TableToolbar
            search={searchInput}
            onSearchChange={setSearchInput}
            onSearchSubmit={submitSearch}
            placeholder={t("searchPlaceholder")}
            className="mb-3"
          />
          <div className="space-y-3 lg:hidden">
            {initialInventory.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("stock.empty")}</p>
            ) : (
              initialInventory.map((row) => {
                const low = row.reorder_point > 0 && row.quantity <= row.reorder_point;
                return (
                  <MobileRecordCard key={row.id}>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Boxes className="h-4 w-4" />
                      </div>
                      <p className="min-w-0 flex-1 font-semibold leading-snug">{productLabel(row)}</p>
                    </div>
                    <div className="space-y-1.5">
                      <MobileRecordCardRow label={t("transfer.quantity")}>
                        <span className={low ? "text-amber-700" : undefined}>
                          {qtyWithUom(row.quantity, row.base_uom_code)}
                        </span>
                      </MobileRecordCardRow>
                      <MobileRecordCardRow label={t("stock.reorderAt")}>{row.reorder_point > 0 ? row.reorder_point : "—"}</MobileRecordCardRow>
                    </div>
                  </MobileRecordCard>
                );
              })
            )}
          </div>

          <div className="hidden lg:block">
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>{t("stock.product")}</DataTableHead>
                  <DataTableHead align="right">{t("stock.quantity")}</DataTableHead>
                  <DataTableHead align="right">{t("stock.reorderAt")}</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {initialInventory.length === 0 ? (
                    <DataTableEmpty colSpan={3} message={t("stock.empty")} />
                  ) : (
                    initialInventory.map((row) => {
                      const low = row.reorder_point > 0 && row.quantity <= row.reorder_point;
                      return (
                        <DataTableRow key={row.id}>
                          <DataTableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Boxes className="h-4 w-4" />
                              </div>
                              <span className="font-medium">{productLabel(row)}</span>
                            </div>
                          </DataTableCell>
                          <DataTableCell align="right" className={`font-mono text-base font-semibold ${low ? "text-amber-700" : ""}`}>
                            {qtyWithUom(row.quantity, row.base_uom_code)}
                          </DataTableCell>
                          <DataTableCell align="right" className="text-muted-foreground">
                            {row.reorder_point > 0 ? row.reorder_point : "—"}
                          </DataTableCell>
                        </DataTableRow>
                      );
                    })
                  )}
                </DataTableBody>
              </table>
            </DataTable>
          </div>
          <TablePagination
            page={page}
            totalPages={Math.max(1, Math.ceil(inventoryTotal / pageSize))}
            total={inventoryTotal}
            onPageChange={(p) => navigateStock({ page: p })}
          />
        </>
      )}

      {tab === "warehouses" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {t("warehouses.linked", { count: warehouses.length })}
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadWarehouses()}>
              <Warehouse className="mr-2 h-4 w-4" />
              {tCommon("refresh")}
            </Button>
          </div>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>{t("warehouses.code")}</DataTableHead>
                <DataTableHead>{t("warehouses.name")}</DataTableHead>
                <DataTableHead>{t("warehouses.store")}</DataTableHead>
                <DataTableHead>{t("warehouses.type")}</DataTableHead>
                <DataTableHead align="right">{t("warehouses.locations")}</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {warehouses.length === 0 ? (
                  <DataTableEmpty colSpan={5} message={t("warehouses.empty")} />
                ) : (
                  warehouses.map((wh) => (
                    <DataTableRow
                      key={wh.id}
                      selected={selectedWarehouseId === wh.id}
                    >
                      <DataTableCell>
                        <button
                          type="button"
                          className="text-left font-mono text-sm hover:underline"
                          onClick={() => {
                            setSelectedWarehouseId(wh.id);
                            void loadLocations(wh.id);
                          }}
                        >
                          {wh.code}
                        </button>
                      </DataTableCell>
                      <DataTableCell className="font-medium">{wh.name}</DataTableCell>
                      <DataTableCell>{storeNameForWarehouse(wh)}</DataTableCell>
                      <DataTableCell><StatusBadge status={wh.warehouse_type} /></DataTableCell>
                      <DataTableCell align="right">{wh.location_count}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>

          {selectedWarehouseId && (
            <div className="mt-6">
              <FormCard title={t("warehouses.storageLocations")}>
                {canManage && (
                  <form onSubmit={handleAddLocation} className="mb-4 grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2">
                      <Label>{t("warehouses.code")}</Label>
                      <Input value={locationCode} onChange={(e) => setLocationCode(e.target.value)} placeholder={t("warehouses.codePlaceholder")} required />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("warehouses.name")}</Label>
                      <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder={t("warehouses.namePlaceholder")} required />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("warehouses.type")}</Label>
                      <select className={SELECT_CLS} value={locationType} onChange={(e) => setLocationType(e.target.value)}>
                        <option value="zone">{t("warehouses.types.zone")}</option>
                        <option value="aisle">{t("warehouses.types.aisle")}</option>
                        <option value="rack">{t("warehouses.types.rack")}</option>
                        <option value="shelf">{t("warehouses.types.shelf")}</option>
                        <option value="bin">{t("warehouses.types.bin")}</option>
                        <option value="staging">{t("warehouses.types.staging")}</option>
                        <option value="dock">{t("warehouses.types.dock")}</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button type="submit" disabled={loading}>
                        <MapPin className="mr-2 h-4 w-4" />
                        {loading ? tCommon("loading") : t("warehouses.addLocation")}
                      </Button>
                    </div>
                  </form>
                )}
                <DataTable>
                  <table className="w-full">
                    <DataTableHeader>
                      <DataTableHead>{t("warehouses.code")}</DataTableHead>
                      <DataTableHead>{t("warehouses.name")}</DataTableHead>
                      <DataTableHead>{t("warehouses.type")}</DataTableHead>
                      <DataTableHead>{t("warehouses.pick")}</DataTableHead>
                      <DataTableHead>{t("warehouses.receive")}</DataTableHead>
                    </DataTableHeader>
                    <DataTableBody>
                      {locations.length === 0 ? (
                        <DataTableEmpty colSpan={5} message={t("warehouses.noLocations")} />
                      ) : (
                        locations.map((loc) => (
                          <DataTableRow key={loc.id}>
                            <DataTableCell className="font-mono text-sm">{loc.code}</DataTableCell>
                            <DataTableCell>{loc.name}</DataTableCell>
                            <DataTableCell><StatusBadge status={loc.location_type} /></DataTableCell>
                            <DataTableCell>{loc.is_pickable ? tCommon("yes") : tCommon("no")}</DataTableCell>
                            <DataTableCell>{loc.is_receivable ? tCommon("yes") : tCommon("no")}</DataTableCell>
                          </DataTableRow>
                        ))
                      )}
                    </DataTableBody>
                  </table>
                </DataTable>
              </FormCard>
            </div>
          )}
        </>
      )}

      {tab === "analytics" && (
        <InventoryAnalyticsPanel
          organizationId={organizationId}
          storeId={storeId}
          currency={currency}
          canManage={canManage}
        />
      )}

      {tab === "operations" && (
        <InventoryOperationsPanel
          organizationId={organizationId}
          storeId={storeId}
          stores={stores}
          variantOptions={variantOptions.length ? variantOptions : initialInventory.map((row) => ({
            variant_id: row.variant_id,
            label: productLabel(row),
          }))}
          canManage={canManage}
        />
      )}

      {tab === "movements" && (
        <>
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {storeId
                ? t("movements.countAtStore", { count: movementsTotal })
                : t("movements.count", { count: movementsTotal })}
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadMovements(movementPage)}>
              <History className="mr-2 h-4 w-4" />
              {tCommon("refresh")}
            </Button>
          </div>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>{t("movements.when")}</DataTableHead>
                <DataTableHead>{t("warehouses.type")}</DataTableHead>
                <DataTableHead>{t("stock.product")}</DataTableHead>
                <DataTableHead align="right">{t("movements.delta")}</DataTableHead>
                <DataTableHead align="right">{t("movements.after")}</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {movements.length === 0 ? (
                  <DataTableEmpty colSpan={5} message={t("movements.empty")} />
                ) : (
                  movements.flatMap((m) =>
                    (m.lines ?? []).map((line) => (
                      <DataTableRow key={`${m.id}-${line.id}`}>
                        <DataTableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatOrgDateTimeFull(m.created_at, timeZone)}
                        </DataTableCell>
                        <DataTableCell>
                          <StatusBadge status={m.movement_type} />
                        </DataTableCell>
                        <DataTableCell>
                          <div className="font-medium">{line.product_name}</div>
                          <div className="text-xs text-muted-foreground">{line.store_name}</div>
                        </DataTableCell>
                        <DataTableCell align="right" className={`font-mono ${line.quantity_delta < 0 ? "text-red-600" : "text-green-700"}`}>
                          {line.quantity_delta > 0 ? "+" : ""}{line.quantity_delta}
                        </DataTableCell>
                        <DataTableCell align="right" className="font-mono">{line.quantity_after}</DataTableCell>
                      </DataTableRow>
                    ))
                  )
                )}
              </DataTableBody>
            </table>
          </DataTable>
          {movementsTotal > 30 && (
            <TablePagination
              page={movementPage}
              totalPages={Math.max(1, Math.ceil(movementsTotal / 30))}
              total={movementsTotal}
              onPageChange={(p) => void loadMovements(p)}
            />
          )}
        </>
      )}

      {tab === "alerts" && (
        <>
          <div className="space-y-3 lg:hidden">
            {lowStock.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t("alerts.empty")}
              </p>
            ) : (
              lowStock.map((item) => (
                <MobileRecordCard key={`${item.store_id}-${item.variant_id}`}>
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    {item.product_name}
                    {item.variant_name !== "Default" && ` (${item.variant_name})`}
                  </div>
                  <div className="space-y-1.5">
                    <MobileRecordCardRow label={t("alerts.store")}>{item.store_name}</MobileRecordCardRow>
                    <MobileRecordCardRow label={t("alerts.onHand")}>
                      <span className="text-amber-700">{item.quantity}</span>
                    </MobileRecordCardRow>
                    <MobileRecordCardRow label={t("stock.reorderAt")}>{item.reorder_point}</MobileRecordCardRow>
                  </div>
                </MobileRecordCard>
              ))
            )}
          </div>

          <div className="hidden lg:block">
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>{t("alerts.store")}</DataTableHead>
                  <DataTableHead>{t("stock.product")}</DataTableHead>
                  <DataTableHead align="right">{t("alerts.onHand")}</DataTableHead>
                  <DataTableHead align="right">{t("alerts.reorderPoint")}</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {lowStock.length === 0 ? (
                    <DataTableEmpty colSpan={4} message={t("alerts.empty")} />
                  ) : (
                    lowStock.map((item) => (
                      <DataTableRow key={`${item.store_id}-${item.variant_id}`}>
                        <DataTableCell>{item.store_name}</DataTableCell>
                        <DataTableCell>
                          <span className="inline-flex items-center gap-2 font-medium">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            {item.product_name}
                            {item.variant_name !== "Default" && ` (${item.variant_name})`}
                          </span>
                        </DataTableCell>
                        <DataTableCell align="right" className="font-mono font-semibold text-amber-700">
                          {item.quantity}
                        </DataTableCell>
                        <DataTableCell align="right" className="text-muted-foreground">{item.reorder_point}</DataTableCell>
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
