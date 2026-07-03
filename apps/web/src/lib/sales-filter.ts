import { relationName } from "@/lib/utils";

export type SaleFilterRow = {
  receipt_no: string | null;
  status: string;
  created_at: string;
  stores: { name: string } | { name: string }[] | null;
};

export function filterSales<T extends SaleFilterRow>(
  sales: T[],
  search: string,
  status: string
): T[] {
  const q = search.trim().toLowerCase();

  return sales.filter((s) => {
    if (status !== "all" && s.status !== status) return false;
    if (!q) return true;

    const receipt = (s.receipt_no ?? "").toLowerCase();
    const store = relationName(s.stores).toLowerCase();
    const saleStatus = s.status.toLowerCase();
    const date = new Date(s.created_at).toLocaleString().toLowerCase();
    const dateShort = new Date(s.created_at).toLocaleDateString().toLowerCase();

    return (
      receipt.includes(q) ||
      store.includes(q) ||
      saleStatus.includes(q) ||
      date.includes(q) ||
      dateShort.includes(q)
    );
  });
}
