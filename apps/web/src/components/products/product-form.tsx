"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SELECT_CLS } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";
import { BarcodeCaptureField } from "@/components/products/barcode-capture-field";
import { useTranslations } from "next-intl";
import { ImagePlus, X } from "lucide-react";
import {
  buildUomPreset,
  formatPriceInput,
  fromBasePrice,
  toBasePrice,
  type UomPresetKind,
} from "@/lib/scm/uom-pricing";

export type ProductFormValues = {
  name: string;
  sellPrice: string;
  costPrice: string;
  reorderPoint: string;
  barcode: string;
  sku: string;
  categoryId: string;
  storeId: string;
  initialQty: string;
  isActive: boolean;
  trackLots: boolean;
  lifecycleStatus: string;
  description: string;
  baseUomCode: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  hsCode: string;
  countryOfOrigin: string;
  shelfLifeDays: string;
  /** Create-only: which UOM preset to apply after save */
  uomPreset: UomPresetKind;
  packSize: string;
};

const emptyValues: ProductFormValues = {
  name: "",
  sellPrice: "",
  costPrice: "",
  reorderPoint: "0",
  barcode: "",
  sku: "",
  categoryId: "",
  storeId: "",
  initialQty: "0",
  isActive: true,
  trackLots: false,
  lifecycleStatus: "active",
  description: "",
  baseUomCode: "ea",
  weightKg: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  hsCode: "",
  countryOfOrigin: "",
  shelfLifeDays: "",
  uomPreset: "each",
  packSize: "24",
};

function mergeValues(
  initialValues: Partial<ProductFormValues> | undefined,
  stores: { id: string; name: string }[]
): ProductFormValues {
  return {
    ...emptyValues,
    ...initialValues,
    storeId: initialValues?.storeId ?? stores[0]?.id ?? "",
    uomPreset: initialValues?.uomPreset ?? "each",
    packSize: initialValues?.packSize ?? "24",
  };
}

