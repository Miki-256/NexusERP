"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { uploadProductImage, removeProductImage } from "@/lib/product-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { TabBar } from "@/components/layout/tab-bar";
import { PAGE_SHELL } from "@/lib/ui-classes";
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
import { ProductForm, type ProductFormValues } from "@/components/products/product-form";
import { ProductUomManager } from "@/components/products/product-uom-manager";
import { applyProductUomPreset } from "@/lib/scm/apply-product-uom-preset";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { CategoriesTab } from "./categories-tab";
import { ProductImportTab } from "@/components/products/product-import-tab";
import { ProductReceiveTab } from "@/components/products/product-receive-tab";
import { Package, Pencil, Plus } from "lucide-react";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { TableToolbar, TablePagination } from "@/components/layout/table-toolbar";
import type { CategoryRow } from "./page";
import type { ProductExtendedFields } from "@/lib/scm/types";

type Tab = "products" | "import" | "receive" | "categories";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  sell_price: number;
  cost_price: number;
  reorder_point?: number;
  is_active: boolean;
  image_url: string | null;
  category_id: string | null;
  categories: { name: string } | null;
  product_variants: { id: string; name: string }[];
};

export function ProductsClient({
  products,
  categories,
  stores,
  organizationId,
  currency,
  canManage,
  total,
  page,
  pageSize,
  searchQuery,
  productCountByCategory,
}: {
  products: Product[];
  categories: CategoryRow[];
  stores: { id: string; name: string }[];
  organizationId: string;
  currency: string;
  canManage: boolean;
  total: number;
  page: number;
  pageSize: number;
  searchQuery: string;
  productCountByCategory: Record<string, number>;
}) {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("products");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [extendedLoading, setExtendedLoading] = useState(false);
  const [extendedFields, setExtendedFields] = useState<Partial<ProductExtendedFields>>({});
  const [editUoms, setEditUoms] = useState<
    { uom_code: string; conversion_factor: number; is_base: boolean; is_purchase: boolean; is_sale: boolean }[]
  >([]);
  const [trackLots, setTrackLots] = useState(false);
  const [searchInput, setSearchInput] = useState(searchQuery);
  const formRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function navigateList(nextPage: number, q: string) {
    const params = new URLSearchParams();
    const trimmed = q.trim();
    if (trimmed) params.set("q", trimmed);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.push(qs ? `/products?${qs}` : "/products");
  }

  function submitSearch() {
    navigateList(1, searchInput);
  }

  // Debounced live filter — typing SKU/name must filter without requiring Enter.
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const applied = searchQuery.trim();
    if (trimmed === applied) return;
    const id = window.setTimeout(() => navigateList(1, searchInput), 280);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on typed search
  }, [searchInput]);

  const isFormOpen = mode === "create" || mode === "edit";

  const categoriesForSelect = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name })),
    [categories]
  );

  function openCreate() {
    setEditingProduct(null);
    setMode("create");
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setExtendedFields({});
    setEditUoms([]);
    setTrackLots(false);
    setMode("edit");
    setExtendedLoading(true);
    void (async () => {
      const supabase = createClient();
      const [{ data }, { data: uomData }] = await Promise.all([
        supabase.rpc("get_product_detail", { p_product_id: product.id }),
        supabase
          .from("product_uoms")
          .select("uom_code, conversion_factor, is_base, is_purchase, is_sale")
          .eq("product_id", product.id),
      ]);
      const detail = (data ?? {}) as { product?: Record<string, unknown> };
      const p = detail.product;
      if (p) {
        setExtendedFields({
          lifecycle_status: (p.lifecycle_status as ProductExtendedFields["lifecycle_status"]) ?? "active",
          base_uom_code: (p.base_uom_code as string) ?? "ea",
          weight_kg: (p.weight_kg as number | null) ?? null,
          length_cm: (p.length_cm as number | null) ?? null,
          width_cm: (p.width_cm as number | null) ?? null,
          height_cm: (p.height_cm as number | null) ?? null,
          hs_code: (p.hs_code as string | null) ?? null,
          country_of_origin: (p.country_of_origin as string | null) ?? null,
          shelf_life_days: (p.shelf_life_days as number | null) ?? null,
          description: (p.description as string | null) ?? null,
        });
        setTrackLots(Boolean(p.track_lots));
      }
      setEditUoms(
        (uomData as typeof editUoms | null) ?? []
      );
      setExtendedLoading(false);
    })();
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function closeForm() {
    setMode("list");
    setEditingProduct(null);
    setExtendedFields({});
    setTrackLots(false);
  }

  function extendedPayload(values: ProductFormValues) {
    return {
      lifecycle_status: values.lifecycleStatus,
      base_uom_code: values.baseUomCode || "ea",
      description: values.description || null,
      hs_code: values.hsCode || null,
      country_of_origin: values.countryOfOrigin || null,
      weight_kg: values.weightKg ? parseFloat(values.weightKg) : null,
      length_cm: values.lengthCm ? parseFloat(values.lengthCm) : null,
      width_cm: values.widthCm ? parseFloat(values.widthCm) : null,
      height_cm: values.heightCm ? parseFloat(values.heightCm) : null,
      shelf_life_days: values.shelfLifeDays ? parseInt(values.shelfLifeDays, 10) : null,
    };
  }

  async function handleBarcodeDuplicate(code: string) {
    if (mode === "edit") return;
    const supabase = createClient();
    const { data } = await supabase.rpc("find_product_by_barcode", {
      p_org_id: organizationId,
      p_barcode: code,
    });
    const row = (data ?? {}) as { found?: boolean; product_id?: string };
    if (!row.found || !row.product_id) return;
    const existing = products.find((p) => p.id === row.product_id);
    if (existing) {
      toast({
        title: t("toast.barcodeExists"),
        description: t("toast.barcodeExistsDesc", { name: existing.name }),
      });
      openEdit(existing);
    }
  }

  async function resolveImageUrl(
    productId: string,
    imageFile: File | null,
    removeImage: boolean,
    currentUrl: string | null
  ): Promise<string | null> {
    const supabase = createClient();
    if (removeImage && currentUrl) {
      try {
        await removeProductImage(supabase, currentUrl);
      } catch {
        /* ignore storage cleanup errors */
      }
      return null;
    }
    if (imageFile) {
      if (currentUrl) {
        try {
          await removeProductImage(supabase, currentUrl);
        } catch {
          /* ignore */
        }
      }
      return uploadProductImage(supabase, organizationId, productId, imageFile);
    }
    return currentUrl;
  }

  async function handleCreate(
    values: ProductFormValues,
    imageFile: File | null,
    _removeImage: boolean
  ) {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();

    const { data, error: fnError } = await supabase.rpc("create_product_with_variant", {
      p_organization_id: organizationId,
      p_name: values.name,
      p_category_id: values.categoryId || null,
      p_sku: values.sku || null,
      p_barcode: values.barcode || null,
      p_sell_price: parseFloat(values.sellPrice),
      p_cost_price: parseFloat(values.costPrice) || 0,
      p_tax_rate: null,
      p_store_id: values.storeId || null,
      p_initial_qty: parseFloat(values.initialQty) || 0,
      p_image_url: null,
    });

    if (fnError || !data) {
      setLoading(false);
      toast({
        title: t("toast.saveFailed"),
        description: fnError?.message ?? tCommon("unknownError"),
        variant: "destructive",
      });
      return;
    }

    const result = data as { product_id: string };
    const reorderPoint = parseFloat(values.reorderPoint) || 0;
    const { error: reorderError } = await supabase.rpc("set_product_reorder_point", {
      p_product_id: result.product_id,
      p_reorder_point: reorderPoint,
    });
    if (reorderError) {
      setLoading(false);
      toast({
        title: t("toast.reorderFailed"),
        description: reorderError.message.includes("Could not find the function")
          ? t("toast.applyMigration", { file: "20260618000034_inventory_advanced.sql" })
          : reorderError.message,
        variant: "destructive",
      });
      closeForm();
      router.refresh();
      return;
    }

    if (values.uomPreset && values.uomPreset !== "each") {
      const pack = parseFloat(values.packSize) || 24;
      const { error: uomError } = await applyProductUomPreset(
        supabase,
        result.product_id,
        values.uomPreset,
        pack
      );
      if (uomError) {
        toast({
          title: t("uom.presetFailed"),
          description: uomError,
          variant: "destructive",
        });
      }
    }

    try {
      if (imageFile) {
        const imageUrl = await uploadProductImage(supabase, organizationId, result.product_id, imageFile);
        await supabase.rpc("update_product_with_variant", {
          p_product_id: result.product_id,
          p_name: values.name,
          p_category_id: values.categoryId || null,
          p_sku: values.sku || null,
          p_barcode: values.barcode || null,
          p_sell_price: parseFloat(values.sellPrice),
          p_cost_price: parseFloat(values.costPrice) || 0,
          p_tax_rate: null,
          p_image_url: imageUrl,
          p_is_active: true,
        });
      }
    } catch (err) {
      setLoading(false);
      toast({
        title: t("toast.photoFailed"),
        description: err instanceof Error ? err.message : t("toast.uploadError"),
        variant: "destructive",
      });
      closeForm();
      router.refresh();
      return;
    }

    setLoading(false);
    toast({ title: t("toast.created"), description: t("toast.createdDesc", { name: values.name }) });
    closeForm();
    router.refresh();
  }

  async function handleUpdate(
    values: ProductFormValues,
    imageFile: File | null,
    removeImage: boolean
  ) {
    if (!canManage || !editingProduct) return;
    setLoading(true);
    const supabase = createClient();

    try {
      const imageUrl = await resolveImageUrl(
        editingProduct.id,
        imageFile,
        removeImage,
        editingProduct.image_url
      );

      const { error: fnError } = await supabase.rpc("update_product_with_variant", {
        p_product_id: editingProduct.id,
        p_name: values.name,
        p_category_id: values.categoryId || null,
        p_sku: values.sku || null,
        p_barcode: values.barcode || null,
        p_sell_price: parseFloat(values.sellPrice),
        p_cost_price: parseFloat(values.costPrice) || 0,
        p_tax_rate: null,
        p_image_url: imageUrl,
        p_is_active: values.isActive,
      });

      setLoading(false);
      if (fnError) {
        toast({ title: t("toast.updateRpcFailed"), description: fnError.message, variant: "destructive" });
        return;
      }
      const { error: reorderError } = await supabase.rpc("set_product_reorder_point", {
        p_product_id: editingProduct.id,
        p_reorder_point: parseFloat(values.reorderPoint) || 0,
      });
      const { error: extendedError } = await supabase.rpc("update_product_extended", {
        p_product_id: editingProduct.id,
        p_fields: extendedPayload(values),
      });
      const { error: lotError } = await supabase.rpc("set_product_lot_tracking", {
        p_product_id: editingProduct.id,
        p_track_lots: values.trackLots,
      });
      if (reorderError) {
        toast({
          title: t("toast.reorderFailed"),
          description: reorderError.message.includes("Could not find the function")
            ? t("toast.applyMigration", { file: "20260618000034_inventory_advanced.sql" })
            : reorderError.message,
          variant: "destructive",
        });
      } else if (extendedError) {
        toast({
          title: t("toast.masterDataFailed"),
          description: extendedError.message.includes("Could not find the function")
            ? t("toast.applyScmWave1")
            : extendedError.message,
          variant: "destructive",
        });
      } else if (lotError) {
        toast({
          title: t("toast.lotTrackingFailed"),
          description: lotError.message.includes("Could not find the function")
            ? t("toast.applyScmWave2")
            : lotError.message,
          variant: "destructive",
        });
      } else {
        toast({ title: t("toast.updated"), description: t("toast.updatedDesc", { name: values.name }) });
      }
      closeForm();
      router.refresh();
    } catch (err) {
      setLoading(false);
      toast({
        title: t("toast.updateFailed"),
        description: err instanceof Error ? err.message : tCommon("unknownError"),
        variant: "destructive",
      });
    }
  }

  async function deactivateProduct(product: Product) {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.rpc("deactivate_product_catalog_item", {
      p_product_id: product.id,
    });
    if (fnError) {
      setLoading(false);
      toast({ title: t("toast.removeFailed"), description: fnError.message, variant: "destructive" });
      return;
    }
    const result = (data ?? {}) as { image_url?: string | null; name?: string };
    if (result.image_url) {
      try {
        await removeProductImage(supabase, result.image_url);
      } catch {
        /* storage cleanup best-effort */
      }
    }
    setLoading(false);
    toast({
      title: t("toast.removed"),
      description: t("toast.removedDesc", { name: result.name ?? product.name }),
    });
    if (editingProduct?.id === product.id) closeForm();
    router.refresh();
  }

  const editInitialValues: Partial<ProductFormValues> | undefined = editingProduct
    ? {
        name: editingProduct.name,
        sellPrice: String(editingProduct.sell_price),
        costPrice: String(editingProduct.cost_price),
        reorderPoint: String(editingProduct.reorder_point ?? 0),
        barcode: editingProduct.barcode ?? "",
        sku: editingProduct.sku ?? "",
        categoryId: editingProduct.category_id ?? "",
        isActive: editingProduct.is_active,
        trackLots,
        lifecycleStatus: extendedFields.lifecycle_status ?? "active",
        baseUomCode: extendedFields.base_uom_code ?? "ea",
        description: extendedFields.description ?? "",
        weightKg: extendedFields.weight_kg != null ? String(extendedFields.weight_kg) : "",
        lengthCm: extendedFields.length_cm != null ? String(extendedFields.length_cm) : "",
        widthCm: extendedFields.width_cm != null ? String(extendedFields.width_cm) : "",
        heightCm: extendedFields.height_cm != null ? String(extendedFields.height_cm) : "",
        hsCode: extendedFields.hs_code ?? "",
        countryOfOrigin: extendedFields.country_of_origin ?? "",
        shelfLifeDays: extendedFields.shelf_life_days != null ? String(extendedFields.shelf_life_days) : "",
      }
    : undefined;

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
      compact
      title={t("title")}
        description={
          tab === "products"
            ? t("summary", { products: products.length, categories: categories.length })
            : t("categoriesSummary", { count: categories.length })
        }
        action={
          canManage && tab === "products" ? (
            <Button
              onClick={() => (isFormOpen ? closeForm() : openCreate())}
              className="shadow-sm"
            >
              {isFormOpen ? (
                tCommon("cancel")
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  {t("addProduct")}
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      <TabBar
        tabs={[
          { key: "products" as const, label: t("catalog"), count: products.length },
          ...(canManage
            ? [
                { key: "import" as const, label: t("import") },
                { key: "receive" as const, label: t("receive") },
              ]
            : []),
          { key: "categories" as const, label: t("categories"), count: categories.length },
        ]}
        value={tab}
        onChange={(next) => {
          setTab(next);
          if (next !== "products") closeForm();
        }}
        className="mb-4"
      />

      {tab === "import" && canManage && (
        <ProductImportTab
          organizationId={organizationId}
          stores={stores}
          products={products}
          currency={currency}
        />
      )}

      {tab === "receive" && canManage && (
        <ProductReceiveTab
          organizationId={organizationId}
          stores={stores}
          categories={categoriesForSelect}
          currency={currency}
        />
      )}

      {tab === "categories" ? (
        <CategoriesTab
          organizationId={organizationId}
          categories={categories}
          productCountByCategory={productCountByCategory}
          canManage={canManage}
        />
      ) : (
        <>
      <TableToolbar
        search={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={submitSearch}
        placeholder={t("searchNameSkuBarcode")}
        className="mb-3"
      />

      {mode === "create" && canManage && (
        <div ref={formRef} className="mb-4">
          <ProductForm
          formKey="create"
          title={t("newProduct")}
          submitLabel={t("saveProduct")}
          loading={loading}
          categories={categoriesForSelect}
          stores={stores}
          showStockFields
          showUomCreatePricing
          onBarcodeDuplicate={handleBarcodeDuplicate}
          onSubmit={handleCreate}
          onCancel={closeForm}
        />
        </div>
      )}

      {mode === "edit" && canManage && editingProduct && (
        <div ref={formRef} className="mb-4 space-y-4">
          <ProductForm
          formKey={`${editingProduct.id}-${extendedLoading ? "loading" : "ready"}`}
          title={t("editTitle", { name: editingProduct.name })}
          submitLabel={t("saveChanges")}
          loading={loading || extendedLoading}
          categories={categoriesForSelect}
          stores={stores}
          showActiveToggle
          showExtendedFields={!extendedLoading}
          purchaseUomCode={
            editUoms.find((u) => u.is_purchase && !u.is_base)?.uom_code ??
            editUoms.find((u) => u.is_purchase)?.uom_code
          }
          purchaseFactor={
            editUoms.find((u) => u.is_purchase && !u.is_base)?.conversion_factor ??
            editUoms.find((u) => u.is_purchase)?.conversion_factor
          }
          saleUomCode={
            editUoms.find((u) => u.is_sale && !u.is_base)?.uom_code ??
            editUoms.find((u) => u.is_sale)?.uom_code
          }
          saleFactor={
            editUoms.find((u) => u.is_sale && !u.is_base)?.conversion_factor ??
            editUoms.find((u) => u.is_sale)?.conversion_factor
          }
          initialValues={editInitialValues}
          existingImageUrl={editingProduct.image_url}
          onBarcodeDuplicate={handleBarcodeDuplicate}
          onSubmit={handleUpdate}
          onCancel={closeForm}
        />
          {!extendedLoading && (
            <ProductUomManager productId={editingProduct.id} canManage={canManage} />
          )}
        </div>
      )}

      <div className="space-y-3 lg:hidden">
        {products.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          products.map((p) => (
            <MobileRecordCard key={p.id}>
              <div className="mb-3 flex items-center gap-3">
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" className="h-12 w-12 rounded-lg border object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Package className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.categories?.name ?? tCommon("uncategorized")}</p>
                </div>
                <Badge variant={p.is_active ? "success" : "secondary"}>
                  {p.is_active ? tCommon("active") : tCommon("inactive")}
                </Badge>
              </div>
              <div className="space-y-1.5">
                <MobileRecordCardRow label={tCommon("sell")}>{formatCurrency(p.sell_price, currency)}</MobileRecordCardRow>
                <MobileRecordCardRow label={tCommon("sku")}>{p.sku ?? "—"}</MobileRecordCardRow>
              </div>
              {canManage && (
                <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {tCommon("edit")}
                  </Button>
                </div>
              )}
            </MobileRecordCard>
          ))
        )}
        {total > pageSize && (
          <TablePagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={(next) => navigateList(next, searchQuery)}
          />
        )}
      </div>

      <div className="hidden lg:block">
      <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>{tCommon("product")}</DataTableHead>
              <DataTableHead hideBelow="md">{tCommon("sku")}</DataTableHead>
              <DataTableHead hideBelow="lg">{tCommon("category")}</DataTableHead>
              <DataTableHead align="right" hideBelow="xl">{tCommon("cost")}</DataTableHead>
              <DataTableHead align="right">{tCommon("sell")}</DataTableHead>
              <DataTableHead align="right" hideBelow="xl">{t("reorderAt")}</DataTableHead>
              <DataTableHead hideBelow="md">{tCommon("status")}</DataTableHead>
              {canManage && <DataTableHead align="right">{tCommon("actions")}</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {products.length === 0 ? (
                <DataTableEmpty
                  colSpan={canManage ? 8 : 7}
                  message={t("empty")}
                />
              ) : (
                products.map((p) => (
                  <DataTableRow key={p.id}>
                    <DataTableCell>
                      <div className="flex items-center gap-3">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.image_url}
                            alt=""
                            className="h-10 w-10 rounded-lg border object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Package className="h-4 w-4" />
                          </div>
                        )}
                        <span className="font-medium">{p.name}</span>
                      </div>
                    </DataTableCell>
                    <DataTableCell className="font-mono text-muted-foreground">
                      {p.sku ?? "—"}
                    </DataTableCell>
                    <DataTableCell>{p.categories?.name ?? "—"}</DataTableCell>
                    <DataTableCell align="right" className="font-mono text-muted-foreground">
                      {formatCurrency(p.cost_price, currency)}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono font-medium">
                      {formatCurrency(p.sell_price, currency)}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono text-muted-foreground">
                      {(p.reorder_point ?? 0) > 0 ? p.reorder_point : "—"}
                    </DataTableCell>
                    <DataTableCell>
                      <Badge variant={p.is_active ? "success" : "secondary"}>
                        {p.is_active ? tCommon("active") : tCommon("inactive")}
                      </Badge>
                    </DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            {tCommon("edit")}
                          </Button>
                          <ConfirmDeleteButton
                            label={tCommon("remove")}
                            message={t("removeConfirm")}
                            onConfirm={() => deactivateProduct(p)}
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
      <TablePagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={(next) => navigateList(next, searchQuery)}
      />
      </div>
        </>
      )}
    </div>
  );
}
