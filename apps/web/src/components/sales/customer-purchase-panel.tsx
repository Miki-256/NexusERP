"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

type Purchase = {
  sale_id: string;
  receipt_no: string;
  total: number;
  status: string;
  store_name: string | null;
  created_at: string;
};

export function CustomerPurchasePanel({
  customerId,
  currency,
}: {
  customerId: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  useEffect(() => {
    if (!open || purchases.length > 0) return;
    setLoading(true);
    const supabase = createClient();
    void supabase
      .rpc("list_customer_purchases", { p_customer_id: customerId, p_limit: 20 })
      .then(({ data }) => {
        setPurchases((data as Purchase[]) ?? []);
        setLoading(false);
      });
  }, [open, customerId, purchases.length]);

  const money = (n: number) => formatCurrency(n, currency);

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Purchase history
      </Button>
      {open && (
        <div className="mt-2 rounded-lg border bg-muted/30 p-2">
          {loading ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
          ) : purchases.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No completed purchases yet.</p>
          ) : (
            <ul className="divide-y">
              {purchases.map((p) => (
                <li key={p.sale_id} className="flex items-center justify-between gap-2 px-2 py-2 text-xs">
                  <div>
                    <Link href={`/sales/${p.sale_id}`} className="font-medium text-primary hover:underline">
                      {p.receipt_no}
                    </Link>
                    <p className="text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString()} · {p.store_name ?? "Store"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{money(p.total)}</span>
                    <Link href={`/sales/${p.sale_id}`}>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