export function ProductForm({
  formKey,
  title,
  submitLabel,
  loading,
  categories,
  stores,
  showStockFields,
  showActiveToggle,
  showExtendedFields,
  showUomCreatePricing,
  purchaseUomCode,
  purchaseFactor,
  saleUomCode,
  saleFactor,
  initialValues,
  existingImageUrl,
  onSubmit,
  onCancel,
  onBarcodeDuplicate,
}: {
  formKey: string;
  title: string;
  submitLabel: string;
  loading: boolean;
  categories: { id: string; name: string }[];
  stores: { id: string; name: string }[];
  showStockFields?: boolean;
  showActiveToggle?: boolean;
  showExtendedFields?: boolean;
  /** Create flow: preset chips + enter cost/sell in purchase/sale UOM */
  showUomCreatePricing?: boolean;
  /** Edit flow: optional purchase UOM for “enter in purchase UOM” toggle */
  purchaseUomCode?: string;
  purchaseFactor?: number;
  saleUomCode?: string;
  saleFactor?: number;
  initialValues?: Partial<ProductFormValues>;
  existingImageUrl?: string | null;
  onSubmit: (values: ProductFormValues, imageFile: File | null, removeImage: boolean) => void;
  onCancel: () => void;
  onBarcodeDuplicate?: (code: string) => void;
}) {
  const t = useTranslations("products.form");
  const tProducts = useTranslations("products");
  const tUom = useTranslations("products.uom");
  const tCommon = useTranslations("common");
  const [values, setValues] = useState(() => mergeValues(initialValues, stores));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingImageUrl ?? null);
  const [removeImage, setRemoveImage] = useState(false);
  const [enterCostInPurchase, setEnterCostInPurchase] = useState(false);
  const [enterSellInSale, setEnterSellInSale] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValues(mergeValues(initialValues, stores));
    setImageFile(null);
    setPreviewUrl(existingImageUrl ?? null);
    setRemoveImage(false);
    setEnterCostInPurchase(false);
    setEnterSellInSale(false);
    if (fileRef.current) fileRef.current.value = "";
  }, [formKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    setRemoveImage(false);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function setField<K extends keyof ProductFormValues>(key: K, val: ProductFormValues[K]) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  const createPricing = useMemo(() => {
    if (!showUomCreatePricing) return null;
    const pack = parseFloat(values.packSize) || 24;
    return buildUomPreset(values.uomPreset, pack);
  }, [showUomCreatePricing, values.uomPreset, values.packSize]);

  const editPurchaseFactor = purchaseFactor && purchaseFactor > 0 ? purchaseFactor : 1;
  const editSaleFactor = saleFactor && saleFactor > 0 ? saleFactor : 1;
  const canTogglePurchaseCost =
    !showUomCreatePricing && Boolean(purchaseUomCode) && editPurchaseFactor > 1;
  const canToggleSalePrice = !showUomCreatePricing && Boolean(saleUomCode) && editSaleFactor > 1;

  const costDisplay = showUomCreatePricing
    ? values.costPrice
    : enterCostInPurchase && canTogglePurchaseCost
      ? formatPriceInput(fromBasePrice(parseFloat(values.costPrice) || 0, editPurchaseFactor))
      : values.costPrice;

  const sellDisplay = showUomCreatePricing
    ? values.sellPrice
    : enterSellInSale && canToggleSalePrice
      ? formatPriceInput(fromBasePrice(parseFloat(values.sellPrice) || 0, editSaleFactor))
      : values.sellPrice;

  function onCostChange(raw: string) {
    if (showUomCreatePricing) {
      setField("costPrice", raw);
      return;
    }
    if (enterCostInPurchase && canTogglePurchaseCost) {
      const entered = parseFloat(raw);
      if (!Number.isFinite(entered)) {
        setField("costPrice", "");
        return;
      }
      setField("costPrice", formatPriceInput(toBasePrice(entered, editPurchaseFactor)));
      return;
    }
    setField("costPrice", raw);
  }

  function onSellChange(raw: string) {
    if (showUomCreatePricing) {
      setField("sellPrice", raw);
      return;
    }
    if (enterSellInSale && canToggleSalePrice) {
      const entered = parseFloat(raw);
      if (!Number.isFinite(entered)) {
        setField("sellPrice", "");
        return;
      }
      setField("sellPrice", formatPriceInput(toBasePrice(entered, editSaleFactor)));
      return;
    }
    setField("sellPrice", raw);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) return;
    setImageFile(file);
  }

  function clearImage() {
    setImageFile(null);
    setPreviewUrl(null);
    setRemoveImage(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let next = { ...values };
    if (createPricing) {
      const costEntered = parseFloat(values.costPrice) || 0;
      const sellEntered = parseFloat(values.sellPrice) || 0;
      next = {
        ...values,
        costPrice: formatPriceInput(toBasePrice(costEntered, createPricing.purchaseFactor)),
        sellPrice: formatPriceInput(toBasePrice(sellEntered, createPricing.saleFactor)),
        baseUomCode: createPricing.baseCode,
      };
    }
    onSubmit(next, imageFile, removeImage);
  }

  const costLabel =
    showUomCreatePricing && createPricing
      ? t("costPricePerUom", { uom: createPricing.purchaseCode })
      : enterCostInPurchase && canTogglePurchaseCost
        ? t("costPricePerUom", { uom: purchaseUomCode ?? "ea" })
        : t("costPricePerUom", { uom: values.baseUomCode || "ea" });

  const sellLabel =
    showUomCreatePricing && createPricing
      ? t("sellPricePerUom", { uom: createPricing.saleCode })
      : enterSellInSale && canToggleSalePrice
        ? t("sellPricePerUom", { uom: saleUomCode ?? "ea" })
        : t("sellPricePerUom", { uom: values.baseUomCode || "ea" });

  const costHelper =
    showUomCreatePricing && createPricing && values.costPrice !== ""
      ? t("priceToBaseHelper", {
          entered: values.costPrice || "0",
          uom: createPricing.purchaseCode,
          base: formatPriceInput(
            toBasePrice(parseFloat(values.costPrice) || 0, createPricing.purchaseFactor)
          ),
          baseUom: createPricing.baseCode,
        })
      : null;

  const sellHelper =
    showUomCreatePricing && createPricing && values.sellPrice !== ""
      ? t("priceToBaseHelper", {
          entered: values.sellPrice || "0",
          uom: createPricing.saleCode,
          base: formatPriceInput(
            toBasePrice(parseFloat(values.sellPrice) || 0, createPricing.saleFactor)
          ),
          baseUom: createPricing.baseCode,
        })
      : null;

  return (
    <Card className="border-primary/20 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{title}</CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>{tCommon("name")}</Label>
            <Input value={values.name} onChange={(e) => setField("name", e.target.value)} required />
          </div>

          {showUomCreatePricing && (
            <div className="rounded-lg border p-4 sm:col-span-2 space-y-3">
              <div>
                <p className="text-sm font-semibold">{t("unitsAndPricing")}</p>
                <p className="text-xs text-muted-foreground">{t("unitsAndPricingHint")}</p>
              </div>
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
                    variant={values.uomPreset === kind ? "default" : "outline"}
                    onClick={() => {
                      if (kind === "pack") {
                        const raw = window.prompt(tUom("presetPackPrompt"), values.packSize || "24");
                        if (raw == null) return;
                        const n = parseFloat(raw);
                        if (!(n > 0)) return;
                        setValues((v) => ({
                          ...v,
                          uomPreset: "pack",
                          packSize: String(n),
                          baseUomCode: "ea",
                        }));
                        return;
                      }
                      const ctx = buildUomPreset(kind);
                      setValues((v) => ({
                        ...v,
                        uomPreset: kind,
                        baseUomCode: ctx.baseCode,
                      }));
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {createPricing && (
                <p className="text-xs text-muted-foreground">
                  {t("presetSummary", {
                    base: createPricing.baseCode,
                    purchase: createPricing.purchaseCode,
                    sale: createPricing.saleCode,
                  })}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>{costLabel}</Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={costDisplay}
              onChange={(e) => onCostChange(e.target.value)}
              placeholder="0.00"
            />
            {costHelper && <p className="text-xs text-muted-foreground">{costHelper}</p>}
            {canTogglePurchaseCost && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={enterCostInPurchase}
                  onChange={(e) => setEnterCostInPurchase(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                {t("enterCostInPurchaseUom", { uom: purchaseUomCode ?? "ea" })}
              </label>
            )}
            {!showUomCreatePricing && !enterCostInPurchase && (
              <p className="text-xs text-muted-foreground">{t("catalogPricePerBaseHint")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{sellLabel}</Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={sellDisplay}
              onChange={(e) => onSellChange(e.target.value)}
              required
            />
            {sellHelper && <p className="text-xs text-muted-foreground">{sellHelper}</p>}
            {canToggleSalePrice && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={enterSellInSale}
                  onChange={(e) => setEnterSellInSale(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                {t("enterSellInSaleUom", { uom: saleUomCode ?? "ea" })}
              </label>
            )}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>{tCommon("category")}</Label>
            <select
              className={SELECT_CLS}
              value={values.categoryId}
              onChange={(e) => setField("categoryId", e.target.value)}
            >
              <option value="">{tCommon("none")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>{tCommon("sku")}</Label>
            <Input value={values.sku} onChange={(e) => setField("sku", e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`barcode-${formKey}`}>{t("barcode")}</Label>
            <BarcodeCaptureField
              inputId={`barcode-${formKey}`}
              value={values.barcode}
              disabled={loading}
              onChange={(code) => setField("barcode", code)}
              onDuplicateFound={onBarcodeDuplicate}
            />
            <p className="text-xs text-muted-foreground">{t("barcodeHint")}</p>
          </div>

          <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-4 sm:col-span-2">
            <p className="text-sm font-semibold text-amber-950">{t("lowStockAlert")}</p>
            <p className="mt-1 text-xs text-amber-900/80">{t("lowStockHint")}</p>
            <div className="mt-3 max-w-xs space-y-2">
              <Label htmlFor={`reorder-point-${formKey}`}>{t("reorderPoint")}</Label>
              <Input
                id={`reorder-point-${formKey}`}
                type="number"
                step="1"
                min="0"
                value={values.reorderPoint}
                onChange={(e) => setField("reorderPoint", e.target.value)}
                placeholder={t("reorderPlaceholder")}
              />
            </div>
          </div>

          {showStockFields && (
            <>
              <div className="space-y-2">
                <Label>{t("initialStockStore")}</Label>
                <select
                  className={SELECT_CLS}
                  value={values.storeId}
                  onChange={(e) => setField("storeId", e.target.value)}
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>
                  {createPricing
                    ? t("initialQuantityPerUom", { uom: createPricing.baseCode })
                    : t("initialQuantity")}
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={values.initialQty}
                  onChange={(e) => setField("initialQty", e.target.value)}
                />
              </div>
            </>
          )}

          {showActiveToggle && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id={`product-active-${formKey}`}
                type="checkbox"
                checked={values.isActive}
                onChange={(e) => setField("isActive", e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor={`product-active-${formKey}`} className="cursor-pointer font-normal">
                {t("activeInPos")}
              </Label>
            </div>
          )}

          {showExtendedFields && (
            <div className="rounded-lg border p-4 sm:col-span-2 space-y-4">
              <p className="text-sm font-semibold">{t("masterData")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("lifecycle")}</Label>
                  <select
                    className={SELECT_CLS}
                    value={values.lifecycleStatus}
                    onChange={(e) => setField("lifecycleStatus", e.target.value)}
                  >
                    <option value="draft">{t("lifecycleDraft")}</option>
                    <option value="active">{t("lifecycleActive")}</option>
                    <option value="discontinued">{t("lifecycleDiscontinued")}</option>
                    <option value="obsolete">{t("lifecycleObsolete")}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>{tProducts("baseUom")}</Label>
                  <Input
                    value={values.baseUomCode}
                    readOnly
                    disabled
                    title={t("baseUomManagedInUom")}
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">{t("baseUomManagedInUom")}</p>
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <input
                    id={`track-lots-${formKey}`}
                    type="checkbox"
                    checked={values.trackLots}
                    onChange={(e) => setField("trackLots", e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor={`track-lots-${formKey}`} className="cursor-pointer font-normal">
                    {t("trackLots")}
                  </Label>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>{tCommon("description")}</Label>
                  <Input value={values.description} onChange={(e) => setField("description", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("weightKg")}</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={values.weightKg}
                    onChange={(e) => setField("weightKg", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("shelfLifeDays")}</Label>
                  <Input
                    type="number"
                    min="0"
                    value={values.shelfLifeDays}
                    onChange={(e) => setField("shelfLifeDays", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("lengthCm")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={values.lengthCm}
                    onChange={(e) => setField("lengthCm", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("widthCm")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={values.widthCm}
                    onChange={(e) => setField("widthCm", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("heightCm")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={values.heightCm}
                    onChange={(e) => setField("heightCm", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("hsCode")}</Label>
                  <Input value={values.hsCode} onChange={(e) => setField("hsCode", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("countryOfOrigin")}</Label>
                  <Input
                    value={values.countryOfOrigin}
                    onChange={(e) => setField("countryOfOrigin", e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2 sm:col-span-2">
            <Label>{t("photo")}</Label>
            <div className="flex flex-wrap items-start gap-4">
              {previewUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={t("photoPreview")}
                    className="h-24 w-24 rounded-lg border object-cover"
                  />
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow"
                    aria-label={t("removePhoto")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
                  <ImagePlus className="h-8 w-8 opacity-50" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleFileChange}
                  className={cn(
                    "block w-full max-w-xs cursor-pointer text-sm text-foreground",
                    "file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground",
                    "hover:file:bg-primary/90"
                  )}
                />
                <p className="text-xs text-muted-foreground">{t("photoHint")}</p>
              </div>
            </div>
          </div>

          <Button type="submit" disabled={loading} className="sm:col-span-2">
            {loading ? tCommon("saving") : submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export { emptyValues as emptyProductFormValues };
