"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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

type ReceiveUom = {
  uom_code: string;
  uom_name: string;
  conversion_factor: number;
  is_base: boolean;
  is_purchase: boolean;
};

type ReceiveLine = {
  id: string;
  barcode: string;
  name: string;
  sellPrice: string;
  costPrice: string;
  /** Quantity in the selected purchase UOM (not necessarily base). */
  quantity: number;
  existing: boolean;
  productId?: string;
  uomCode: string;
  conversionFactor: number;
  uoms: ReceiveUom[];
  baseUomCode: string;
};

const DEFAULT_UOM: ReceiveUom = {
  uom_code: "ea",
  uom_name: "Each",
  conversion_factor: 1,
  is_base: true,
  is_purchase: true,
};

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickPurchaseUom(uoms: ReceiveUom[]): ReceiveUom {
  return (
    uoms.find((u) => u.is_purchase && !u.is_base) ??
    uoms.find((u) => u.is_purchase) ??
    uoms.find((u) => u.is_base) ??
    uoms[0] ??
    DEFAULT_UOM
  );
}

function toBaseQty(qty: number, factor: number) {
  return Math.round(qty * (factor || 1) * 1e6) / 1e6;
}

async function loadProductUoms(productId: string): Promise<{ uoms: ReceiveUom[]; baseCode: string }> {
  const supabase = createClient();
  const { data } = await supabase
    .from("product_uoms")
    .select("uom_code, uom_name, conversion_factor, is_base, is_purchase")
    .eq("product_id", productId)
    .order("is_base", { ascending: false });
  const uoms = ((data as ReceiveUom[] | null) ?? []).filter(Boolean);
  if (uoms.length === 0) {
    return { uoms: [DEFAULT_UOM], baseCode: "ea" };
  }
  const baseCode = uoms.find((u) => u.is_base)?.uom_code ?? uoms[0].uom_code;
  return { uoms, baseCode };
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
  const t = useTranslations("products.receiveTab");
  const tForm = useTranslations("products.form");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { toast } = useToast();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [sessionDefaultUom, setSessionDefaultUom] = useState("ea");
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
        toast({ title: t("invalidBarcode"), variant: "destructive" });
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.rpc("find_product_by_barcode", {
        p_org_id: organizationId,
        p_barcode: code,
      });

      if (error) {
        toast({
          title: t("lookupFailed"),
          description: error.message.includes("Could not find the function")
            ? t("applyMigration", { file: "20260618000050_product_bulk_barcode.sql" })
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
        const { uoms, baseCode } = await loadProductUoms(row.product_id);
        const preferred = pickPurchaseUom(uoms);
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
              uomCode: preferred.uom_code,
              conversionFactor: Number(preferred.conversion_factor) || 1,
              uoms,
              baseUomCode: baseCode,
            },
            ...prev,
          ];
        });
        setLastScan(t("lastScanExisting", { code, name: row.name ?? t("existingProduct") }));
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
            uomCode: sessionDefaultUom || "ea",
            conversionFactor: 1,
            uoms: [DEFAULT_UOM],
            baseUomCode: "ea",
          },
          ...prev,
        ];
      });
      setLastScan(t("lastScanNew", { code }));
    },
    [organizationId, sessionDefaultUom, t, toast]
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

  function setLineUom(id: string, uomCode: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const uom = l.uoms.find((u) => u.uom_code === uomCode) ?? DEFAULT_UOM;
        return {
          ...l,
          uomCode: uom.uom_code,
          conversionFactor: Number(uom.conversion_factor) || 1,
        };
      })
    );
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function saveSession() {
    if (!storeId) {
      toast({ title: t("selectStore"), variant: "destructive" });
      return;
    }

    // Convert purchase-UOM qty → base before RPC (stock always in base units).
    const payload = lines
      .filter((l) => l.barcode && l.name.trim())
      .map((l) => ({
        barcode: l.barcode,
        name: l.name.trim(),
        sell_price: Number(l.sellPrice) || 0,
        cost_price: Number(l.costPrice) || 0,
        quantity: toBaseQty(l.quantity, l.conversionFactor),
        uom_code: l.uomCode,
        qty_entered: l.quantity,
      }));

    if (payload.length === 0) {
      toast({ title: t("nothingToSave"), description: t("nothingToSaveDesc"), variant: "destructive" });
      return;
    }

    const incomplete = lines.filter((l) => l.barcode && !l.existing && !l.name.trim());
    if (incomplete.length > 0) {
      toast({
        title: t("missingNames"),
        description: t("missingNamesDesc", { count: incomplete.length }),
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
        title: t("saveFailed"),
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const result = (data ?? {}) as { created?: number; stocked?: number; skipped?: number };
    toast({
      title: t("receiveSaved"),
      description: t("receiveSavedDesc", { created: result.created ?? 0, stocked: result.stocked ?? 0 }),
    });
    setLines([]);
    setLastScan(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <FormCard title={t("title")} description={t("description")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="receiveStore">{tCommon("store")}</Label>
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
          <div className="space-y-2">
            <Label htmlFor="receiveCategory">{t("defaultCategory")}</Label>
            <select
              id="receiveCategory"
              className={SELECT_CLS}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{tCommon("uncategorized")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="receiveDefaultUom">{t("defaultPurchaseUom")}</Label>
            <select
              id="receiveDefaultUom"
              className={SELECT_CLS}
              value={sessionDefaultUom}
              onChange={(e) => setSessionDefaultUom(e.target.value)}
            >
              <option value="ea">ea</option>
              <option value="kg">kg</option>
              <option value="g">g</option>
              <option value="L">L</option>
              <option value="ml">ml</option>
              <option value="cs">cs</option>
            </select>
            <p className="text-xs text-muted-foreground">{t("defaultPurchaseUomHint")}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => setScannerOpen(true)}>
            <Camera className="mr-2 h-4 w-4" />
            {t("openScanner")}
          </Button>
          <Button type="button" variant="outline" disabled={lines.length === 0} onClick={() => setLines([])}>
            {t("clearSession")}
          </Button>
          <Button type="button" disabled={busy || readyCount === 0} onClick={saveSession}>
            <PackagePlus className="mr-2 h-4 w-4" />
            {busy ? tCommon("saving") : t("saveLines", { count: readyCount })}
          </Button>
        </div>

        {lastScan && (
          <p className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{lastScan}</p>
        )}
      </FormCard>

      {lines.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <FormCard title={t("sessionTitle")} description={t("sessionDescription", { count: lines.length, currency })}>
          <div className="space-y-3">
            {lines.map((line) => {
              const baseQty = toBaseQty(line.quantity, line.conversionFactor);
              return (
                <div
                  key={line.id}
                  className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1.2fr_repeat(4,minmax(0,6rem))_auto]"
                >
                  <div>
                    <p className="text-xs text-muted-foreground">{tForm("barcode")}</p>
                    <p className="font-mono text-sm">{line.barcode}</p>
                    {line.existing && (
                      <p className="text-xs text-success">
                        {t("existingStock", { qty: `${line.quantity} ${line.uomCode}` })}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{tCommon("name")}</Label>
                    <Input
                      value={line.name}
                      disabled={line.existing}
                      placeholder={t("productNamePlaceholder")}
                      onChange={(e) => updateLine(line.id, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{tCommon("sell")}</Label>
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
                    <Label className="text-xs">{tCommon("cost")}</Label>
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
                    <Label className="text-xs">{t("purchaseUom")}</Label>
                    <select
                      className={SELECT_CLS}
                      value={line.uomCode}
                      onChange={(e) => setLineUom(line.id, e.target.value)}
                      disabled={!line.existing && line.uoms.length <= 1}
                    >
                      {(line.uoms.length ? line.uoms : [DEFAULT_UOM]).map((u) => (
                        <option key={u.uom_code} value={u.uom_code}>
                          {u.uom_code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("qty")}</Label>
                    <Input
                      type="number"
                      min="0.001"
                      step="any"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.id, { quantity: Math.max(0.001, Number(e.target.value) || 0.001) })
                      }
                    />
                  </div>
                  <div className="flex items-end justify-end">
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(line.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-full">
                    {t("baseEquivalent", {
                      qty: line.quantity,
                      uom: line.uomCode,
                      baseQty,
                      baseUom: line.baseUomCode || "ea",
                    })}
                    {!line.existing && line.sellPrice
                      ? ` · ${t("previewSell", { amount: formatCurrency(Number(line.sellPrice) || 0, currency) })}`
                      : null}
                  </p>
                </div>
              );
            })}
          </div>
        </FormCard>
      )}

      {scannerOpen && (
        <BarcodeScannerModal
          onClose={() => setScannerOpen(false)}
          onScan={(code) => {
            const codeNorm = normalizeBarcode(code);
            if (!isValidBarcode(codeNorm)) {
              return { ok: false, label: t("invalidBarcode") };
            }
            void lookupBarcode(codeNorm);
            return { ok: true, label: codeNorm };
          }}
        />
      )}
    </div>
  );
}
