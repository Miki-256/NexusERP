"use client";

import { useMemo, useRef, useState } from "react";
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
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { CategoriesTab } from "./categories-tab";
import { ProductImportTab } from "@/components/products/product-import-tab";
import { ProductReceiveTab } from "@/components/products/product-receive-tab";
import { Package, Pencil, Plus } from "lucide-react";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { TableToolbar, TablePagination } from "@/components/layout/table-toolbar";
import type { CategoryRow } from "./page";

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
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("products");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
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
    setMode("edit");
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function closeForm() {
    setMode("list");
    setEditingProduct(null);
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
        title: "Barcode already in catalog",
        description: `Opening "${existing.name}" for edit.`,
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
      toast({ title: "Could not save product", description: fnError?.message ?? "Unknown error", variant: "destructive" });
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
        title: "Product saved but reorder point failed",
        description: reorderError.message.includes("Could not find the function")
          ? "Apply migration 20260618000034_inventory_advanced.sql in Supabase."
          : reorderError.message,
        variant: "destructive",
      });
      closeForm();
      router.refresh();
      return;
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
        title: "Product saved but photo upload failed",
        description: err instanceof Error ? err.message : "Upload error",
        variant: "destructive",
      });
      closeForm();
      router.refresh();
      return;
    }

    setLoading(false);
    toast({ title: "Product created", description: `"${values.name}" was added successfully.` });
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
        toast({ title: "Could not update product", description: fnError.message, variant: "destructive" });
        return;
      }
      const { error: reorderError } = await supabase.rpc("set_product_reorder_point", {
        p_product_id: editingProduct.id,
        p_reorder_point: parseFloat(values.reorderPoint) || 0,
      });
      if (reorderError) {
        toast({
          title: "Product saved but reorder point failed",
          description: reorderError.message.includes("Could not find the function")
            ? "Apply migration 20260618000034_inventory_advanced.sql in Supabase."
            : reorderError.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Product updated", description: `"${values.name}" was saved.` });
      }
      closeForm();
      router.refresh();
    } catch (err) {
      setLoading(false);
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error",
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
      toast({ title: "Could not remove product", description: fnError.message, variant: "destructive" });
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
      title: "Product removed",
      description: `"${result.name ?? product.name}" is now inactive.`,
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
      }
    : undefined;

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Products"
        description={
          tab === "products"
            ? `${products.length} product${products.length === 1 ? "" : "s"} · ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`
            : `${categories.length} categor${categories.length === 1 ? "y" : "ies"} for your catalog`
        }
        action={
          canManage && tab === "products" ? (
            <Button
              onClick={() => (isFormOpen ? closeForm() : openCreate())}
              className="shadow-sm"
            >
              {isFormOpen ? (
                "Cancel"
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Add product
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      <TabBar
        tabs={[
          { key: "products" as const, label: "Catalog", count: products.length },
          ...(canManage
            ? [
                { key: "import" as const, label: "Import" },
                { key: "receive" as const, label: "Receive" },
              ]
            : []),
          { key: "categories" as const, label: "Categories", count: categories.length },
        ]}
        value={tab}
        onChange={(next) => {
          setTab(next);
          if (next !== "products") closeForm();
        }}
        className="mb-6"
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
        placeholder="Search name, SKU, or barcode…"
        className="mb-4"
      />

      {mode === "create" && canManage && (
        <div ref={formRef} className="mb-6">
          <ProductForm
          formKey="create"
          title="New product"
          submitLabel="Save product"
          loading={loading}
          categories={categoriesForSelect}
          stores={stores}
          showStockFields
          onBarcodeDuplicate={handleBarcodeDuplicate}
          onSubmit={handleCreate}
          onCancel={closeForm}
        />
        </div>
      )}

      {mode === "edit" && canManage && editingProduct && (
        <div ref={formRef} className="mb-6">
          <ProductForm
          formKey={editingProduct.id}
          title={`Edit — ${editingProduct.name}`}
          submitLabel="Save changes"
          loading={loading}
          categories={categoriesForSelect}
          stores={stores}
          showActiveToggle
          initialValues={editInitialValues}
          existingImageUrl={editingProduct.image_url}
          onBarcodeDuplicate={handleBarcodeDuplicate}
          onSubmit={handleUpdate}
          onCancel={closeForm}
        />
        </div>
      )}

      <div className="space-y-3 lg:hidden">
        {products.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No products yet. Add your first product to start selling.
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
                  <p className="text-xs text-muted-foreground">{p.categories?.name ?? "Uncategorized"}</p>
                </div>
                <Badge variant={p.is_active ? "success" : "secondary"}>
                  {p.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="space-y-1.5">
                <MobileRecordCardRow label="Sell">{formatCurrency(p.sell_price, currency)}</MobileRecordCardRow>
                <MobileRecordCardRow label="SKU">{p.sku ?? "—"}</MobileRecordCardRow>
              </div>
              {canManage && (
                <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
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
              <DataTableHead>Product</DataTableHead>
              <DataTableHead hideBelow="md">SKU</DataTableHead>
              <DataTableHead hideBelow="lg">Category</DataTableHead>
              <DataTableHead align="right" hideBelow="xl">Cost</DataTableHead>
              <DataTableHead align="right">Sell</DataTableHead>
              <DataTableHead align="right" hideBelow="xl">Reorder at</DataTableHead>
              <DataTableHead hideBelow="md">Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {products.length === 0 ? (
                <DataTableEmpty
                  colSpan={canManage ? 8 : 7}
                  message="No products yet. Add your first product to start selling."
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
                        {p.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <ConfirmDeleteButton
                            label="Remove"
                            message="Remove from catalog? Product stays in sales history."
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
