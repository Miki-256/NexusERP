export const PRODUCT_IMPORT_COLUMNS = [
  "name",
  "sku",
  "barcode",
  "sell_price",
  "cost_price",
  "category",
  "quantity",
  "reorder_point",
] as const;

export type ProductImportRow = Record<(typeof PRODUCT_IMPORT_COLUMNS)[number], string>;

export type ProductImportPreviewRow = ProductImportRow & {
  rowNum: number;
  valid: boolean;
  issues: string[];
};

export const PRODUCT_IMPORT_TEMPLATE = `${PRODUCT_IMPORT_COLUMNS.join(",")}
Cotton Shirt,SKU-001,8691234567890,450.00,280.00,Textiles,25,10
Denim Jeans,SKU-002,8691234567891,890.00,520.00,Textiles,15,5`;

export function parseProductCsv(text: string): ProductImportRow[] {
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
  return rows.slice(1).map((cells) => {
    const obj = {} as ProductImportRow;
    for (const col of PRODUCT_IMPORT_COLUMNS) {
      const idx = headers.indexOf(col);
      obj[col] = idx >= 0 ? (cells[idx] ?? "").trim() : "";
    }
    return obj;
  });
}

function parseNonNegative(value: string, label: string, issues: string[], optional = true) {
  if (!value.trim()) return optional ? 0 : null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    issues.push(`${label} must be a number >= 0`);
    return null;
  }
  return n;
}

export function validateProductImportRows(rows: ProductImportRow[]): ProductImportPreviewRow[] {
  return rows.map((row, index) => {
    const issues: string[] = [];
    if (!row.name?.trim()) issues.push("Name is required");
    parseNonNegative(row.sell_price, "Sell price", issues, false);
    parseNonNegative(row.cost_price, "Cost price", issues);
    parseNonNegative(row.quantity, "Quantity", issues);
    parseNonNegative(row.reorder_point, "Reorder point", issues);
    return {
      ...row,
      rowNum: index + 1,
      valid: issues.length === 0,
      issues,
    };
  });
}

export function importRowsToPayload(rows: ProductImportRow[]) {
  return rows.map((row) => ({
    name: row.name.trim(),
    sku: row.sku.trim() || null,
    barcode: row.barcode.trim() || null,
    sell_price: Number(row.sell_price) || 0,
    cost_price: Number(row.cost_price) || 0,
    category: row.category.trim() || null,
    quantity: Number(row.quantity) || 0,
    reorder_point: Number(row.reorder_point) || 0,
  }));
}
