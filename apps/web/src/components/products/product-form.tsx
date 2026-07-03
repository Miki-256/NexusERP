"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SELECT_CLS } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";
import { BarcodeCaptureField } from "@/components/products/barcode-capture-field";
import { ImagePlus, X } from "lucide-react";

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
};

function mergeValues(
  initialValues: Partial<ProductFormValues> | undefined,
  stores: { id: string; name: string }[]
): ProductFormValues {
  return {
    ...emptyValues,
    ...initialValues,
    storeId: initialValues?.storeId ?? stores[0]?.id ?? "",
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
  initialValues?: Partial<ProductFormValues>;
  existingImageUrl?: string | null;
  onSubmit: (values: ProductFormValues, imageFile: File | null, removeImage: boolean) => void;
  onCancel: () => void;
  onBarcodeDuplicate?: (code: string) => void;
}) {
  const [values, setValues] = useState(() => mergeValues(initialValues, stores));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingImageUrl ?? null);
  const [removeImage, setRemoveImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset only when opening a different form (create vs edit product)
  useEffect(() => {
    setValues(mergeValues(initialValues, stores));
    setImageFile(null);
    setPreviewUrl(existingImageUrl ?? null);
    setRemoveImage(false);
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

  return (
    <Card className="border-primary/20 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{title}</CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(values, imageFile, removeImage);
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <div className="space-y-2 sm:col-span-2">
            <Label>Name</Label>
            <Input value={values.name} onChange={(e) => setField("name", e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>Cost price</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={values.costPrice}
              onChange={(e) => setField("costPrice", e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label>Sell price</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={values.sellPrice}
              onChange={(e) => setField("sellPrice", e.target.value)}
              required
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Category</Label>
            <select
              className={SELECT_CLS}
              value={values.categoryId}
              onChange={(e) => setField("categoryId", e.target.value)}
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>SKU</Label>
            <Input value={values.sku} onChange={(e) => setField("sku", e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`barcode-${formKey}`}>Barcode</Label>
            <BarcodeCaptureField
              inputId={`barcode-${formKey}`}
              value={values.barcode}
              disabled={loading}
              onChange={(code) => setField("barcode", code)}
              onDuplicateFound={onBarcodeDuplicate}
            />
            <p className="text-xs text-muted-foreground">
              USB scanner, camera, or type manually. EAN-13 and UPC supported.
            </p>
          </div>

          <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-4 sm:col-span-2">
            <p className="text-sm font-semibold text-amber-950">Low stock alert</p>
            <p className="mt-1 text-xs text-amber-900/80">
              When on-hand quantity at any store falls to this level or below, the product appears on
              Inventory → Low stock. Use 0 to disable.
            </p>
            <div className="mt-3 max-w-xs space-y-2">
              <Label htmlFor={`reorder-point-${formKey}`}>Reorder point</Label>
              <Input
                id={`reorder-point-${formKey}`}
                type="number"
                step="1"
                min="0"
                value={values.reorderPoint}
                onChange={(e) => setField("reorderPoint", e.target.value)}
                placeholder="e.g. 10"
              />
            </div>
          </div>

          {showStockFields && (
            <>
              <div className="space-y-2">
                <Label>Initial stock store</Label>
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
                <Label>Initial quantity</Label>
                <Input
                  type="number"
                  min="0"
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
                Active (visible in POS)
              </Label>
            </div>
          )}

          <div className="space-y-2 sm:col-span-2">
            <Label>Product photo</Label>
            <div className="flex flex-wrap items-start gap-4">
              {previewUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Product preview"
                    className="h-24 w-24 rounded-lg border object-cover"
                  />
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow"
                    aria-label="Remove photo"
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
                <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or GIF. Max 5 MB.</p>
              </div>
            </div>
          </div>

          <Button type="submit" disabled={loading} className="sm:col-span-2">
            {loading ? "Saving…" : submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export { emptyValues as emptyProductFormValues };
