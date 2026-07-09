"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, User, X, Gift, Clock, Heart } from "lucide-react";
import { usePosModal } from "./use-pos-modal";

export type PosCustomer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  creditBalance: number;
  receivableBalance: number;
  creditLimit: number | null;
  onAccountEnabled: boolean;
  creditAvailable: number | null;
  loyaltyPoints: number;
};

export function CustomerLookupModal({
  registerId,
  currency,
  sessionToken,
  onSelect,
  onClose,
}: {
  registerId: string;
  currency: string;
  sessionToken?: string;
  onSelect: (customer: PosCustomer) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_pos_customers", {
      p_register_id: registerId,
      p_query: query.trim(),
      p_session_token: sessionToken ?? null,
      p_limit: 25,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const rows = (data as PosCustomer[] | null) ?? [];
    setResults(rows);
  }, [registerId, query, sessionToken]);

  useEffect(() => {
    const t = setTimeout(() => void search(), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, search]);

  const panelRef = usePosModal(onClose);

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-customer-lookup-title"
        className="pos-modal-panel flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="pos-header flex items-center justify-between px-5 py-4">
          <div>
            <h2 id="pos-customer-lookup-title" className="pos-heading text-lg font-bold text-white">
              Find customer
            </h2>
            <p className="text-xs text-white/70">Search by name, phone, or email</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Close customer lookup"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="border-b border-slate-100 p-4">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
            <span className="sr-only">Search customers</span>
            <Search className="h-4 w-4 text-slate-400" aria-hidden />
            <Input
              autoFocus
              id="pos-customer-search"
              placeholder="Start typing…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
              aria-busy={loading}
            />
          </label>
        </div>
        <ul className="flex-1 overflow-y-auto p-2" aria-live="polite">
          {loading && (
            <li className="p-4 text-center text-sm text-slate-500" role="status">
              Searching…
            </li>
          )}
          {error && <li className="p-4 text-sm text-red-600">{error}</li>}
          {!loading && !error && results.length === 0 && (
            <li className="p-8 text-center text-sm text-slate-500">No customers found</li>
          )}
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                  <User className="h-5 w-5 text-slate-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{c.name}</p>
                  <p className="truncate text-xs text-slate-500">{c.phone || c.email || "—"}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {c.creditBalance > 0 && (
                    <span className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                      <Gift className="h-3 w-3" />
                      {formatCurrency(c.creditBalance, currency)}
                    </span>
                  )}
                  {c.loyaltyPoints > 0 && (
                    <span className="flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">
                      <Heart className="h-3 w-3" />
                      {c.loyaltyPoints} pts
                    </span>
                  )}
                  {c.onAccountEnabled && (
                    <span className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                      <Clock className="h-3 w-3" />
                      {c.receivableBalance > 0
                        ? `Owes ${formatCurrency(c.receivableBalance, currency)}`
                        : c.creditAvailable != null
                          ? `${formatCurrency(c.creditAvailable, currency)} left`
                          : "Pay later OK"}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 p-4">
          <Button variant="outline" className="w-full cursor-pointer" onClick={onClose}>
            Cancel (Esc)
          </Button>
        </div>
      </div>
    </div>
  );
}
