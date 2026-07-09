"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
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
};

function productLabel(row: InventoryLevelPageRow) {
  return row.variant_name === "Default"
    ? row.product_name
    : `${row.product_name} (${row.variant_name})`;
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
}) {
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
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [fromStoreId, setFromStoreId] = useState(stores[0]?.id ?? "");
  const [toStoreId, setToStoreId] = useState(stores[1]?.id ?? stores[0]?.id ?? "");
  const [transferVariant, setTransferVariant] = useState("");
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

  async function loadMovements(pg = movementPage) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_stock_movements", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
      p_limit: 30,
      p_offset: (pg - 1) * 30,
    });
    if (error) {
      toast({ title: "Could not load movements", description: error.message, variant: "destructive" });
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
      .select("id, name, products(name)")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name")
      .limit(500);
    setVariantOptions(
      (data ?? []).map((v) => {
        const product = Array.isArray(v.products) ? v.products[0] : v.products;
        const productName = (product as { name?: string } | null)?.name ?? "Product";
        return {
          variant_id: v.id,
          label: v.name === "Default" ? productName : `${productName} (${v.name})`,
        };
      })
    );
    setVariantsLoaded(true);
  }

  async function loadWarehouses() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_warehouses", { p_org_id: organizationId });
    if (error) {
      toast({ title: "Could not load warehouses", description: error.message, variant: "destructive" });
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
      toast({ title: "Could not load locations", description: error.message, variant: "destructive" });
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
      toast({ title: "Could not add location", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Location saved", description: `${locationCode} added.` });
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
      toast({ title: "Could not load alerts", description: error.message, variant: "destructive" });
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
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("adjust_inventory", {
      p_store_id: storeId,
      p_variant_id: adjustVariant,
      p_delta: parseFloat(delta),
      p_reason: reason,
    });
    setLoading(false);
    if (error) return toast({ title: "Adjustment failed", description: error.message, variant: "destructive" });
    toast({ title: "Stock adjusted", description: `Delta ${delta} applied.` });
    setDelta("");
    setReason("");
    setAdjustVariant("");
    setMovementsLoaded(false);
    router.refresh();
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !transferVariant) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("transfer_stock", {
      p_from_store_id: fromStoreId,
      p_to_store_id: toStoreId,
      p_variant_id: transferVariant,
      p_quantity: parseFloat(transferQty),
      p_note: transferNote.trim() || null,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Stock transferred", description: "Inventory moved between stores." });
    setTransferQty("");
    setTransferNote("");
    setMovementsLoaded(false);
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Inventory"
        description={`${inventoryTotal} SKU${inventoryTotal === 1 ? "" : "s"} at selected store`}
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
          { key: "stock", label: "Stock levels" },
          { key: "movements", label: "Movements" },
          { key: "warehouses", label: "Warehouses" },
          { key: "operations", label: "Operations" },
          { key: "analytics", label: "Analytics" },
          { key: "transfers", label: "Transfers" },
          {
            key: "alerts",
            label: lowStockLoaded
              ? `Low stock${lowStock.length ? ` (${lowStock.length})` : ""}`
              : "Low stock",
          },
        ]}
        value={tab}
        onChange={(k) => void handleTabChange(k as Tab)}
        className="mb-6"
      />

      {tab === "stock" && canManage && (
        <FormCard title="Adjust stock">
          <form onSubmit={handleAdjust} className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Product</Label>
              <select className={SELECT_CLS} value={adjustVariant} onChange={(e) => setAdjustVariant(e.target.value)} required>
                <option value="">Select…</option>
                {initialInventory.map((row) => (
                  <option key={row.variant_id} value={row.variant_id}>{productLabel(row)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2"><Label>Delta (+/-)</Label><Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} required /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} required /></div>
            <Button type="submit" disabled={loading}>{loading ? "Applying…" : "Apply"}</Button>
          </form>
        </FormCard>
      )}

      {tab === "transfers" && canManage && stores.length >= 2 && (
        <FormCard title="Transfer between stores">
          <form onSubmit={handleTransfer} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>From store</Label>
              <select className={SELECT_CLS} value={fromStoreId} onChange={(e) => setFromStoreId(e.target.value)} required>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>To store</Label>
              <select className={SELECT_CLS} value={toStoreId} onChange={(e) => setToStoreId(e.target.value)} required>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Variant</Label>
              <select className={SELECT_CLS} value={transferVariant} onChange={(e) => setTransferVariant(e.target.value)} required>
                <option value="">Select…</option>
                {variantOptions.map((v) => (
                  <option key={v.variant_id} value={v.variant_id}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2"><Label>Quantity</Label><Input type="number" min="0.001" step="any" value={transferQty} onChange={(e) => setTransferQty(e.target.value)} required /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Note</Label><Input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Optional" /></div>
            <Button type="submit" disabled={loading} className="sm:col-span-2 lg:col-span-3 w-fit">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              {loading ? "Transferring…" : "Transfer stock"}
            </Button>
          </form>
        </FormCard>
      )}

      {tab === "transfers" && stores.length < 2 && (
        <FormCard title="Transfer between stores">
          <p className="text-sm text-muted-foreground">Add at least two stores to transfer stock.</p>
        </FormCard>
      )}

      {tab === "stock" && (
        <>
          <TableToolbar
            search={searchInput}
            onSearchChange={setSearchInput}
            onSearchSubmit={submitSearch}
            placeholder="Search products, SKU, barcode…"
            className="mb-4"
          />
          <div className="space-y-3 lg:hidden">
            {initialInventory.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No inventory at this store.</p>
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
                      <MobileRecordCardRow label="Quantity">
                        <span className={low ? "text-amber-700" : undefined}>{row.quantity}</span>
                      </MobileRecordCardRow>
                      <MobileRecordCardRow label="Reorder at">{row.reorder_point > 0 ? row.reorder_point : "—"}</MobileRecordCardRow>
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
                  <DataTableHead>Product</DataTableHead>
                  <DataTableHead align="right">Quantity</DataTableHead>
                  <DataTableHead align="right">Reorder at</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {initialInventory.length === 0 ? (
                    <DataTableEmpty colSpan={3} message="No inventory at this store." />
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
                            {row.quantity}
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
              {warehouses.length} warehouse{warehouses.length === 1 ? "" : "s"} linked to stores
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadWarehouses()}>
              <Warehouse className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Code</DataTableHead>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Store</DataTableHead>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead align="right">Locations</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {warehouses.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No warehouses yet. They are created automatically per store." />
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
              <FormCard title="Storage locations">
                {canManage && (
                  <form onSubmit={handleAddLocation} className="mb-4 grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Code</Label>
                      <Input value={locationCode} onChange={(e) => setLocationCode(e.target.value)} placeholder="BIN-A1" required />
                    </div>
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="Aisle A bin 1" required />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <select className={SELECT_CLS} value={locationType} onChange={(e) => setLocationType(e.target.value)}>
                        <option value="zone">Zone</option>
                        <option value="aisle">Aisle</option>
                        <option value="rack">Rack</option>
                        <option value="shelf">Shelf</option>
                        <option value="bin">Bin</option>
                        <option value="staging">Staging</option>
                        <option value="dock">Dock</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button type="submit" disabled={loading}>
                        <MapPin className="mr-2 h-4 w-4" />
                        {loading ? "Saving…" : "Add location"}
                      </Button>
                    </div>
                  </form>
                )}
                <DataTable>
                  <table className="w-full">
                    <DataTableHeader>
                      <DataTableHead>Code</DataTableHead>
                      <DataTableHead>Name</DataTableHead>
                      <DataTableHead>Type</DataTableHead>
                      <DataTableHead>Pick</DataTableHead>
                      <DataTableHead>Receive</DataTableHead>
                    </DataTableHeader>
                    <DataTableBody>
                      {locations.length === 0 ? (
                        <DataTableEmpty colSpan={5} message="No locations. A default zone is created per warehouse." />
                      ) : (
                        locations.map((loc) => (
                          <DataTableRow key={loc.id}>
                            <DataTableCell className="font-mono text-sm">{loc.code}</DataTableCell>
                            <DataTableCell>{loc.name}</DataTableCell>
                            <DataTableCell><StatusBadge status={loc.location_type} /></DataTableCell>
                            <DataTableCell>{loc.is_pickable ? "Yes" : "No"}</DataTableCell>
                            <DataTableCell>{loc.is_receivable ? "Yes" : "No"}</DataTableCell>
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
              {movementsTotal} movement{movementsTotal === 1 ? "" : "s"}
              {storeId ? " at selected store" : ""}
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadMovements(movementPage)}>
              <History className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>When</DataTableHead>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead>Product</DataTableHead>
                <DataTableHead align="right">Delta</DataTableHead>
                <DataTableHead align="right">After</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {movements.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No stock movements yet." />
                ) : (
                  movements.flatMap((m) =>
                    (m.lines ?? []).map((line) => (
                      <DataTableRow key={`${m.id}-${line.id}`}>
                        <DataTableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(m.created_at).toLocaleString()}
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
                No low-stock items. Set reorder points on products to enable alerts.
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
                    <MobileRecordCardRow label="Store">{item.store_name}</MobileRecordCardRow>
                    <MobileRecordCardRow label="On hand">
                      <span className="text-amber-700">{item.quantity}</span>
                    </MobileRecordCardRow>
                    <MobileRecordCardRow label="Reorder at">{item.reorder_point}</MobileRecordCardRow>
                  </div>
                </MobileRecordCard>
              ))
            )}
          </div>

          <div className="hidden lg:block">
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Store</DataTableHead>
                  <DataTableHead>Product</DataTableHead>
                  <DataTableHead align="right">On hand</DataTableHead>
                  <DataTableHead align="right">Reorder point</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {lowStock.length === 0 ? (
                    <DataTableEmpty colSpan={4} message="No low-stock items. Set reorder points on products to enable alerts." />
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
