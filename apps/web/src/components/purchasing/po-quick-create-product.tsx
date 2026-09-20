"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SELECT_CLS } from "@/lib/ui-classes";
import { applyProductUomPreset } from "@/lib/scm/apply-product-uom-preset";
import {
  buildUomPreset,
  formatPriceInput,
  toBasePrice,
  type UomPresetKind,
} from "@/lib/scm/uom-pricing";
import type { ProductUomOption, VariantOption } from "@/app/(tenant)/purchasing/page";
import { X } from "lucide-react";

export type PoQuickCreateResult = {
  variant: VariantOption;
  uoms: ProductUomOption[];
  baseCost: number;
};

export function PoQuickCreateProductModal({
  organizationId,
  categories,
  initialName,
  onClose,
  onCreated,
}: {
  organizationId: string;
  categories: { id: string; name: string }[];
  initialName?: string;
  onClose: () => void;
  onCreated: (result: PoQuickCreateResult) => void;
}) {
  const t = useTranslations("purchasing.poQuickCreate");
  const tUom = useTranslations("products.uom");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(initialName ?? "");
  const [barcode, setBarcode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [uomPreset, setUomPreset] = useState<UomPresetKind>("each");
  const [packSize, setPackSize] = useState("24");
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pricing = useMemo(() => {
    const pack = parseFloat(packSize) || 24;
    return buildUomPreset(uomPreset, pack);
  }, [uomPreset, packSize]);

  const baseCost = toBasePrice(parseFloat(costPrice) || 0, pricing.purchaseFactor);
  const baseSell = toBasePrice(parseFloat(sellPrice) || 0, pricing.saleFactor);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("nameRequired"));
      return;
    }
    if (!(parseFloat(sellPrice) >= 0) || sellPrice === "") {
      setError(t("sellRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: createError } = await supabase.rpc("create_product_with_variant", {
      p_organization_id: organizationId,
      p_name: name.trim(),
      p_category_id: categoryId || null,
      p_sku: null,
      p_barcode: barcode.trim() || null,
      p_sell_price: baseSell,
      p_cost_price: baseCost,
      p_tax_rate: null,
      p_store_id: null,
      p_initial_qty: 0,
      p_image_url: null,
    });

    if (createError || !data) {
      setBusy(false);
      setError(createError?.message ?? t("createFailed"));
      return;
    }

    const result = data as { product_id: string; variant_id?: string };
    if (uomPreset !== "each") {
      const pack = parseFloat(packSize) || 24;
      const { error: uomError } = await applyProductUomPreset(
        supabase,
        result.product_id,
        uomPreset,
        pack
      );
      if (uomError) {
        setBusy(false);
        setError(uomError);
        return;
      }
    }

    let variantId = result.variant_id;
    if (!variantId) {
      const { data: variants } = await supabase
        .from("product_variants")
        .select("id")
        .eq("product_id", result.product_id)
        .eq("name", "Default")
        .limit(1);
      variantId = variants?.[0]?.id;
    }

    if (!variantId) {
      setBusy(false);
      setError(t("createFailed"));
      return;
    }

    const { data: uomRows } = await supabase
      .from("product_uoms")
      .select("product_id, uom_code, uom_name, conversion_factor, is_base, is_purchase, is_sale")
      .eq("product_id", result.product_id);

    const uoms = ((uomRows as ProductUomOption[] | null) ?? []).length
      ? ((uomRows as ProductUomOption[]) ?? [])
      : pricing.specs.map((s) => ({
          product_id: result.product_id,
          uom_code: s.code,
          uom_name: s.name,
          conversion_factor: s.factor,
          is_base: s.isBase,
          is_purchase: s.isPurchase,
          is_sale: s.isSale,
        }));

    setBusy(false);
    onCreated({
      variant: {
        id: variantId,
        name: "Default",
        sku: null,
        barcode: barcode.trim() || null,
        cost_price: baseCost,
        product_id: result.product_id,
        products: { name: name.trim() },
      },
      uoms,
      baseCost,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-quick-create-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="po-quick-create-title" className="text-lg font-semibold">
              {t("title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("description")}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={tCommon("cancel")}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{tCommon("name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label>{t("barcodeOptional")}</Label>
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{tCommon("category")}</Label>
            <select className={SELECT_CLS} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{tCommon("none")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>{t("units")}</Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["each", tUom("presetEach")],
                  ["weight", tUom("presetWeight")],
                  ["volume", tUom("presetVolume")],
                  ["pack", tUom("presetPack")],
                ] as const
              ).map(([kind, label]) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={uomPreset === kind ? "default" : "outline"}
                  onClick={() => {
                    if (kind === "pack") {
                      const raw = window.prompt(tUom("presetPackPrompt"), packSize);
                      if (raw == null) return;
                      const n = parseFloat(raw);
                      if (!(n > 0)) return;
                      setPackSize(String(n));
                    }
                    setUomPreset(kind);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("presetSummary", {
                base: pricing.baseCode,
                purchase: pricing.purchaseCode,
                sale: pricing.saleCode,
              })}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("costPerUom", { uom: pricing.purchaseCode })}</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0.00"
              />
              {costPrice !== "" && (
                <p className="text-xs text-muted-foreground">
                  {t("toBase", {
                    entered: costPrice,
                    uom: pricing.purchaseCode,
                    base: formatPriceInput(baseCost),
                    baseUom: pricing.baseCode,
                  })}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("sellPerUom", { uom: pricing.saleCode })}</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                required
                placeholder="0.00"
              />
              {sellPrice !== "" && (
                <p className="text-xs text-muted-foreground">
                  {t("toBase", {
                    entered: sellPrice,
                    uom: pricing.saleCode,
                    base: formatPriceInput(baseSell),
                    baseUom: pricing.baseCode,
                  })}
                </p>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? tCommon("saving") : t("createAndAdd")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
