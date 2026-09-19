"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportCsv, type CsvColumn } from "@/lib/csv-export";

export function ExportCsvButton<T extends Record<string, unknown>>({
  filename,
  rows,
  columns,
  label = "Export CSV",
  disabled,
  loadRows,
}: {
  filename: string;
  rows?: T[];
  columns: CsvColumn<T>[];
  label?: string;
  disabled?: boolean;
  /** Lazy-load rows on click (e.g. heavy nested sale_lines export). */
  loadRows?: () => Promise<T[]>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9 gap-1.5"
      disabled={disabled || busy || (!loadRows && (rows?.length ?? 0) === 0)}
      onClick={() => {
        void (async () => {
          setBusy(true);
          try {
            const data = loadRows ? await loadRows() : (rows ?? []);
            if (data.length === 0) return;
            exportCsv(filename, data, columns);
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <Download className="h-3.5 w-3.5" />
      {busy ? "…" : label}
    </Button>
  );
}
