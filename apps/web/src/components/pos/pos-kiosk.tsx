"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  cachePosCatalog,
  cachePosContext,
  cachePosSession,
  getCachedPosCatalog,
  getCachedPosContext,
  getCachedPosSession,
} from "@/lib/offline/pos-cache";
import { isBrowserOnline } from "@/lib/offline/network";
import {
  clearPosSession,
  getStoredPosSession,
  type PosStaffSession,
} from "@/lib/pos-session";
import { LoadingSpinner } from "@/components/ui/loading/loading-spinner";
import { Button } from "@/components/ui/button";
import { PosScreen } from "./pos-screen";
import type { PosCatalogItem } from "./product-card";
import { StaffLogin, type PosStaffOption } from "./staff-login";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import "./pos.css";

type RegisterContext = {
  register_id: string;
  register_name: string;
  store_id: string;
  store_name: string;
  organization_id: string;
  org_name: string;
  currency: string;
  tax_rate: number;
  tax_inclusive: boolean;
  receipt_footer: string | null;
  pos_max_cashier_discount_pct?: number;
  pos_tips_enabled?: boolean;
  pos_tip_presets?: number[];
  pos_loyalty_enabled?: boolean;
  pos_loyalty_points_per?: number;
  pos_loyalty_spend_per_point?: number;
  pos_loyalty_min_redeem_points?: number;
  staff: PosStaffOption[];
};

type OpenSession = {
  id: string;
  opening_float: number;
  opened_at: string;
  active_staff_id: string | null;
  active_staff_name: string | null;
} | null;

