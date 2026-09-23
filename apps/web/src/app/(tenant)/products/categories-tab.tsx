"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import { useTranslations } from "next-intl";
import { Pencil, Plus, X } from "lucide-react";
import type { CategoryRow } from "./page";

type FormMode = "closed" | "create" | "edit";

export function CategoriesTab({
  organizationId,
  categories,
  productCountByCategory,
  canManage,
}: {
  organizationId: string;
  categories: CategoryRow[];
  productCountByCategory: Record<string, number>;
  canManage: boolean;
}) {
  const t = useTranslations("products.categoriesTab");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { toast } = useToast();
  const [formMode, setFormMode] = useState<FormMode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [busy, setBusy] = useState(false);

  const nextSortOrder = useMemo(() => {
    if (categories.length === 0) return 1;
    return Math.max(...categories.map((c) => c.sort_order), 0) + 1;
  }, [categories]);

  function resetForm() {
    setName("");
    setSortOrder("");
    setEditingId(null);
    setFormMode("closed");
  }

  function openCreate() {
    resetForm();
    setSortOrder(String(nextSortOrder));
    setFormMode("create");
  }

  function openEdit(category: CategoryRow) {
    setEditingId(category.id);
    setName(category.name);
    setSortOrder(String(category.sort_order));
    setFormMode("edit");
  }

  async function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !name.trim()) {
      return toast({ title: t("nameRequired"), variant: "destructive" });
    }
    setBusy(true);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      sort_order: parseInt(sortOrder, 10) || 0,
    };

    const { error } =
      formMode === "edit" && editingId
        ? await supabase
            .from("categories")
            .update(payload)
            .eq("id", editingId)
            .eq("organization_id", organizationId)
        : await supabase.from("categories").insert({
            organization_id: organizationId,
            ...payload,
          });

    setBusy(false);
    if (error) {
      return toast({ title: t("saveFailed"), description: error.message, variant: "destructive" });
    }
    toast({ title: formMode === "edit" ? t("updated") : t("added"), description: name.trim() });
    resetForm();
    router.refresh();
  }

  async function deleteCategory(id: string, categoryName: string) {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("categories").delete().eq("id", id).eq("organization_id", organizationId);
    setBusy(false);
    if (error) {
      return toast({ title: t("deleteFailed"), description: deleteBlockedMessage(error), variant: "destructive" });
    }
    toast({
      title: t("deleted"),
      description: t("deletedDesc", { name: categoryName }),
    });
    if (editingId === id) resetForm();
    router.refresh();
  }

  const formOpen = formMode !== "closed";

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => (formOpen ? resetForm() : openCreate())} className="cursor-pointer shadow-sm">
            {formOpen ? (
              <>
                <X className="h-4 w-4" />
                {tCommon("close")}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t("addCategory")}
              </>
            )}
          </Button>
        </div>
      )}

      {formOpen && canManage && (
        <FormCard title={formMode === "edit" ? t("editCategory") : t("newCategory")}>
          <form onSubmit={saveCategory} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{tCommon("name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t("sortOrder")}</Label>
              <Input
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">{t("sortHint")}</p>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy} className="cursor-pointer">
                {busy ? tCommon("saving") : formMode === "edit" ? tCommon("update") : tCommon("save")}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} className="cursor-pointer">
                {tCommon("cancel")}
              </Button>
            </div>
          </form>
        </FormCard>
      )}

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>{tCommon("name")}</DataTableHead>
            <DataTableHead align="right">{tCommon("products")}</DataTableHead>
            <DataTableHead align="right">{t("sort")}</DataTableHead>
            {canManage && <DataTableHead align="right">{tCommon("actions")}</DataTableHead>}
          </DataTableHeader>
          <DataTableBody>
            {categories.length === 0 ? (
              <DataTableEmpty
                colSpan={canManage ? 4 : 3}
                message={t("empty")}
              />
            ) : (
              categories.map((c) => (
                <DataTableRow key={c.id}>
                  <DataTableCell className="font-medium">{c.name}</DataTableCell>
                  <DataTableCell align="right" className="tabular-nums text-muted-foreground">
                    {productCountByCategory[c.id] ?? 0}
                  </DataTableCell>
                  <DataTableCell align="right" className="tabular-nums text-muted-foreground">
                    {c.sort_order}
                  </DataTableCell>
                  {canManage && (
                    <DataTableCell align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                          {tCommon("edit")}
                        </Button>
                        <ConfirmDeleteButton
                          message={
                            (productCountByCategory[c.id] ?? 0) > 0
                              ? t("deleteWithProducts", { count: productCountByCategory[c.id] ?? 0 })
                              : t("deleteConfirm")
                          }
                          onConfirm={() => deleteCategory(c.id, c.name)}
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
    </div>
  );
}
