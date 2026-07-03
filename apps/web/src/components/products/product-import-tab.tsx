"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { SELECT_CLS } from "@/lib/ui-classes";
import { downloadCsv, exportCsv } from "@/lib/csv-export";
import {
  importRowsToPayload,
  parseProductCsv,
  PRODUCT_IMPORT_TEMPLATE,
  validateProductImportRows,
  type ProductImportPreviewRow,
} from "@/lib/products/csv-import";
import { Download, FileUp, Upload } from "lucide-react";

type ImportMode = "skip" | "update";

export function ProductImportTab({
  organizationId,
  stores,
  products,
  currency,
}: {
  organizationId: string;
  stores: { id: string; name: string }[];
  products: {
    name: string;
    sku: string | null;
    barcode: string | null;
    sell_price: number;
    cost_price: number;
    reorder_point?: number;
    categories: { name: string } | null;
  }[];
  currency: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [mode, setMode] = useState<ImportMode>("skip");
  const [preview, setPreview] = useState<ProductImportPreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const validCount = useMemo(() => preview?.filter((r) => r.valid).length ?? 0, [preview]);
  const invalidCount = useMemo(() => preview?.filter((r) => !r.valid).length ?? 0, [preview]);

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rows = parseProductCsv(text);
      if (rows.length === 0) {
        toast({ title: "No rows found", description: "Include a header row and at least one product.", variant: "destructive" });
        return;
      }
      setPreview(validateProductImportRows(rows));
      setResult(null);
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    downloadCsv("product-import-template.csv", PRODUCT_IMPORT_TEMPLATE);
  }

  function exportCatalog() {
    exportCsv("products-export.csv", products, [
      { key: "name", label: "name" },
      { key: "sku", label: "sku", format: (v) => (v == null ? "" : String(v)) },
      { key: "barcode", label: "barcode", format: (v) => (v == null ? "" : String(v)) },
      { key: "sell_price", label: "sell_price" },
      { key: "cost_price", label: "cost_price" },
      {
        key: "categories",
        label: "category",
        format: (v) => (v && typeof v === "object" && "name" in v ? String((v as { name: string }).name) : ""),
      },
      { key: "reorder_point", label: "reorder_point", format: (v) => String(v ?? 0) },
    ]);
  }

  async function runImport() {
    if (!preview?.length) return;
    const validRows = preview.filter((r) => r.valid);
    if (validRows.length === 0) {
      toast({ title: "Nothing to import", description: "Fix validation errors first.", variant: "destructive" });
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("import_products", {
      p_org_id: organizationId,
      p_rows: importRowsToPayload(validRows),
      p_store_id: storeId || null,
      p_mode: mode,
    });
    setBusy(false);

    if (error) {
      toast({
        title: "Import failed",
        description: error.message.includes("Could not find the function")
          ? "Apply migration 20260618000050_product_bulk_barcode.sql in Supabase."
          : error.message,
        variant: "destructive",
      });
      return;
    }

    const payload = (data ?? {}) as {
      imported?: number;
      updated?: number;
      skipped?: number;
      errors?: { row: number; reason: string }[];
    };

    const errCount = payload.errors?.length ?? 0;
    setResult(
      `Imported ${payload.imported ?? 0}, updated ${payload.updated ?? 0}, skipped ${payload.skipped ?? 0}` +
        (errCount > 0 ? `, ${errCount} row error(s).` : ".")
    );
    toast({ title: "Import complete", description: "Catalog updated." });
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <FormCard
        title="Bulk import"
        description="Upload a CSV to create many products at once. Use Export catalog to download your current list, edit in Excel, and re-import."
      >
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download template
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={exportCatalog} disabled={products.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export catalog ({products.length})
          </Button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="importStore">Opening stock store</Label>
            <select
              id="importStore"
              className={SELECT_CLS}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="">No stock update</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="importMode">Duplicate handling</Label>
            <select
              id="importMode"
              className={SELECT_CLS}
              value={mode}
              onChange={(e) => setMode(e.target.value as ImportMode)}
            >
              <option value="skip">Skip duplicates (by SKU, barcode, or name)</option>
              <option value="update">Update duplicates (prices, category, add stock)</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <Label htmlFor="importFile">CSV file</Label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              id="importFile"
              type="file"
              accept=".csv,text/csv"
              className="block max-w-full text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadFile(file);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!preview || validCount === 0 || busy}
              onClick={runImport}
            >
              <Upload className="mr-2 h-4 w-4" />
              {busy ? "Importing…" : `Import ${validCount} product${validCount === 1 ? "" : "s"}`}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Columns: name, sku, barcode, sell_price, cost_price, category, quantity, reorder_point. Prices in {currency}.
          </p>
        </div>

        {result && <p className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-sm">{result}</p>}
      </FormCard>

      {preview && (
        <FormCard
          title="Preview"
          description={`${validCount} valid · ${invalidCount} with issues · max 5,000 rows per import`}
        >
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Barcode</th>
                  <th className="px-3 py-2">Sell</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 200).map((row) => (
                  <tr key={row.rowNum} className="border-t">
                    <td className="px-3 py-2 text-muted-foreground">{row.rowNum}</td>
                    <td className="px-3 py-2">{row.name || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.barcode || "—"}</td>
                    <td className="px-3 py-2">{row.sell_price || "—"}</td>
                    <td className="px-3 py-2">{row.quantity || "0"}</td>
                    <td className="px-3 py-2">
                      {row.valid ? (
                        <span className="text-success">OK</span>
                      ) : (
                        <span className="text-destructive">{row.issues.join("; ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 200 && (
            <p className="mt-2 text-xs text-muted-foreground">Showing first 200 of {preview.length} rows.</p>
          )}
        </FormCard>
      )}

      {!preview && (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <FileUp className="h-8 w-8 shrink-0 opacity-40" />
          <p>Choose a CSV file to preview before importing. Existing products can be exported, edited offline, and re-imported with update mode.</p>
        </div>
      )}
    </div>
  );
}
