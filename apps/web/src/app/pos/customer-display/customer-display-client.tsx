"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  customerDisplayChannel,
  type CustomerDisplayPayload,
  type CustomerDisplayPhase,
} from "@/lib/pos/customer-display";
import { CheckCircle2, Loader2, Smartphone } from "lucide-react";
import "@/components/pos/pos.css";

function phaseLabel(phase: CustomerDisplayPhase): string {
  switch (phase) {
    case "checkout":
      return "Review your order";
    case "paying":
      return "Processing payment…";
    case "paid":
      return "Thank you!";
    case "pending_payment":
      return "Confirming payment…";
    default:
      return "Your order";
  }
}

export function CustomerDisplayClient() {
  const params = useSearchParams();
  const registerId = params.get("register") ?? "";
  const [payload, setPayload] = useState<CustomerDisplayPayload | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!registerId || !("BroadcastChannel" in window)) return;
    const ch = new BroadcastChannel(customerDisplayChannel(registerId));
    ch.onmessage = (ev: MessageEvent<CustomerDisplayPayload>) => {
      setPayload(ev.data);
      if (ev.data.paymentStatus === "confirmed") setPaymentConfirmed(true);
      if (ev.data.phase === "cart") {
        setPaymentConfirmed(false);
      }
    };
    return () => ch.close();
  }, [registerId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !payload?.lines.length) return;
    if (payload.phase === "cart" || payload.phase === "checkout") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [payload?.lines.length, payload?.updatedAt, payload?.phase]);

  useEffect(() => {
    if (!payload?.saleId || payload.paymentStatus !== "pending") return;

    const supabase = createClient();
    const id = window.setInterval(() => {
      void supabase
        .rpc("get_pos_sale_receipt", {
          p_sale_id: payload.saleId!,
          p_session_token: payload.sessionToken ?? null,
        })
        .then(({ data }) => {
          if (!data) return;
          const row = data as {
            payments?: { method: string; status?: string; webhook_confirmed_at?: string | null }[];
          };
          const pending = row.payments?.some(
            (p) =>
              p.method === "mobile_money" &&
              p.status === "pending" &&
              !p.webhook_confirmed_at
          );
          if (!pending) setPaymentConfirmed(true);
        });
    }, 5000);

    return () => clearInterval(id);
  }, [payload?.saleId, payload?.sessionToken, payload?.paymentStatus]);

  if (!registerId) {
    return (
      <main className="pos-root flex h-full items-center justify-center bg-slate-900 p-8 text-white">
        <p>Missing register ID. Open from POS → Tools → Customer display.</p>
      </main>
    );
  }

  const lines = payload?.lines ?? [];
  const total = payload?.total ?? 0;
  const currency = payload?.currency ?? "ETB";
  const phase = payload?.phase ?? "cart";
  const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);
  const showBreakdown = phase === "checkout" || phase === "paying" || phase === "paid" || phase === "pending_payment";
  const isPaidScreen = phase === "paid" || phase === "pending_payment";
  const awaitingConfirm =
    phase === "pending_payment" || (phase === "paid" && payload?.paymentStatus === "pending" && !paymentConfirmed);

  return (
    <main className="pos-root flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      <header className="shrink-0 border-b border-white/10 px-6 py-4 text-center sm:px-8">
        <p className="text-sm uppercase tracking-widest text-white/60">
          {payload?.orgName ?? "Nexus POS"}
        </p>
        <p className="text-lg text-white/80">{payload?.storeName ?? "Customer display"}</p>
        {lines.length > 0 && !isPaidScreen && (
          <p className="mt-1 text-xs text-white/50">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </p>
        )}
        {phase !== "cart" && (
          <p className="mt-2 text-sm font-semibold text-emerald-300">{phaseLabel(phase)}</p>
        )}
      </header>

      {isPaidScreen ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-8 text-center">
          {awaitingConfirm ? (
            <>
              <Loader2 className="mb-4 h-16 w-16 animate-spin text-amber-400" />
              <p className="text-2xl font-bold">Confirming payment</p>
              <p className="mt-2 max-w-sm text-white/60">
                Please wait while we verify your mobile money payment.
              </p>
              <div className="mt-6 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3">
                <Smartphone className="h-5 w-5 text-amber-300" />
                <span className="text-lg font-bold tabular-nums">{formatCurrency(total, currency)}</span>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 className="mb-4 h-16 w-16 text-emerald-400" />
              <p className="text-3xl font-bold">Thank you!</p>
              {payload?.receiptNo && (
                <p className="mt-2 text-sm text-white/50">Receipt #{payload.receiptNo}</p>
              )}
              {(payload?.changeDue ?? 0) > 0 && (
                <div className="mt-8 rounded-2xl bg-emerald-500/20 px-8 py-6 ring-1 ring-emerald-400/30">
                  <p className="text-sm uppercase tracking-wider text-emerald-200">Your change</p>
                  <p className="pos-heading mt-2 text-5xl font-bold tabular-nums text-emerald-300">
                    {formatCurrency(payload!.changeDue!, currency)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 sm:px-8"
          >
            {lines.length === 0 ? (
              <p className="flex h-full items-center justify-center text-center text-xl text-white/50">
                Welcome — your items will appear here
              </p>
            ) : (
              <ul className="mx-auto max-w-lg space-y-2 pb-2">
                {lines.map((l, i) => (
                  <li
                    key={`${l.name}-${i}`}
                    className="flex items-start justify-between gap-4 border-b border-white/10 pb-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold leading-snug">{l.name}</p>
                      <p className="text-sm text-white/60">Qty {l.qty}</p>
                    </div>
                    <p className="shrink-0 text-base font-bold tabular-nums">
                      {formatCurrency(l.total, currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="shrink-0 border-t border-white/10 bg-slate-900/80 px-6 py-5 backdrop-blur-sm sm:px-8">
            {showBreakdown && lines.length > 0 && (
              <div className="mx-auto mb-4 max-w-lg space-y-1 text-sm text-white/70">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(payload?.subtotal ?? 0, currency)}</span>
                </div>
                {(payload?.tax ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span className="tabular-nums">{formatCurrency(payload!.tax, currency)}</span>
                  </div>
                )}
                {(payload?.discount ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-300">
                    <span>Discount</span>
                    <span className="tabular-nums">−{formatCurrency(payload!.discount, currency)}</span>
                  </div>
                )}
                {(payload?.promoDiscount ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-300">
                    <span>Promotion</span>
                    <span className="tabular-nums">−{formatCurrency(payload!.promoDiscount, currency)}</span>
                  </div>
                )}
                {(payload?.tipAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-amber-200">
                    <span>Tip</span>
                    <span className="tabular-nums">+{formatCurrency(payload!.tipAmount!, currency)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="text-center">
              <p className="text-sm uppercase tracking-wider text-white/60">
                {phase === "paying" ? "Amount" : "Total due"}
              </p>
              <p className="pos-heading mt-1 text-4xl font-bold tabular-nums sm:text-5xl">
                {formatCurrency(total, currency)}
              </p>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