/** Public POS entry — loads register data with anon key (no ERP login). */
export function PosKiosk({ registerId }: { registerId: string }) {
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [context, setContext] = useState<RegisterContext | null>(null);
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([]);
  const [catalogTruncated, setCatalogTruncated] = useState(false);
  const [openSession, setOpenSession] = useState<OpenSession>(null);

  const [staffSession, setStaffSession] = useState<PosStaffSession | null>(null);
  const [checkingStaff, setCheckingStaff] = useState(true);

  const loadRegister = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    setOfflineMode(false);

    if (!isBrowserOnline()) {
      const cachedContext = await getCachedPosContext(registerId);
      const cachedCatalog = await getCachedPosCatalog(registerId);
      const cachedSession = await getCachedPosSession(registerId);

      if (cachedContext && cachedCatalog) {
        setContext(cachedContext as RegisterContext);
        setCatalog((cachedCatalog as PosCatalogItem[]).filter((c) => c.variantId));
        setOpenSession(cachedSession as OpenSession);
        setOfflineMode(true);
        setLoadState("ready");
        return;
      }

      setLoadError("No internet and no cached register data. Connect once to load this register.");
      setLoadState("error");
      return;
    }

    const supabase = createClient();

    const { data: bootstrap, error: bootstrapError } = await supabase.rpc("get_pos_bootstrap", {
      p_register_id: registerId,
    });

    if (bootstrapError || !bootstrap) {
      const cachedContext = await getCachedPosContext(registerId);
      const cachedCatalog = await getCachedPosCatalog(registerId);
      const cachedSession = await getCachedPosSession(registerId);

      if (cachedContext && cachedCatalog) {
        setContext(cachedContext as RegisterContext);
        setCatalog((cachedCatalog as PosCatalogItem[]).filter((c) => c.variantId));
        setOpenSession(cachedSession as OpenSession);
        setOfflineMode(true);
        setLoadState("ready");
        return;
      }

      setLoadError(bootstrapError?.message ?? "Register not found");
      setLoadState("error");
      return;
    }

    const boot = bootstrap as RegisterContext & {
      staff: { id: string; display_name: string; role: string }[];
      catalog: PosCatalogItem[];
      catalog_truncated?: boolean;
      pos_loyalty_enabled?: boolean;
      pos_loyalty_points_per?: number;
      pos_loyalty_spend_per_point?: number;
      pos_loyalty_min_redeem_points?: number;
      open_session: OpenSession;
    };

    const nextContext: RegisterContext = {
      register_id: boot.register_id,
      register_name: boot.register_name,
      store_id: boot.store_id,
      store_name: boot.store_name,
      organization_id: boot.organization_id,
      org_name: boot.org_name,
      currency: boot.currency,
      tax_rate: boot.tax_rate,
      tax_inclusive: boot.tax_inclusive,
      receipt_footer: boot.receipt_footer,
      pos_max_cashier_discount_pct: boot.pos_max_cashier_discount_pct,
      pos_tips_enabled: boot.pos_tips_enabled,
      pos_tip_presets: boot.pos_tip_presets,
      pos_loyalty_enabled: boot.pos_loyalty_enabled,
      pos_loyalty_points_per: boot.pos_loyalty_points_per,
      pos_loyalty_spend_per_point: boot.pos_loyalty_spend_per_point,
      pos_loyalty_min_redeem_points: boot.pos_loyalty_min_redeem_points,
      staff: boot.staff.map((s) => ({
        id: s.id,
        display_name: s.display_name,
        role: s.role,
      })),
    };
    const nextCatalog = (boot.catalog ?? []).filter((c) => c.variantId);
    const nextSession = boot.open_session ?? null;

    setContext(nextContext);
    setCatalog(nextCatalog);
    setCatalogTruncated(Boolean(boot.catalog_truncated));
    setOpenSession(nextSession);
    setLoadState("ready");

    void cachePosContext(registerId, nextContext);
    void cachePosCatalog(registerId, nextCatalog);
    if (nextSession) {
      void cachePosSession(registerId, {
        id: nextSession.id,
        opening_float: nextSession.opening_float,
        opened_at: nextSession.opened_at,
      });
    }
  }, [registerId]);

  useEffect(() => {
    loadRegister();
    const id = setInterval(() => {
      if (isBrowserOnline()) void loadRegister();
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, [loadRegister]);

  const validateStoredSession = useCallback(async () => {
    const stored = getStoredPosSession(registerId);
    if (!stored) {
      setStaffSession(null);
      setCheckingStaff(false);
      return;
    }

    if (!isBrowserOnline() || offlineMode) {
      setStaffSession({
        token: stored.token,
        staffId: stored.staffId,
        displayName: stored.displayName,
        role: stored.role,
        organizationId: stored.organizationId,
        registerId: stored.registerId,
      });
      setCheckingStaff(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_pos_staff_session", { p_token: stored.token });

      if (!data) {
        clearPosSession(registerId);
        setStaffSession(null);
      } else {
        const row = data as {
          token: string;
          staff_id: string;
          display_name: string;
          role: string;
          organization_id: string;
          register_id: string;
        };
        if (row.register_id !== registerId) {
          clearPosSession(registerId);
          setStaffSession(null);
        } else {
          setStaffSession({
            token: row.token,
            staffId: row.staff_id,
            displayName: row.display_name,
            role: row.role,
            organizationId: row.organization_id,
            registerId: row.register_id,
          });
        }
      }
    } catch {
      setStaffSession({
        token: stored.token,
        staffId: stored.staffId,
        displayName: stored.displayName,
        role: stored.role,
        organizationId: stored.organizationId,
        registerId: stored.registerId,
      });
    } finally {
      setCheckingStaff(false);
    }
  }, [registerId, offlineMode]);

  useEffect(() => {
    if (loadState === "ready") validateStoredSession();
  }, [loadState, validateStoredSession]);

  function handleSignOut() {
    clearPosSession(registerId);
    setStaffSession(null);
  }

  if (loadState === "loading") {
    return (
      <div className="pos-root pos-shell flex h-full flex-col items-center justify-center gap-3">
        <LoadingSpinner size="lg" className="text-pos-primary" />
        <p className="text-sm font-medium text-slate-500">Loading register…</p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="pos-root pos-shell flex h-full flex-col items-center justify-center gap-4 p-6">
        <div className="pos-card-elevated max-w-md p-8 text-center">
          <h1 className="pos-heading text-xl font-bold text-slate-900">Register unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{loadError}</p>
          <Button className="mt-5 cursor-pointer rounded-xl bg-pos-primary hover:bg-pos-primary-dark" onClick={loadRegister}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!context || checkingStaff) {
    return (
      <div className="pos-root pos-shell flex h-full flex-col items-center justify-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-pos-primary" />
        <p className="text-sm font-medium text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!staffSession) {
    return (
      <StaffLogin
        registerId={registerId}
        registerName={context.register_name}
        storeName={context.store_name}
        orgName={context.org_name}
        staff={context.staff}
        onSuccess={setStaffSession}
      />
    );
  }

  return (
    <PosScreen
      registerId={registerId}
      registerName={context.register_name}
      storeId={context.store_id}
      storeName={context.store_name}
      organizationId={context.organization_id}
      currency={context.currency}
      taxRate={context.tax_rate}
      taxInclusive={context.tax_inclusive}
      orgName={context.org_name}
      receiptFooter={context.receipt_footer}
      catalog={catalog}
      catalogTruncated={catalogTruncated}
      openSession={openSession}
      posStaffSession={staffSession}
      onStaffSignOut={handleSignOut}
      onShiftClosed={() => {
        setOpenSession(null);
        void loadRegister();
      }}
      maxCashierDiscountPct={context.pos_max_cashier_discount_pct ?? 15}
      tipsEnabled={context.pos_tips_enabled ?? false}
      tipPresets={normalizeTipPresets(context.pos_tip_presets)}
      loyaltyEnabled={context.pos_loyalty_enabled ?? false}
      loyaltyPointsPer={context.pos_loyalty_points_per ?? 1}
      loyaltySpendPerPoint={context.pos_loyalty_spend_per_point ?? 0.1}
      loyaltyMinRedeemPoints={context.pos_loyalty_min_redeem_points ?? 100}
    />
  );
}

function normalizeTipPresets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [10, 15, 20];
  const parsed = raw
    .map((v) => (typeof v === "number" ? v : parseFloat(String(v))))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return parsed.length > 0 ? parsed : [10, 15, 20];
}

/** Landing when cashier opens /pos without a register id in the URL. */
export function PosKioskLanding() {
  const router = useRouter();
  const [registerId, setRegisterId] = useState("");

  function openRegister(e: React.FormEvent) {
    e.preventDefault();
    const raw = registerId.trim();
    if (!raw) return;
    const match = raw.match(/\/(?:pos|register)\/([0-9a-f-]{36})/i);
    const id = match ? match[1] : raw;
    router.push(`/pos/${id}`);
  }

  return (
    <main className="pos-root pos-shell flex h-full flex-col items-center justify-center p-6">
      <div className="pos-card-elevated w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-pos-navy text-2xl font-bold text-white shadow-lg">
            N
          </div>
          <h1 className="pos-heading text-2xl font-bold text-slate-900">Point of Sale</h1>
          <p className="mt-2 text-sm text-slate-600">
            Cashiers: open the register link from your manager, or enter the register ID below.
          </p>
        </div>
        <form onSubmit={openRegister} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="register-id" className="font-semibold text-slate-700">Register ID</Label>
            <Input
              id="register-id"
              value={registerId}
              onChange={(e) => setRegisterId(e.target.value)}
              placeholder="Paste register link or ID"
              className="h-12 rounded-xl border-slate-200 bg-white text-slate-900"
            />
          </div>
          <Button type="submit" className="h-14 w-full cursor-pointer rounded-xl bg-pos-primary text-base font-bold text-white hover:bg-pos-primary-dark">
            Open register
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">
          Managers:{" "}
          <a href="/dashboard" className="font-semibold text-pos-primary underline-offset-2 hover:underline">
            open ERP dashboard
          </a>
        </p>
      </div>
    </main>
  );
}
