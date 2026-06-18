"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function OnboardingPage() {
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

    const { data, error: fnError } = await supabase.rpc(
      "create_organization_with_owner",
      {
        p_name: name,
        p_currency: currency,
        p_tax_rate: parseFloat(taxRate),
        p_store_name: storeName,
        p_register_name: "Register 1",
      }
    );

    setLoading(false);
    if (fnError) {
      setError(fnError.message);
      return;
    }

    if (!data) {
      setError("Failed to create organization");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Set up your business</CardTitle>
          <p className="text-sm text-muted-foreground">
            We&apos;ll create your first store and register automatically.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Business name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Retail Shop"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="storeName">First store name</Label>
              <Input
                id="storeName"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxRate">Default tax %</Label>
                <Input
                  id="taxRate"
                  type="number"
                  min={0}
                  max={100}
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  required
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating…" : "Complete setup"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
