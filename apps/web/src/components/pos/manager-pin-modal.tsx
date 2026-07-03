"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, X } from "lucide-react";

export function ManagerPinModal({
  registerId,
  title,
  description,
  onApproved,
  onClose,
}: {
  registerId: string;
  title: string;
  description: string;
  onApproved: (pin: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("verify_pos_manager_pin", {
      p_register_id: registerId,
      p_pin: pin,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const result = data as { approved?: boolean; reason?: string };
    if (!result.approved) {
      setError(result.reason ?? "Manager PIN required");
      return;
    }
    onApproved(pin);
  }

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-pos-primary" />
            <h2 className="pos-heading text-lg font-bold text-slate-900">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-600">{description}</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mgr-pin">Manager PIN</Label>
            <Input
              id="mgr-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="h-12 text-center text-lg tracking-widest"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="h-11 w-full cursor-pointer bg-pos-primary hover:bg-pos-primary-dark" disabled={loading}>
            {loading ? "Verifying…" : "Approve override"}
          </Button>
        </form>
      </div>
    </div>
  );
}
