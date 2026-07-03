"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportCsv, type CsvColumn } from "@/lib/csv-export";

export function ExportCsvButton<T extends Record<string, unknown>>({
  filename,
  rows,
  columns,
  label = "Export CSV",
  disabled,
}: {
  filename: string;
  rows: T[];
  columns: CsvColumn<T>[];
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9 gap-1.5"
      disabled={disabled || rows.length === 0}
      onClick={() => exportCsv(filename, rows, columns)}
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}
