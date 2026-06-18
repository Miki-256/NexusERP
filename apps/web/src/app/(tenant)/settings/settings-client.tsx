"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Org = {
  id: string;
  name: string;
  currency: string;
  tax_rate: number;
  tax_inclusive: boolean;
  receipt_prefix: string;
  receipt_footer: string | null;
  address: string | null;
  tax_id: string | null;
};

export function SettingsClient({
  organization,
  canManage,
  isOwner,
}: {
  organization: Org;
  canManage: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(organization.name);
  const [taxRate, setTaxRate] = useState(String(organization.tax_rate));
  const [taxInclusive, setTaxInclusive] = useState(organization.tax_inclusive);
  const [receiptPrefix, setReceiptPrefix] = useState(organization.receipt_prefix);
  const [receiptFooter, setReceiptFooter] = useState(
    organization.receipt_footer ?? ""
  );
  const [loading, setLoading] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;
    setLoading(true);
    const supabase = createClient();
    await supabase
      .from("organizations")
      .update({
        name,
        tax_rate: parseFloat(taxRate),
        tax_inclusive: taxInclusive,
        receipt_prefix: receiptPrefix,
        receipt_footer: receiptFooter || null,
      })
      .eq("id", organization.id);
    setLoading(false);
    router.refresh();
  }

  if (!canManage) {
    return (
      <p className="text-muted-foreground">
        You don&apos;t have permission to change settings.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="max-w-md space-y-4">
            <div className="space-y-2">
              <Label>Business name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <div className="space-y-2">
              <Label>Tax rate %</Label>
              <Input
                type="number"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={taxInclusive}
                onChange={(e) => setTaxInclusive(e.target.checked)}
                disabled={!isOwner}
              />
              Prices include tax
            </label>
            <div className="space-y-2">
              <Label>Receipt prefix</Label>
              <Input
                value={receiptPrefix}
                onChange={(e) => setReceiptPrefix(e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <div className="space-y-2">
              <Label>Receipt footer</Label>
              <Input
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Currency: {organization.currency}
            </p>
            {isOwner && (
              <Button type="submit" disabled={loading}>
                {loading ? "Saving…" : "Save"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
