export type ScheduledReportData = {
  org_name?: string;
  report_type: string;
  report_date?: string;
  period_from?: string;
  period_to?: string;
  summary?: Record<string, unknown>;
  rows?: Record<string, unknown>[];
};

export type ReportExportResult = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  filename: string;
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function summaryLines(data: ScheduledReportData): string[] {
  const lines: string[] = [`Organization,${csvEscape(data.org_name ?? "")}`, `Report,${csvEscape(data.report_type)}`];
  if (data.report_date) lines.push(`Date,${csvEscape(data.report_date)}`);
  if (data.period_from && data.period_to) {
    lines.push(`Period,${csvEscape(`${data.period_from} to ${data.period_to}`)}`);
  }
  if (data.summary) {
    for (const [k, v] of Object.entries(data.summary)) {
      lines.push(`${csvEscape(k)},${csvEscape(v)}`);
    }
  }
  return lines;
}

export function exportReportCsv(data: ScheduledReportData): ReportExportResult {
  const rows = data.rows ?? [];
  const lines = [...summaryLines(data), ""];
  if (rows.length > 0) {
    const keys = Object.keys(rows[0] ?? {});
    lines.push(keys.map(csvEscape).join(","));
    for (const row of rows) {
      lines.push(keys.map((k) => csvEscape(row[k])).join(","));
    }
  }
  const buffer = Buffer.from(lines.join("\n"), "utf8");
  const base = slug(data.report_type);
  return {
    buffer,
    mimeType: "text/csv",
    extension: "csv",
    filename: `${base}-${data.report_date ?? data.period_to ?? "report"}.csv`,
  };
}

export async function exportReportXlsx(data: ScheduledReportData): Promise<ReportExportResult> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");

  ws.addRow(["Organization", data.org_name ?? ""]);
  ws.addRow(["Report", data.report_type]);
  if (data.report_date) ws.addRow(["Date", data.report_date]);
  if (data.period_from) ws.addRow(["Period", `${data.period_from} – ${data.period_to}`]);
  if (data.summary) {
    ws.addRow([]);
    ws.addRow(["Summary"]);
    for (const [k, v] of Object.entries(data.summary)) {
      ws.addRow([k, v]);
    }
  }

  const rows = data.rows ?? [];
  if (rows.length > 0) {
    ws.addRow([]);
    const keys = Object.keys(rows[0] ?? {});
    ws.addRow(keys);
    for (const row of rows) {
      ws.addRow(keys.map((k) => row[k]));
    }
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const base = slug(data.report_type);
  return {
    buffer,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    filename: `${base}-${data.report_date ?? data.period_to ?? "report"}.xlsx`,
  };
}

export async function exportReportPdf(data: ScheduledReportData): Promise<ReportExportResult> {
  const React = await import("react");
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { ScheduledReportPdf } = await import("./report-pdf");
  const element = React.createElement(ScheduledReportPdf, { data });
  const buffer = await renderToBuffer(
    element as Parameters<typeof renderToBuffer>[0]
  );
  const base = slug(data.report_type);
  return {
    buffer: Buffer.from(buffer),
    mimeType: "application/pdf",
    extension: "pdf",
    filename: `${base}-${data.report_date ?? data.period_to ?? "report"}.pdf`,
  };
}

export async function exportScheduledReport(
  format: string,
  data: ScheduledReportData
): Promise<ReportExportResult> {
  if (format === "xlsx") return exportReportXlsx(data);
  if (format === "pdf") return exportReportPdf(data);
  return exportReportCsv(data);
}

export function buildReportSummaryText(data: ScheduledReportData, downloadUrl?: string): string {
  const lines: string[] = [
    `${data.org_name ?? "Organization"} — ${data.report_type}`,
  ];
  if (data.report_date) lines.push(`Date: ${data.report_date}`);
  if (data.period_from && data.period_to) lines.push(`Period: ${data.period_from} → ${data.period_to}`);
  if (data.summary) {
    for (const [k, v] of Object.entries(data.summary)) {
      lines.push(`${k}: ${v}`);
    }
  }
  if ((data.rows?.length ?? 0) > 0) {
    lines.push(`${data.rows!.length} row(s) in attached export.`);
  }
  if (downloadUrl) {
    lines.push(`Download: ${downloadUrl}`);
  }
  return lines.join("\n");
}
