"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { SELECT_CLS } from "@/lib/ui-classes";
import { BarcodeScannerModal } from "@/components/pos/barcode-scanner-modal";
import { normalizeBarcode, isValidBarcode } from "@/lib/pos/barcode-scan";
import { Camera, PackagePlus, Trash2 } from "lucide-react";

type ReceiveLine = {
  id: string;
  barcode: string;
  name: string;
  sellPrice: string;
  costPrice: string;
  quantity: number;
  existing: boolean;
  productId?: string;
};

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ProductReceiveTab({
  organizationId,
  stores,
  categories,
  currency,
}: {
  organizationId: string;
  stores: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  currency: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const wedgeBuffer = useRef("");
  const wedgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupRef = useRef<(raw: string) => Promise<void>>(async () => {});

  const readyCount = useMemo(() => lines.filter((l) => l.name.trim() && l.barcode).length, [lines]);

  const lookupBarcode = useCallback(
    async (raw: string) => {
      const code = normalizeBarcode(raw);
      if (!isValidBarcode(code)) {
        toast({ title: "Invalid barcode", variant: "destructive" });
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.rpc("find_product_by_barcode", {
        p_org_id: organizationId,
        p_barcode: code,
      });

      if (error) {
        toast({
          title: "Lookup failed",
          description: error.message.includes("Could not find the function")
            ? "Apply migration 20260618000050_product_bulk_barcode.sql"
            : error.message,
          variant: "destructive",
        });
        return;
      }

      const row = (data ?? {}) as {
        found?: boolean;
        product_id?: string;
        name?: string;
        sell_price?: number;
        cost_price?: number;
      };

      if (row.found && row.product_id) {
        setLines((prev) => {
          const idx = prev.findIndex((l) => l.barcode === code);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
            return next;
          }
          return [
            {
              id: newLineId(),
              barcode: code,
              name: row.name ?? "",
              sellPrice: String(row.sell_price ?? 0),
              costPrice: String(row.cost_price ?? 0),
              quantity: 1,
              existing: true,
              productId: row.product_id,
            },
            ...prev,
          ];
        });
        setLastScan(`${code} · ${row.name ?? "Existing product"} (+1)`);
        return;
      }

      setLines((prev) => {
        if (prev.some((l) => l.barcode === code)) {
          return prev.map((l) => (l.barcode === code ? { ...l, quantity: l.quantity + 1 } : l));
        }
        return [
          {
            id: newLineId(),
            barcode: code,
            name: "",
            sellPrice: "",
            costPrice: "",
            quantity: 1,
            existing: false,
          },
          ...prev,
        ];
      });
      setLastScan(`${code} · new item — enter name and price`);
    },
    [organizationId, toast]
  );

  useEffect(() => {
    lookupRef.current = lookupBarcode;
  }, [lookupBarcode]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (scannerOpen) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        wedgeBuffer.current += e.key;
        if (wedgeTimer.current) clearTimeout(wedgeTimer.current);
        wedgeTimer.current = setTimeout(() => {
          wedgeBuffer.current = "";
        }, 100);
      }
      if (e.key === "Enter" && wedgeBuffer.current.length >= 4) {
        const captured = wedgeBuffer.current;
        wedgeBuffer.current = "";
        void lookupRef.current(captured);
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scannerOpen]);

  function updateLine(id: string, patch: Partial<ReceiveLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function saveSession() {
    if (!storeId) {
      toast({ title: "Select a store", variant: "destructive" });
      return;
    }

    const payload = lines
      .filter((l) => l.barcode && l.name.trim())
      .map((l) => ({
        barcode: l.barcode,
        name: l.name.trim(),
        sell_price: Number(l.sellPrice) || 0,
        cost_price: Number(l.costPrice) || 0,
        quantity: l.quantity,
      }));

    if (payload.length === 0) {
      toast({ title: "Nothing to save", description: "Add scans and fill in names for new items.", variant: "destructive" });
      return;
    }

    const incomplete = lines.filter((l) => l.barcode && !l.existing && !l.name.trim());
    if (incomplete.length > 0) {
      toast({
        title: "Missing product names",
        description: `${incomplete.length} new barcode(s) need a name before saving.`,
        variant: "destructive",
      });
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("bulk_receive_products", {
      p_org_id: organizationId,
      p_store_id: storeId,
      p_rows: payload,
      p_default_category_id: categoryId || null,
    });
    setBusy(false);

    if (error) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const result = (data ?? {}) as { created?: number; stocked?: number; skipped?: number };
    toast({
      title: "Receive saved",
      description: `Created ${result.created ?? 0}, stocked ${result.stocked ?? 0}.`,
    });
    setLines([]);
    setLastScan(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <FormCard
        title="Receive by scan"
        description="Scan delivery barcodes to add stock or register new products. USB scanners and phone camera are supported."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="receiveStore">Store</Label>
            <select
              id="receiveStore"
              className={SELECT_CLS}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="receiveCategory">Default category for new items</Label>
            <select
              id="receiveCategory"
              className={SELECT_CLS}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => setScannerOpen(true)}>
            <Camera className="mr-2 h-4 w-4" />
            Open scanner
          </Button>
          <Button type="button" variant="outline" disabled={lines.length === 0} onClick={() => setLines([])}>
            Clear session
          </Button>
          <Button type="button" disabled={busy || readyCount === 0} onClick={saveSession}>
            <PackagePlus className="mr-2 h-4 w-4" />
            {busy ? "Saving…" : `Save ${readyCount} line${readyCount === 1 ? "" : "s"}`}
          </Button>
        </div>

        {lastScan && (
          <p className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{lastScan}</p>
        )}
      </FormCard>

      {lines.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No scans yet. Open the scanner or use a USB barcode wedge while this page is active.
        </div>
      ) : (
        <FormCard title="Session" description={`${lines.length} line(s) · prices in ${currency}`}>
          <div className="space-y-3">
            {lines.map((line) => (
              <div
                key={line.id}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1.2fr_repeat(3,minmax(0,6rem))_auto]"
              >
                <div>
                  <p className="text-xs text-muted-foreground">Barcode</p>
                  <p className="font-mono text-sm">{line.barcode}</p>
                  {line.existing && (
                    <p className="text-xs text-success">Existing · stock +{line.quantity}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={line.name}
                    disabled={line.existing}
                    placeholder="Product name"
                    onChange={(e) => updateLine(line.id, { name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sell</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.sellPrice}
                    disabled={line.existing}
                    onChange={(e) => updateLine(line.id, { sellPrice: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cost</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.costPrice}
                    disabled={line.existing}
                    onChange={(e) => updateLine(line.id, { costPrice: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.id, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </div>
                <div className="flex items-end justify-end">
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(line.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {!line.existing && line.sellPrice && (
                  <p className="text-xs text-muted-foreground sm:col-span-full">
                    Preview sell: {formatCurrency(Number(line.sellPrice) || 0, currency)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </FormCard>
      )}

      {scannerOpen && (
        <BarcodeScannerModal
          onClose={() => setScannerOpen(false)}
          onScan={(code) => {
            const codeNorm = normalizeBarcode(code);
            if (!isValidBarcode(codeNorm)) {
              return { ok: false, label: "Invalid barcode" };
            }
            void lookupBarcode(codeNorm);
            return { ok: true, label: codeNorm };
          }}
        />
      )}
    </div>
  );
}
