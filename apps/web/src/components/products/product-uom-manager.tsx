"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";

export type ProductUomRow = {
  id: string;
  uom_code: string;
  uom_name: string;
  conversion_factor: number;
  is_base: boolean;
  is_sale: boolean;
  is_purchase: boolean;
};

type Draft = {
  code: string;
  name: string;
  factor: string;
  isSale: boolean;
  isPurchase: boolean;
  isBase: boolean;
};

const emptyDraft: Draft = {
  code: "",
  name: "",
  factor: "1",
  isSale: true,
  isPurchase: true,
  isBase: false,
};

export function ProductUomManager({
  productId,
  canManage,
}: {
  productId: string;
  canManage: boolean;
}) {
  const t = useTranslations("products.uom");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const [rows, setRows] = useState<ProductUomRow[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("product_uoms")
      .select("id, uom_code, uom_name, conversion_factor, is_base, is_sale, is_purchase")
      .eq("product_id", productId)
      .order("is_base", { ascending: false })
      .order("uom_code");
    if (error) {
      toast({ title: t("loadFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setRows((data as ProductUomRow[]) ?? []);
  }, [productId, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDraft() {
    if (!canManage) return;
    const code = draft.code.trim();
    const name = draft.name.trim();
    const factor = parseFloat(draft.factor);
    if (!code || !name || !(factor > 0)) {
      toast({ title: t("invalid"), description: t("invalidDesc"), variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_product_uom", {
      p_product_id: productId,
      p_uom_code: code,
      p_uom_name: name,
      p_conversion_factor: draft.isBase ? 1 : factor,
      p_is_base: draft.isBase,
      p_is_sale: draft.isSale,
      p_is_purchase: draft.isPurchase,
      p_uom_id: null,
    });
    setBusy(false);
    if (error) {
      toast({ title: t("saveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("saved"), description: t("savedDesc", { code, factor }) });
    setDraft(emptyDraft);
    await load();
  }

  async function remove(id: string, isBase: boolean) {
    if (!canManage || isBase) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_product_uom", { p_uom_id: id });
    setBusy(false);
    if (error) {
      toast({ title: t("deleteFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("removed") });
    await load();
  }

  async function toggleFlag(row: ProductUomRow, patch: Partial<ProductUomRow>) {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_product_uom", {
      p_product_id: productId,
      p_uom_code: row.uom_code,
      p_uom_name: row.uom_name,
      p_conversion_factor: patch.is_base ? 1 : Number(row.conversion_factor),
      p_is_base: patch.is_base ?? row.is_base,
      p_is_sale: patch.is_sale ?? row.is_sale,
      p_is_purchase: patch.is_purchase ?? row.is_purchase,
      p_uom_id: row.id,
    });
    setBusy(false);
    if (error) {
      toast({ title: t("updateFailed"), description: error.message, variant: "destructive" });
      return;
    }
    await load();
  }

  async function applyPreset(
    kind: "weight" | "volume" | "pack",
    packSize?: number
  ) {
    if (!canManage) return;
    setBusy(true);
    const { applyProductUomPreset } = await import("@/lib/scm/apply-product-uom-preset");
    const { error } = await applyProductUomPreset(
      createClient(),
      productId,
      kind,
      packSize && packSize > 0 ? packSize : 24
    );
    setBusy(false);
    if (error) {
      toast({ title: t("presetFailed"), description: error, variant: "destructive" });
      return;
    }
    toast({ title: t("presetApplied") });
    await load();
  }

  const baseCode = rows.find((r) => r.is_base)?.uom_code ?? "ea";

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("priceHint")}</p>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void applyPreset("weight")}>
            {t("presetWeight")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void applyPreset("volume")}>
            {t("presetVolume")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              const raw = window.prompt(t("presetPackPrompt"), "24");
              if (raw == null) return;
              const n = parseFloat(raw);
              if (!(n > 0)) {
                toast({ title: t("invalid"), description: t("invalidDesc"), variant: "destructive" });
                return;
              }
              void applyPreset("pack", n);
            }}
          >
            {t("presetPack")}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("currentBase", { code: baseCode })}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-2 font-medium">{tCommon("code")}</th>
              <th className="py-2 pr-2 font-medium">{tCommon("name")}</th>
              <th className="py-2 pr-2 font-medium">{t("factor")}</th>
              <th className="py-2 pr-2 font-medium">{t("flags")}</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 pr-2 font-mono text-xs">{r.uom_code}</td>
                <td className="py-2 pr-2">{r.uom_name}</td>
                <td className="py-2 pr-2 font-mono">{Number(r.conversion_factor)}</td>
                <td className="py-2 pr-2">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={r.is_base}
                        disabled={!canManage || busy}
                        onChange={(e) => void toggleFlag(r, { is_base: e.target.checked })}
                      />
                      {t("base")}
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={r.is_sale}
                        disabled={!canManage || busy}
                        onChange={(e) => void toggleFlag(r, { is_sale: e.target.checked })}
                      />
                      {t("sale")}
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={r.is_purchase}
                        disabled={!canManage || busy}
                        onChange={(e) => void toggleFlag(r, { is_purchase: e.target.checked })}
                      />
                      {t("purchase")}
                    </label>
                  </div>
                </td>
                <td className="py-2 text-right">
                  {!r.is_base && canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void remove(r.id, r.is_base)}
                      aria-label={t("deleteAria", { code: r.uom_code })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1">
            <Label>{tCommon("code")}</Label>
            <Input
              value={draft.code}
              onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
              placeholder={t("codePlaceholder")}
            />
          </div>
          <div className="space-y-1">
            <Label>{tCommon("name")}</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t("namePlaceholder")}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("baseUnitsPer")}</Label>
            <Input
              type="number"
              min="0.000001"
              step="any"
              value={draft.factor}
              disabled={draft.isBase}
              onChange={(e) => setDraft((d) => ({ ...d, factor: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3 pb-2 text-xs sm:col-span-2 lg:col-span-2">
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.isBase}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    isBase: e.target.checked,
                    factor: e.target.checked ? "1" : d.factor,
                    isSale: true,
                    isPurchase: true,
                  }))
                }
              />
              {t("base")}
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.isSale}
                onChange={(e) => setDraft((d) => ({ ...d, isSale: e.target.checked }))}
              />
              {t("sale")}
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.isPurchase}
                onChange={(e) => setDraft((d) => ({ ...d, isPurchase: e.target.checked }))}
              />
              {t("purchase")}
            </label>
          </div>
          <div className="flex items-end">
            <Button type="button" disabled={busy} onClick={() => void saveDraft()}>
              <Plus className="h-4 w-4" />
              {t("addUom")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
