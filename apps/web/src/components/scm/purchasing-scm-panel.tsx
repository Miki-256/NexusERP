"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { SELECT_CLS } from "@/lib/ui-classes";
import type { MrpSuggestionRow, PurchaseRequisitionRow } from "@/lib/scm/types";
import { Factory, FileInput } from "lucide-react";

type ScmTab = "mrp" | "requisitions";

export function PurchasingScmPanel({
  organizationId,
  stores,
  canManage,
}: {
  organizationId: string;
  stores: { id: string; name: string }[];
  canManage: boolean;
}) {
  const t = useTranslations("purchasing");
  const router = useRouter();
  const { toast } = useToast();
  const [scmTab, setScmTab] = useState<ScmTab>("mrp");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [loading, setLoading] = useState(false);

  const [suggestions, setSuggestions] = useState<MrpSuggestionRow[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  const [requisitions, setRequisitions] = useState<PurchaseRequisitionRow[]>([]);
  const [requisitionsLoaded, setRequisitionsLoaded] = useState(false);

  async function loadSuggestions() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_mrp_suggestions", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
    });
    if (error) {
      toast({ title: t("scm.toast.loadMrpFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setSuggestions((data ?? []) as MrpSuggestionRow[]);
    setSuggestionsLoaded(true);
    setSelectedSuggestions(new Set());
  }

  async function runMrp() {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_mrp", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
    });
    setLoading(false);
    if (error) {
      toast({ title: t("scm.toast.mrpRunFailed"), description: error.message, variant: "destructive" });
      return;
    }
    const result = (data ?? {}) as { suggestion_count?: number };
    toast({
      title: t("scm.toast.mrpComplete"),
      description: t("scm.toast.mrpCompleteDesc", { count: result.suggestion_count ?? 0 }),
    });
    setSuggestionsLoaded(false);
    void loadSuggestions();
  }

  function toggleSuggestion(id: string) {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createRequisitionFromMrp() {
    if (!canManage || !storeId || selectedSuggestions.size === 0) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_requisition_from_mrp", {
      p_org_id: organizationId,
      p_store_id: storeId,
      p_suggestion_ids: Array.from(selectedSuggestions),
    });
    setLoading(false);
    if (error) {
      toast({ title: t("scm.toast.requisitionFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("scm.toast.requisitionCreated"), description: t("scm.toast.requisitionCreatedDesc") });
    setScmTab("requisitions");
    setRequisitionsLoaded(false);
    void loadRequisitions();
    if (data) {
      setSelectedSuggestions(new Set());
      void loadSuggestions();
    }
  }

  async function dismissSuggestion(id: string) {
    if (!canManage) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("dismiss_mrp_suggestion", { p_suggestion_id: id });
    if (error) {
      toast({ title: t("scm.toast.dismissFailed"), description: error.message, variant: "destructive" });
      return;
    }
    void loadSuggestions();
  }

  async function loadRequisitions() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_purchase_requisitions", {
      p_org_id: organizationId,
    });
    if (error) {
      toast({ title: t("scm.toast.loadRequisitionsFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setRequisitions((data ?? []) as PurchaseRequisitionRow[]);
    setRequisitionsLoaded(true);
  }

  async function convertToPo(requisitionId: string) {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("convert_requisition_to_po", {
      p_requisition_id: requisitionId,
    });
    setLoading(false);
    if (error) {
      toast({ title: t("scm.toast.convertFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: t("scm.toast.poCreated"),
      description: t("scm.toast.poCreatedDesc", { id: String(data).slice(0, 8) }),
    });
    setRequisitionsLoaded(false);
    void loadRequisitions();
    router.refresh();
  }

  function switchTab(tab: ScmTab) {
    setScmTab(tab);
    if (tab === "mrp" && !suggestionsLoaded) void loadSuggestions();
    if (tab === "requisitions" && !requisitionsLoaded) void loadRequisitions();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={scmTab === "mrp" ? "default" : "outline"} size="sm" onClick={() => switchTab("mrp")}>
          <Factory className="mr-2 h-4 w-4" />
          {t("scm.tabMrp")}
        </Button>
        <Button type="button" variant={scmTab === "requisitions" ? "default" : "outline"} size="sm" onClick={() => switchTab("requisitions")}>
          <FileInput className="mr-2 h-4 w-4" />
          {t("scm.tabRequisitions")}
        </Button>
        {scmTab === "mrp" && (
          <select className={SELECT_CLS + " ml-auto w-auto min-w-[160px]"} value={storeId} onChange={(e) => { setStoreId(e.target.value); setSuggestionsLoaded(false); }}>
            <option value="">{t("scm.allStores")}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {scmTab === "mrp" && (
        <>
          {canManage && (
            <FormCard title={t("scm.mrpTitle")}>
              <p className="mb-4 text-sm text-muted-foreground">
                {t("scm.mrpDescription")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void runMrp()} disabled={loading}>{t("scm.runMrp")}</Button>
                {selectedSuggestions.size > 0 && (
                  <Button variant="secondary" onClick={() => void createRequisitionFromMrp()} disabled={loading || !storeId}>
                    {t("scm.createRequisition", { count: selectedSuggestions.size })}
                  </Button>
                )}
              </div>
            </FormCard>
          )}

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                {canManage && <DataTableHead>&nbsp;</DataTableHead>}
                <DataTableHead>{t("scm.product")}</DataTableHead>
                <DataTableHead>{t("scm.store")}</DataTableHead>
                <DataTableHead>{t("scm.source")}</DataTableHead>
                <DataTableHead align="right">{t("scm.onHand")}</DataTableHead>
                <DataTableHead align="right">{t("scm.suggest")}</DataTableHead>
                <DataTableHead>{t("scm.vendor")}</DataTableHead>
                {canManage && <DataTableHead>&nbsp;</DataTableHead>}
              </DataTableHeader>
              <DataTableBody>
                {suggestions.length === 0 ? (
                  <DataTableEmpty colSpan={canManage ? 8 : 6} message={t("scm.noSuggestions")} />
                ) : (
                  suggestions.map((s) => (
                    <DataTableRow key={s.id}>
                      {canManage && (
                        <DataTableCell>
                          <input
                            type="checkbox"
                            checked={selectedSuggestions.has(s.id)}
                            onChange={() => toggleSuggestion(s.id)}
                            className="h-4 w-4"
                          />
                        </DataTableCell>
                      )}
                      <DataTableCell>
                        {s.product_name}
                        {s.variant_name !== "Default" && ` (${s.variant_name})`}
                      </DataTableCell>
                      <DataTableCell>{s.store_name}</DataTableCell>
                      <DataTableCell><StatusBadge status={s.source} /></DataTableCell>
                      <DataTableCell align="right" className="font-mono">{s.on_hand}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{s.suggested_qty}</DataTableCell>
                      <DataTableCell className="text-sm">{s.vendor_name ?? "—"}</DataTableCell>
                      {canManage && (
                        <DataTableCell align="right">
                          <Button size="sm" variant="ghost" onClick={() => void dismissSuggestion(s.id)}>{t("scm.dismiss")}</Button>
                        </DataTableCell>
                      )}
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </>
      )}

      {scmTab === "requisitions" && (
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>{t("scm.title")}</DataTableHead>
              <DataTableHead>{t("scm.store")}</DataTableHead>
              <DataTableHead>{t("scm.status")}</DataTableHead>
              <DataTableHead align="right">{t("scm.lines")}</DataTableHead>
              {canManage && <DataTableHead>&nbsp;</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {requisitions.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 5 : 4} message={t("scm.noRequisitions")} />
              ) : (
                requisitions.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell className="font-medium">{r.title}</DataTableCell>
                    <DataTableCell>{r.store_name}</DataTableCell>
                    <DataTableCell><StatusBadge status={r.status} /></DataTableCell>
                    <DataTableCell align="right">{r.line_count}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        {r.status !== "converted" && (
                          <Button size="sm" variant="outline" disabled={loading} onClick={() => void convertToPo(r.id)}>
                            {t("scm.convertToPo")}
                          </Button>
                        )}
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      )}
    </div>
  );
}
