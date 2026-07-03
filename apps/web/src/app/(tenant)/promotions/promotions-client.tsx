"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { FormCard } from "@/components/layout/form-card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Pencil, Plus, Tag, X } from "lucide-react";

export type PromotionRow = {
  id: string;
  name: string;
  code: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_total: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
};

type FormMode = "closed" | "create" | "edit";

export function PromotionsClient({
  organizationId,
  promotions,
  canManage,
}: {
  organizationId: string;
  promotions: PromotionRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [formMode, setFormMode] = useState<FormMode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [minOrder, setMinOrder] = useState("0");

  function resetForm() {
    setName("");
    setCode("");
    setDiscountType("percent");
    setDiscountValue("");
    setMinOrder("0");
    setEditingId(null);
    setFormMode("closed");
  }

  function openCreate() {
    resetForm();
    setFormMode("create");
  }

  function openEdit(p: PromotionRow) {
    setEditingId(p.id);
    setName(p.name);
    setCode(p.code ?? "");
    setDiscountType(p.discount_type);
    setDiscountValue(String(p.discount_value));
    setMinOrder(String(p.min_order_total));
    setFormMode("edit");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const value = parseFloat(discountValue);
    const min = parseFloat(minOrder) || 0;

    if (formMode === "edit" && editingId) {
      const { error } = await supabase.rpc("update_promotion", {
        p_promotion_id: editingId,
        p_name: name.trim(),
        p_code: code.trim() || null,
        p_discount_type: discountType,
        p_discount_value: value,
        p_min_order_total: min,
      });
      setLoading(false);
      if (error) {
        toast({ title: "Could not update promotion", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Promotion updated" });
    } else {
      const { error } = await supabase.rpc("create_promotion", {
        p_organization_id: organizationId,
        p_name: name.trim(),
        p_code: code.trim() || null,
        p_discount_type: discountType,
        p_discount_value: value,
        p_min_order_total: min,
      });
      setLoading(false);
      if (error) {
        toast({ title: "Could not create promotion", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Promotion created" });
    }

    resetForm();
    router.refresh();
  }

  async function toggleActive(id: string, active: boolean) {
    const supabase = createClient();
    const { error } = await supabase.rpc("toggle_promotion", {
      p_promotion_id: id,
      p_active: active,
    });
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    router.refresh();
  }

  const formOpen = formMode !== "closed";

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Promotions"
        description="Discount rules for your stores (POS integration coming next)"
        action={
          canManage ? (
            <Button onClick={() => (formOpen ? resetForm() : openCreate())}>
              {formOpen ? (
                <>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  New promotion
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      {formOpen && canManage && (
        <FormCard title={formMode === "edit" ? "Edit promotion" : "Create promotion"}>
          <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Code (optional)</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SUMMER10" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select
                className={SELECT_CLS}
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")}
              >
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <Input
                type="number"
                min="0.01"
                max={discountType === "percent" ? 100 : undefined}
                step="any"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Min order total</Label>
              <Input type="number" min="0" step="any" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
            </div>
            <Button type="submit" disabled={loading} className="w-fit sm:col-span-2">
              {loading ? "Saving…" : formMode === "edit" ? "Save changes" : "Create promotion"}
            </Button>
          </form>
        </FormCard>
      )}

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Code</DataTableHead>
            <DataTableHead>Discount</DataTableHead>
            <DataTableHead>Min order</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            {canManage && <DataTableHead align="right">Actions</DataTableHead>}
          </DataTableHeader>
          <DataTableBody>
            {promotions.length === 0 ? (
              <DataTableEmpty colSpan={canManage ? 6 : 5} message="No promotions yet." />
            ) : (
              promotions.map((p) => (
                <DataTableRow key={p.id}>
                  <DataTableCell>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      {p.name}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="font-mono text-sm">{p.code ?? "—"}</DataTableCell>
                  <DataTableCell>
                    {p.discount_type === "percent" ? `${p.discount_value}%` : p.discount_value}
                  </DataTableCell>
                  <DataTableCell>{p.min_order_total}</DataTableCell>
                  <DataTableCell>
                    <Badge variant={p.is_active ? "default" : "secondary"}>
                      {p.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </DataTableCell>
                  {canManage && (
                    <DataTableCell align="right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void toggleActive(p.id, !p.is_active)}
                        >
                          {p.is_active ? "Deactivate" : "Activate"}
                        </Button>
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
