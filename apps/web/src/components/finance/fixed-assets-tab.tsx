"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
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
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";
import { BookOpen, Building } from "lucide-react";

export type FaBookRow = {
  id: string;
  code: string;
  name: string;
  book_type: string;
  is_primary: boolean;
  posts_to_gl: boolean;
  depr_method: string;
  asset_count?: number;
};

export type FaBookComparison = {
  book_id: string;
  book_code: string;
  book_name: string;
  book_type: string;
  is_primary: boolean;
  posts_to_gl: boolean;
  asset_count: number;
  total_cost: number;
  total_accum_depr: number;
  total_nbv: number;
};

export type AssetBookSummary = {
  book_id: string;
  book_code: string;
  book_name: string;
  is_primary: boolean;
  posts_to_gl: boolean;
  useful_life_months: number;
  depr_method: string;
  accumulated_depreciation: number;
  book_value: number;
  status: string;
};

export type FixedAssetRow = {
  id: string;
  asset_no: string;
  name: string;
  acquisition_date: string;
  acquisition_cost: number;
  salvage_value: number;
  useful_life_months: number;
  monthly_depreciation: number;
  accumulated_depreciation: number;
  book_value: number;
  status: string;
  books?: AssetBookSummary[];
};

export function FixedAssetsTab({
  orgId,
  currency,
  canManage,
  assets: initialAssets,
  faBooks: initialBooks,
  bookComparison: initialComparison,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  assets: FixedAssetRow[];
  faBooks: FaBookRow[];
  bookComparison: FaBookComparison[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [assets, setAssets] = useState(initialAssets);
  const [books, setBooks] = useState(initialBooks);
  const [comparison, setComparison] = useState(initialComparison);
  const [selectedBookId, setSelectedBookId] = useState<string>("all");
  const [selectedAssetId, setSelectedAssetId] = useState(initialAssets[0]?.id ?? "");
  const [bookDetail, setBookDetail] = useState<{ books?: AssetBookSummary[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [acqDate, setAcqDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState("");
  const [salvage, setSalvage] = useState("0");
  const [lifeMonths, setLifeMonths] = useState("60");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");

  const primaryBook = useMemo(() => books.find((b) => b.is_primary) ?? books[0], [books]);

  const displayAssets = useMemo(() => {
    if (selectedBookId === "all") return assets;
    return assets.map((a) => {
      const book = a.books?.find((b) => b.book_id === selectedBookId);
      if (!book) return a;
      return {
        ...a,
        book_value: book.book_value,
        accumulated_depreciation: book.accumulated_depreciation,
        useful_life_months: book.useful_life_months,
      };
    });
  }, [assets, selectedBookId]);

  const totalCost = displayAssets.filter((a) => a.status !== "disposed").reduce((s, a) => s + Number(a.acquisition_cost), 0);
  const totalNbv = displayAssets.filter((a) => a.status === "active").reduce((s, a) => s + Number(a.book_value), 0);

  const loadDetail = useCallback(async (assetId: string) => {
    if (!assetId) {
      setBookDetail(null);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_fixed_asset_book_detail", { p_asset_id: assetId });
    if (error) {
      toast({ title: "Load detail failed", description: error.message, variant: "destructive" });
      return;
    }
    setBookDetail(data as { books?: AssetBookSummary[] });
  }, [toast]);

  useEffect(() => {
    if (selectedAssetId) void loadDetail(selectedAssetId);
  }, [selectedAssetId, loadDetail]);

  async function refresh() {
    const supabase = createClient();
    const [{ data: assetData }, { data: bookData }, { data: cmpData }] = await Promise.all([
      supabase.rpc("list_fixed_assets", { p_org_id: orgId }),
      supabase.rpc("list_fa_books", { p_org_id: orgId }),
      supabase.rpc("get_fa_book_comparison", { p_org_id: orgId }),
    ]);
    setAssets((assetData as FixedAssetRow[]) ?? []);
    setBooks((bookData as FaBookRow[]) ?? []);
    setComparison((cmpData as FaBookComparison[]) ?? []);
    router.refresh();
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy("register");
    const supabase = createClient();
    const { error } = await supabase.rpc("register_fixed_asset", {
      p_org_id: orgId,
      p_name: name.trim(),
      p_acquisition_date: acqDate,
      p_cost: Number(cost),
      p_salvage: Number(salvage) || 0,
      p_useful_life_months: Number(lifeMonths) || 60,
      p_payment_method: paymentMethod,
    });
    setBusy("");
    if (error) {
      toast({ title: "Register failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Asset registered with financial & tax book profiles" });
    setShowForm(false);
    setName("");
    setCost("");
    await refresh();
  }

  async function runDepreciation() {
    setBusy("depr");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_depreciation_batch", {
      p_org_id: orgId,
      p_book_id: selectedBookId === "all" ? null : selectedBookId,
    });
    setBusy("");
    if (error) {
      toast({ title: "Depreciation failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as { posted?: number; posted_gl?: number };
    const posted = result.posted ?? 0;
    const gl = result.posted_gl ?? 0;
    toast({
      title: posted > 0 ? `Posted ${posted} depreciation entr${posted === 1 ? "y" : "ies"}` : "Nothing to depreciate",
      description: gl > 0 ? `${gl} posted to GL (financial book)` : undefined,
    });
    await refresh();
    if (selectedAssetId) await loadDetail(selectedAssetId);
  }

  async function dispose(id: string) {
    setBusy(id);
    const supabase = createClient();
    const { error } = await supabase.rpc("dispose_fixed_asset", {
      p_asset_id: id,
      p_proceeds: 0,
      p_payment_method: "bank_transfer",
    });
    setBusy("");
    if (error) {
      toast({ title: "Dispose failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Asset disposed" });
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active assets" value={String(displayAssets.filter((a) => a.status === "active").length)} icon={Building} />
        <StatCard label="Total cost" value={money(totalCost)} icon={Building} />
        <StatCard label="Net book value" value={money(totalNbv)} sub={selectedBookId === "all" ? primaryBook?.name : undefined} icon={Building} />
        <StatCard label="Depreciation books" value={String(books.length)} icon={BookOpen} />
      </div>

      <ReportSection title="Book comparison" subtitle="Financial vs tax (and other) depreciation books side by side">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Book</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead align="right">Assets</DataTableHead>
              <DataTableHead align="right">Cost</DataTableHead>
              <DataTableHead align="right">Accum depr</DataTableHead>
              <DataTableHead align="right">NBV</DataTableHead>
              <DataTableHead>GL</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {comparison.length === 0 ? (
                <DataTableEmpty colSpan={7} message="No depreciation books." />
              ) : (
                comparison.map((row) => (
                  <DataTableRow key={row.book_id} selected={row.book_id === selectedBookId}>
                    <DataTableCell>
                      {row.book_code} — {row.book_name}
                      {row.is_primary && <span className="ml-2 text-xs text-muted-foreground">(primary)</span>}
                    </DataTableCell>
                    <DataTableCell>{row.book_type}</DataTableCell>
                    <DataTableCell align="right">{row.asset_count}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.total_cost))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.total_accum_depr))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.total_nbv))}</DataTableCell>
                    <DataTableCell>{row.posts_to_gl ? "Yes" : "Memo"}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      <ReportSection title="Fixed asset register" subtitle="Multi-book straight-line / DDB · financial book posts to GL">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className={SELECT_CLS}
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
          >
            <option value="all">All books (primary NBV)</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
            ))}
          </select>
          {canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>Register asset</Button>
              <Button size="sm" onClick={runDepreciation} disabled={!!busy}>Run depreciation</Button>
            </>
          )}
        </div>

        {showForm && canManage && (
          <form onSubmit={register} className="mb-6 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Asset name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Delivery van" />
            </div>
            <div className="space-y-2">
              <Label>Acquisition date</Label>
              <DatePicker value={acqDate} onChange={setAcqDate} />
            </div>
            <div className="space-y-2">
              <Label>Cost</Label>
              <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Salvage value</Label>
              <Input type="number" min="0" step="0.01" value={salvage} onChange={(e) => setSalvage(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Useful life (months, financial book)</Label>
              <Input type="number" min="1" value={lifeMonths} onChange={(e) => setLifeMonths(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Payment method</Label>
              <select className={SELECT_CLS} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="bank_transfer">Bank</option>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy === "register"}>Register &amp; post</Button>
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Asset</DataTableHead>
              <DataTableHead>Acquired</DataTableHead>
              <DataTableHead align="right">Cost</DataTableHead>
              <DataTableHead align="right">NBV</DataTableHead>
              <DataTableHead>Books</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {displayAssets.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 7 : 6} message="No fixed assets registered." />
              ) : (
                displayAssets.map((a) => (
                  <DataTableRow key={a.id} selected={a.id === selectedAssetId}>
                    <DataTableCell>
                      <button type="button" className="text-left hover:underline" onClick={() => setSelectedAssetId(a.id)}>
                        <span className="font-mono text-xs text-muted-foreground">{a.asset_no}</span>
                        <div>{a.name}</div>
                      </button>
                    </DataTableCell>
                    <DataTableCell>{a.acquisition_date}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(a.acquisition_cost))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(a.book_value))}</DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {(a.books ?? []).map((b) => b.book_code).join(", ") || "—"}
                    </DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={a.status === "active" ? "completed" : a.status === "disposed" ? "cancelled" : "draft"} />
                    </DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        {a.status === "active" && (
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => dispose(a.id)}>
                            Dispose
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
      </ReportSection>

      {selectedAssetId && bookDetail && (
        <ReportSection title="Multi-book detail" subtitle="Per-book NBV and depreciation history">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Book</DataTableHead>
                <DataTableHead>Method</DataTableHead>
                <DataTableHead align="right">Life (mo)</DataTableHead>
                <DataTableHead align="right">Accum depr</DataTableHead>
                <DataTableHead align="right">NBV</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {(bookDetail.books ?? []).length === 0 ? (
                  <DataTableEmpty colSpan={6} message="No book profiles." />
                ) : (
                  (bookDetail.books ?? []).map((b) => (
                    <DataTableRow key={b.book_id}>
                      <DataTableCell>{b.book_code} — {b.book_name}</DataTableCell>
                      <DataTableCell>{b.depr_method.replace(/_/g, " ")}</DataTableCell>
                      <DataTableCell align="right">{b.useful_life_months}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(b.accumulated_depreciation))}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(b.book_value))}</DataTableCell>
                      <DataTableCell>{b.status}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}
    </div>
  );
}
