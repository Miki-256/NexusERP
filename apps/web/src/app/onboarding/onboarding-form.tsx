"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptPendingStaffInvite } from "@/lib/accept-pending-invite";
import { setActiveOrganization } from "@/app/actions/switch-organization";
import { LoadingButton, markSessionBoot } from "@/components/ui/loading";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";
import { completeSessionRedirect } from "@/lib/session-redirect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/layout/auth-shell";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("Main Store");
  const [currency, setCurrency] = useState("ETB");
  const [taxRate, setTaxRate] = useState("15");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    try {
      const orgId = await acceptPendingStaffInvite(supabase);
      if (orgId) {
        await setActiveOrganization(orgId);
        markSessionBoot();
        completeSessionRedirect(POST_AUTH_BOOTSTRAP_PATH);
        return;
      }

      const { data, error: fnError } = await supabase.rpc("create_organization_with_owner", {
        p_name: name,
        p_currency: currency,
        p_tax_rate: parseFloat(taxRate),
        p_store_name: storeName,
        p_register_name: "Register 1",
      });
      if (fnError) throw new Error(fnError.message);
      if (!data) throw new Error("Failed to create organization");

      router.replace("/pending-approval");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Set up your business"
      description="Register your shop. A platform administrator will review and approve it before you can start using Nexus ERP."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Business name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Retail Shop" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="storeName">First store name</Label>
          <Input id="storeName" value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxRate">Default tax %</Label>
            <Input id="taxRate" type="number" min={0} max={100} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} required />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {error?.includes("does not exist") && (
          <p className="text-xs text-muted-foreground">
            Run migrations <code>20260618000021_multi_org_switcher.sql</code> in Supabase SQL Editor.
          </p>
        )}
        <LoadingButton
          type="submit"
          className="w-full shadow-sm"
          loading={loading}
          loadingLabel="Creating…"
        >
          Complete setup
        </LoadingButton>
      </form>
    </AuthShell>
  );
}
