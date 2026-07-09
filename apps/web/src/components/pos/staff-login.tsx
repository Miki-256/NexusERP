"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { storePosSession, type PosStaffSession } from "@/lib/pos-session";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Store, Delete, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import "./pos.css";

export type PosStaffOption = {
  id: string;
  display_name: string;
  role: string;
};

export function StaffLogin({
  registerId,
  registerName,
  storeName,
  orgName,
  staff,
  onSuccess,
}: {
  registerId: string;
  registerName: string;
  storeName: string;
  orgName: string;
  staff: PosStaffOption[];
  onSuccess: (session: PosStaffSession) => void;
}) {
  const [selected, setSelected] = useState<PosStaffOption | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function appendDigit(d: string) {
    if (pin.length >= 6) return;
    setPin((p) => p + d);
    setError(null);
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
    setError(null);
  }

  async function submit() {
    if (!selected || pin.length < 4) {
      setError("Enter at least 4 digits");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("verify_pos_staff_pin", {
      p_register_id: registerId,
      p_staff_id: selected.id,
      p_pin: pin,
    });
    setLoading(false);

    if (rpcError) {
      setError(rpcError.message);
      setPin("");
      return;
    }

    const result = data as {
      token: string;
      staff_id: string;
      display_name: string;
      role: string;
      organization_id: string;
      register_id: string;
    };

    const session: PosStaffSession = {
      token: result.token,
      staffId: result.staff_id,
      displayName: result.display_name,
      role: result.role,
      organizationId: result.organization_id,
      registerId: result.register_id,
    };

    storePosSession(registerId, session);
    onSuccess(session);
  }

  if (staff.length === 0) {
    return (
      <main className="pos-root pos-shell flex h-full flex-col items-center justify-center p-6">
        <div className="pos-card max-w-md p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900">No staff registered</h1>
          <p className="mt-2 text-sm text-slate-600">
            Ask your manager to add POS staff in Team settings.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/dashboard">Manager login</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="pos-root pos-shell flex h-full flex-col overflow-hidden">
      <header className="pos-header flex h-16 shrink-0 items-center justify-between px-5">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-sm font-bold text-white ring-1 ring-white/20">
            N
          </div>
          <div>
            <p className="pos-heading text-base font-semibold text-white">{registerName}</p>
            <p className="flex items-center gap-1.5 text-xs text-white/70">
              <Store className="h-3.5 w-3.5" />
              {storeName}
            </p>
          </div>
        </div>
        <Button asChild variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white">
          <Link href="/dashboard" aria-label="Manager login">
            <LogOut className="mr-1.5 h-4 w-4" aria-hidden />
            Manager
          </Link>
        </Button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-lg">
          <div className="mb-8 text-center">
            <h1 className="pos-heading text-3xl font-bold text-slate-900">{orgName}</h1>
            <p className="mt-2 text-sm font-medium text-slate-500">
              {selected ? `Sign in as ${selected.display_name}` : "Select your name to continue"}
            </p>
          </div>

          {!selected ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3" role="listbox" aria-label="Select staff member">
              {staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-label={`Sign in as ${s.display_name}, ${s.role}`}
                  onClick={() => {
                    setSelected(s);
                    setPin("");
                    setError(null);
                  }}
                  className="pos-staff-card pos-card flex flex-col items-center gap-3 p-5 text-center"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pos-primary-soft text-xl font-bold text-pos-primary">
                    {s.display_name.charAt(0).toUpperCase()}
                  </div>
                  <span className="pos-heading text-sm font-bold text-slate-900">{s.display_name}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{s.role}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="pos-card-elevated mx-auto max-w-xs p-6">
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setPin("");
                  setError(null);
                }}
                className="mb-5 cursor-pointer text-xs font-medium text-slate-500 transition-colors hover:text-slate-800"
              >
                ← Choose another name
              </button>

              <div className="mb-5 flex justify-center gap-2.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-3.5 w-3.5 rounded-full border-2 transition-colors",
                      i < pin.length ? "border-pos-primary bg-pos-primary" : "border-slate-200 bg-white"
                    )}
                  />
                ))}
              </div>

              <PasswordInput
                inputMode="numeric"
                pattern="[0-9]*"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mb-5 rounded-xl text-center text-2xl tracking-[0.5em] text-slate-900"
                placeholder="••••"
                autoFocus
                aria-label="PIN entry"
                toggleLabel="Show PIN"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />

              <div className="mb-5 grid grid-cols-3 gap-2" role="group" aria-label="PIN keypad">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) =>
                  key === "" ? (
                    <div key="spacer" aria-hidden />
                  ) : key === "del" ? (
                    <button
                      key="del"
                      type="button"
                      onClick={backspace}
                      aria-label="Delete last digit"
                      className="pos-pin-key flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary"
                    >
                      <Delete className="h-5 w-5" aria-hidden />
                    </button>
                  ) : (
                    <button
                      key={key}
                      type="button"
                      onClick={() => appendDigit(key)}
                      aria-label={`Digit ${key}`}
                      className="pos-pin-key min-h-11 rounded-xl border border-slate-200 bg-white text-xl font-bold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary"
                    >
                      {key}
                    </button>
                  )
                )}
              </div>

              {error && (
                <p className="mb-4 text-center text-sm font-medium text-red-600" role="alert">
                  {error}
                </p>
              )}

              <Button
                className="h-14 w-full cursor-pointer rounded-xl bg-pos-primary text-base font-bold text-white hover:bg-pos-primary-dark"
                disabled={loading || pin.length < 4}
                aria-busy={loading}
                onClick={submit}
              >
                {loading ? "Signing in…" : "Enter"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
