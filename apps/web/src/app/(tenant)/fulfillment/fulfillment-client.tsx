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
import type {
  FulfillmentOrderLineRow,
  FulfillmentOrderRow,
  LocationBalanceRow,
} from "@/lib/scm/types";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { ArrowRightLeft, Package, ScanLine, Truck } from "lucide-react";

type Tab = "orders" | "pick" | "putaway";

export function FulfillmentClient({
  organizationId,
  stores,
  variants,
  canManage,
}: {
  organizationId: string;
  stores: { id: string; name: string }[];
  variants: { variant_id: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("orders");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [loading, setLoading] = useState(false);

  const [orders, setOrders] = useState<FulfillmentOrderRow[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState("");
  const [orderLines, setOrderLines] = useState<FulfillmentOrderLineRow[]>([]);
  const [orderStatus, setOrderStatus] = useState("");

  const [newLines, setNewLines] = useState([{ variantId: "", quantity: "1" }]);
  const [shipToName, setShipToName] = useState("");
  const [shipToAddress, setShipToAddress] = useState("");

  const [pickLocationId, setPickLocationId] = useState("");
  const [locationScan, setLocationScan] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");

  const [putawayFrom, setPutawayFrom] = useState("");
  const [putawayTo, setPutawayTo] = useState("");
  const [putawayVariant, setPutawayVariant] = useState("");
  const [putawayQty, setPutawayQty] = useState("");
  const [binStock, setBinStock] = useState<LocationBalanceRow[]>([]);

  async function loadOrders() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_fulfillment_orders", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
    });
    if (error) {
      toast({ title: "Could not load orders", description: error.message, variant: "destructive" });
      return;
    }
    setOrders((data ?? []) as FulfillmentOrderRow[]);
    setOrdersLoaded(true);
  }

  async function loadOrderDetail(orderId: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_fulfillment_order", { p_order_id: orderId });
    if (error) {
      toast({ title: "Could not load order", description: error.message, variant: "destructive" });
      return;
    }
    const parsed = (data ?? {}) as {
      order?: { status?: string };
      lines?: FulfillmentOrderLineRow[];
    };
    setActiveOrderId(orderId);
    setOrderLines(parsed.lines ?? []);
    setOrderStatus(parsed.order?.status ?? "");
  }

  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !storeId) return;
    const lines = newLines
      .filter((l) => l.variantId && parseFloat(l.quantity) > 0)
      .map((l) => ({
        variantId: l.variantId,
        quantity: parseFloat(l.quantity),
        productName: variants.find((v) => v.variant_id === l.variantId)?.label ?? "Product",
      }));
    if (lines.length === 0) return;

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_fulfillment_order", {
      p_org_id: organizationId,
      p_store_id: storeId,
      p_lines: lines,
      p_ship_to_name: shipToName || null,
      p_ship_to_address: shipToAddress || null,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Create failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Fulfillment order created" });
    setNewLines([{ variantId: "", quantity: "1" }]);
    setShipToName("");
    setShipToAddress("");
    setOrdersLoaded(false);
    void loadOrders();
    if (data) void loadOrderDetail(data as string);
  }

  async function releaseOrder(orderId: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("release_fulfillment_order", { p_order_id: orderId });
    if (error) {
      toast({ title: "Release failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order released for picking" });
    void loadOrderDetail(orderId);
    setOrdersLoaded(false);
    void loadOrders();
  }

  async function resolveLocationBarcode(code: string) {
    const supabase = createClient();
    const { data } = await supabase.rpc("resolve_location_by_barcode", {
      p_org_id: organizationId,
      p_barcode: code,
    });
    const row = (data ?? {}) as { found?: boolean; location_id?: string; code?: string };
    if (row.found && row.location_id) {
      setPickLocationId(row.location_id);
      toast({ title: "Location scanned", description: row.code });
    }
  }

  async function pickLine(line: FulfillmentOrderLineRow) {
    if (!canManage || !pickLocationId || !activeOrderId) return;
    const remaining = line.quantity_ordered - line.quantity_picked;
    if (remaining <= 0) return;

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("pick_fulfillment_line", {
      p_line_id: line.id,
      p_location_id: pickLocationId,
      p_quantity: remaining,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Pick failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Line picked", description: `${remaining} units moved to staging` });
    void loadOrderDetail(activeOrderId);
  }

  async function completePick() {
    if (!activeOrderId) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_fulfillment_pick", { p_order_id: activeOrderId });
    setLoading(false);
    if (error) {
      toast({ title: "Complete pick failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pick complete" });
    void loadOrderDetail(activeOrderId);
  }

  async function packOrder() {
    if (!activeOrderId) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("pack_fulfillment_order", { p_order_id: activeOrderId });
    if (error) {
      toast({ title: "Pack failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order packed" });
    void loadOrderDetail(activeOrderId);
  }

  async function shipOrder() {
    if (!activeOrderId) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("ship_fulfillment_order", {
      p_order_id: activeOrderId,
      p_carrier: carrier || null,
      p_tracking_number: tracking || null,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Ship failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order shipped", description: "Stock deducted and shipment recorded." });
    setCarrier("");
    setTracking("");
    setOrdersLoaded(false);
    void loadOrders();
    void loadOrderDetail(activeOrderId);
    router.refresh();
  }

  async function loadBinStock() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_location_balances", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
    });
    if (error) {
      toast({ title: "Could not load bin stock", description: error.message, variant: "destructive" });
      return;
    }
    setBinStock((data ?? []) as LocationBalanceRow[]);
  }

  async function syncDefaultBins() {
    if (!canManage || !storeId) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("sync_default_location_balances", {
      p_org_id: organizationId,
      p_store_id: storeId,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Default bins synced", description: `${data ?? 0} SKU(s) allocated to DEFAULT zone.` });
    void loadBinStock();
  }

  async function handlePutaway(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !putawayFrom || !putawayTo || !putawayVariant) return;
    const qty = parseFloat(putawayQty);
    if (Number.isNaN(qty) || qty <= 0) return;

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("putaway_stock", {
      p_org_id: organizationId,
      p_store_id: storeId,
      p_variant_id: putawayVariant,
      p_from_location_id: putawayFrom,
      p_to_location_id: putawayTo,
      p_quantity: qty,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Putaway failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Putaway complete" });
    setPutawayQty("");
    void loadBinStock();
  }

  function handleTabChange(next: Tab) {
    setTab(next);
    if ((next === "orders" || next === "pick") && !ordersLoaded) void loadOrders();
    if (next === "putaway") void loadBinStock();
  }

  const activeOrder = orders.find((o) => o.id === activeOrderId);

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Fulfillment"
        description="Warehouse pick, pack & ship"
        action={
          <select
            className={SELECT_CLS + " w-auto min-w-[160px]"}
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value);
              setOrdersLoaded(false);
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
          { key: "orders", label: "Orders" },
          { key: "pick", label: "Pick" },
          { key: "putaway", label: "Putaway" },
        ]}
        value={tab}
        onChange={(k) => handleTabChange(k as Tab)}
        className="mb-6"
      />

      {tab === "orders" && (
        <>
          {canManage && (
            <FormCard title="New fulfillment order">
              <form onSubmit={createOrder} className="grid gap-4 sm:grid-cols-2">
                {newLines.map((line, idx) => (
                  <div key={idx} className="contents">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Product</Label>
                      <select
                        className={SELECT_CLS}
                        value={line.variantId}
                        onChange={(e) => {
                          const next = [...newLines];
                          next[idx] = { ...next[idx], variantId: e.target.value };
                          setNewLines(next);
                        }}
                        required
                      >
                        <option value="">Select…</option>
                        {variants.map((v) => (
                          <option key={v.variant_id} value={v.variant_id}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Quantity</Label>
                      <Input
                        type="number"
                        min="0.001"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => {
                          const next = [...newLines];
                          next[idx] = { ...next[idx], quantity: e.target.value };
                          setNewLines(next);
                        }}
                        required
                      />
                    </div>
                  </div>
                ))}
                <div className="space-y-2">
                  <Label>Ship to name</Label>
                  <Input value={shipToName} onChange={(e) => setShipToName(e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Ship to address</Label>
                  <Input value={shipToAddress} onChange={(e) => setShipToAddress(e.target.value)} />
                </div>
                <Button type="submit" disabled={loading} className="sm:col-span-2 w-fit">
                  <Package className="mr-2 h-4 w-4" />
                  Create order
                </Button>
              </form>
            </FormCard>
          )}

          <div className="space-y-3 lg:hidden">
            {orders.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No fulfillment orders.</p>
            ) : (
              orders.map((o) => (
                <MobileRecordCard key={o.id}>
                  <button type="button" className="w-full text-left" onClick={() => void loadOrderDetail(o.id)}>
                    <p className="font-semibold">{o.order_no}</p>
                    <div className="mt-1"><StatusBadge status={o.status} /></div>
                  </button>
                  <MobileRecordCardRow label="Lines">{o.line_count}</MobileRecordCardRow>
                  {canManage && o.status === "draft" && (
                    <Button size="sm" className="mt-2 w-full" onClick={() => void releaseOrder(o.id)}>Release</Button>
                  )}
                </MobileRecordCard>
              ))
            )}
          </div>

          <div className="hidden lg:block">
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Order</DataTableHead>
                  <DataTableHead>Status</DataTableHead>
                  <DataTableHead>Ship to</DataTableHead>
                  <DataTableHead align="right">Lines</DataTableHead>
                  {canManage && <DataTableHead>&nbsp;</DataTableHead>}
                </DataTableHeader>
                <DataTableBody>
                  {orders.length === 0 ? (
                    <DataTableEmpty colSpan={canManage ? 5 : 4} message="No fulfillment orders." />
                  ) : (
                    orders.map((o) => (
                      <DataTableRow key={o.id} selected={activeOrderId === o.id}>
                        <DataTableCell>
                          <button type="button" className="font-mono hover:underline" onClick={() => void loadOrderDetail(o.id)}>
                            {o.order_no}
                          </button>
                        </DataTableCell>
                        <DataTableCell><StatusBadge status={o.status} /></DataTableCell>
                        <DataTableCell>{o.ship_to_name ?? "—"}</DataTableCell>
                        <DataTableCell align="right">{o.line_count}</DataTableCell>
                        {canManage && (
                          <DataTableCell align="right">
                            {o.status === "draft" && (
                              <Button size="sm" variant="outline" onClick={() => void releaseOrder(o.id)}>Release</Button>
                            )}
                          </DataTableCell>
                        )}
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
          </div>
        </>
      )}

      {tab === "pick" && (
        <div className="space-y-4">
          <FormCard title="Pick workflow">
            <p className="mb-4 text-sm text-muted-foreground">
              Scan a location barcode or enter a location ID, select an order, then pick each line.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Scan location</Label>
                <div className="flex gap-2">
                  <Input
                    value={locationScan}
                    onChange={(e) => setLocationScan(e.target.value)}
                    placeholder="Bin code"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void resolveLocationBarcode(locationScan);
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={() => void resolveLocationBarcode(locationScan)}>
                    <ScanLine className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Active order</Label>
                <select
                  className={SELECT_CLS}
                  value={activeOrderId}
                  onChange={(e) => void loadOrderDetail(e.target.value)}
                >
                  <option value="">Select order…</option>
                  {orders.filter((o) => ["released", "picking", "picked", "packed"].includes(o.status)).map((o) => (
                    <option key={o.id} value={o.id}>{o.order_no} ({o.status})</option>
                  ))}
                </select>
              </div>
            </div>
          </FormCard>

          {activeOrderId && (
            <FormCard title={activeOrder ? `Pick — ${activeOrder.order_no}` : "Pick lines"}>
              <div className="mb-4 flex flex-wrap gap-2">
                {canManage && orderStatus === "picking" && (
                  <Button size="sm" onClick={() => void completePick()} disabled={loading}>Complete pick</Button>
                )}
                {canManage && ["picked", "picking"].includes(orderStatus) && (
                  <Button size="sm" variant="secondary" onClick={() => void packOrder()}>Mark packed</Button>
                )}
                {canManage && ["picked", "packed"].includes(orderStatus) && (
                  <>
                    <Input className="w-32" placeholder="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                    <Input className="w-40" placeholder="Tracking #" value={tracking} onChange={(e) => setTracking(e.target.value)} />
                    <Button size="sm" onClick={() => void shipOrder()} disabled={loading}>
                      <Truck className="mr-2 h-4 w-4" />
                      Ship
                    </Button>
                  </>
                )}
              </div>
              <div className="space-y-3">
                {orderLines.map((line) => {
                  const remaining = line.quantity_ordered - line.quantity_picked;
                  return (
                    <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                      <div>
                        <p className="font-medium">{line.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Picked {line.quantity_picked} / {line.quantity_ordered}
                        </p>
                      </div>
                      {canManage && remaining > 0 && ["released", "picking"].includes(orderStatus) && (
                        <Button size="sm" disabled={!pickLocationId || loading} onClick={() => void pickLine(line)}>
                          Pick {remaining}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </FormCard>
          )}
        </div>
      )}

      {tab === "putaway" && (
        <>
          {canManage && (
            <FormCard title="Putaway transfer">
              <form onSubmit={handlePutaway} className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>From location ID</Label>
                  <Input value={putawayFrom} onChange={(e) => setPutawayFrom(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>To location ID</Label>
                  <Input value={putawayTo} onChange={(e) => setPutawayTo(e.target.value)} required />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Product</Label>
                  <select className={SELECT_CLS} value={putawayVariant} onChange={(e) => setPutawayVariant(e.target.value)} required>
                    <option value="">Select…</option>
                    {variants.map((v) => (
                      <option key={v.variant_id} value={v.variant_id}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" min="0.001" step="any" value={putawayQty} onChange={(e) => setPutawayQty(e.target.value)} required />
                </div>
                <div className="flex items-end gap-2">
                  <Button type="submit" disabled={loading}>
                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                    Transfer
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void syncDefaultBins()} disabled={loading}>
                    Sync DEFAULT bins
                  </Button>
                </div>
              </form>
            </FormCard>
          )}

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Location</DataTableHead>
                <DataTableHead>Product</DataTableHead>
                <DataTableHead align="right">Qty</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {binStock.length === 0 ? (
                  <DataTableEmpty colSpan={3} message="No bin-level stock. Run sync or putaway." />
                ) : (
                  binStock.map((row) => (
                    <DataTableRow key={row.id}>
                      <DataTableCell className="font-mono text-sm">{row.location_code}</DataTableCell>
                      <DataTableCell>{row.product_name}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{row.quantity}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </>
      )}
    </div>
  );
}
