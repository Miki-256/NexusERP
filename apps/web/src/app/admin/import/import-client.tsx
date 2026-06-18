"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminOrg } from "../page";

type Kind = "customers" | "products";

const selectCls = "flex h-10 w-full rounded-md border px-3 text-sm";

const FORMATS: Record<Kind, string> = {
  customers: "name,phone,email,address,notes",
  products: "name,sku,barcode,sell_price,cost_price,category,quantity",
};

// Minimal CSV parser supporting quoted fields and escaped quotes.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
}

export function ImportClient({ orgs }: { orgs: AdminOrg[] }) {
  const [orgId, setOrgId] = useState("");
  const [kind, setKind] = useState<Kind>("customers");
  const [storeId, setStoreId] = useState("");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orgId) {
      setStores([]);
      setStoreId("");
      return;
    }
    const supabase = createClient();
    supabase.rpc("admin_list_stores", { p_org_id: orgId }).then(({ data }) => {
      setStores((data as { id: string; name: string }[]) ?? []);
    });
  }, [orgId]);

  async function runImport() {
    setError("");
    setResult("");
    if (!orgId) return setError("Select an organization");
    const rows = parseCsv(csv);
    if (rows.length === 0) return setError("No rows parsed. Include a header row.");

    setBusy(true);
    const supabase = createClient();
    const res =
      kind === "customers"
        ? await supabase.rpc("admin_import_customers", { p_org_id: orgId, p_rows: rows })
        : await supabase.rpc("admin_import_products", {
            p_org_id: orgId,
            p_rows: rows,
            p_store_id: storeId || null,
          });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    const data = res.data as { imported: number; skipped: number } | null;
    setResult(`Imported ${data?.imported ?? 0}, skipped ${data?.skipped ?? 0} (duplicates).`);
    setCsv("");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Data Import</h1>
      <p className="text-sm text-muted-foreground">
        Migrate legacy data (e.g. a Base44 CSV export) into an organization. Paste CSV with a
        header row matching the expected columns.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Import</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Organization</Label>
              <select className={selectCls} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">— Select —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Data Type</Label>
              <select
                className={selectCls}
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                <option value="customers">Customers</option>
                <option value="products">Products</option>
              </select>
            </div>
            {kind === "products" && (
              <div className="space-y-2">
                <Label>Stock to Store (optional)</Label>
                <select className={selectCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  <option value="">— No stock —</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>
              CSV Data{" "}
              <span className="font-normal text-muted-foreground">
                — columns: {FORMATS[kind]}
              </span>
            </Label>
            <textarea
              className="h-56 w-full rounded-md border p-3 font-mono text-xs"
              placeholder={FORMATS[kind] + "\n..."}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && <p className="text-sm text-emerald-600">{result}</p>}

          <Button onClick={runImport} disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
