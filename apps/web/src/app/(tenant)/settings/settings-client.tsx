"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { FormCard } from "@/components/layout/form-card";
import { PAGE_SHELL } from "@/lib/ui-classes";
import { CreditCard } from "lucide-react";

type Org = {
  id: string;
  name: string;
  currency: string;
  tax_rate: number;
  tax_inclusive: boolean;
  receipt_prefix: string;
  receipt_footer: string | null;
  pos_max_cashier_discount_pct: number;
  pos_auto_post_sales: boolean;
  pos_mobile_pending_webhook: boolean;
  pos_tips_enabled: boolean;
  pos_tip_presets: number[] | string;
  je_requires_approval: boolean;
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
  const { toast } = useToast();
  const [name, setName] = useState(organization.name);
  const [currency, setCurrency] = useState(organization.currency);
  const [taxRate, setTaxRate] = useState(String(organization.tax_rate));
  const [taxInclusive, setTaxInclusive] = useState(organization.tax_inclusive);
  const [receiptPrefix, setReceiptPrefix] = useState(organization.receipt_prefix);
  const [receiptFooter, setReceiptFooter] = useState(organization.receipt_footer ?? "");
  const [maxCashierDiscountPct, setMaxCashierDiscountPct] = useState(
    String(organization.pos_max_cashier_discount_pct ?? 15)
  );
  const [autoPostSales, setAutoPostSales] = useState(organization.pos_auto_post_sales ?? false);
  const [jeRequiresApproval, setJeRequiresApproval] = useState(organization.je_requires_approval ?? false);
  const [mobilePendingWebhook, setMobilePendingWebhook] = useState(
    organization.pos_mobile_pending_webhook ?? true
  );
  const [tipsEnabled, setTipsEnabled] = useState(organization.pos_tips_enabled ?? false);
  const [tipPresetsInput, setTipPresetsInput] = useState(
    formatTipPresetsInput(organization.pos_tip_presets)
  );
  const [loading, setLoading] = useState(false);

  function formatTipPresetsInput(raw: number[] | string | undefined): string {
    if (Array.isArray(raw)) return raw.join(", ");
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String).join(", ");
      } catch {
        return raw;
      }
    }
    return "10, 15, 20";
  }

  function parseTipPresetsInput(raw: string): number[] {
    const parts = raw
      .split(/[,;\s]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
    return parts.length > 0 ? parts : [10, 15, 20];
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;

    const normalizedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      toast({
        title: "Invalid currency",
        description: "Use a 3-letter ISO code (e.g. ETB, USD, EUR).",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const parsedMaxDiscount = parseFloat(maxCashierDiscountPct);
    if (!Number.isFinite(parsedMaxDiscount) || parsedMaxDiscount < 0 || parsedMaxDiscount > 100) {
      setLoading(false);
      toast({
        title: "Invalid discount limit",
        description: "Max cashier discount must be between 0 and 100.",
        variant: "destructive",
      });
      return;
    }
    const { error } = await supabase.from("organizations").update({
      name,
      currency: normalizedCurrency,
      tax_rate: parseFloat(taxRate),
      tax_inclusive: taxInclusive,
      receipt_prefix: receiptPrefix,
      receipt_footer: receiptFooter || null,
      pos_max_cashier_discount_pct: parsedMaxDiscount,
      pos_auto_post_sales: autoPostSales,
      je_requires_approval: jeRequiresApproval,
      pos_mobile_pending_webhook: mobilePendingWebhook,
      pos_tips_enabled: tipsEnabled,
      pos_tip_presets: parseTipPresetsInput(tipPresetsInput),
    }).eq("id", organization.id);
    setLoading(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    toast({ title: "Settings saved" });
    router.refresh();
  }

  if (!canManage) {
    return <p className="text-muted-foreground">You don&apos;t have permission to change settings.</p>;
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title="Settings" description="Organization profile, tax, and receipt preferences" />

      <FormCard title="Subscription">
        <p className="mb-4 text-sm text-muted-foreground">
          View your plan tier, usage limits, and upgrade options.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/billing">
            <CreditCard className="mr-1.5 h-4 w-4" />
            Billing &amp; plan
          </Link>
        </Button>
      </FormCard>

      <FormCard title="Organization">
        <form onSubmit={handleSave} className="max-w-lg space-y-4">
          <div className="space-y-2"><Label>Business name</Label><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} /></div>
          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <Input
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
              maxLength={3}
              placeholder="ETB"
              disabled={!isOwner}
              className="max-w-[8rem] uppercase"
            />
            <p className="text-xs text-muted-foreground">
              3-letter code used across POS, sales, products, and reports. Existing amounts are not converted.
            </p>
          </div>
          <div className="space-y-2"><Label>Tax rate %</Label><Input type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} disabled={!isOwner} /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} disabled={!isOwner} className="rounded border-input" />
            Prices include tax
          </label>
          <div className="space-y-2"><Label>Receipt prefix</Label><Input value={receiptPrefix} onChange={(e) => setReceiptPrefix(e.target.value)} disabled={!isOwner} /></div>
          <div className="space-y-2"><Label>Receipt footer</Label><Input value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} disabled={!isOwner} /></div>
          <div className="space-y-2">
            <Label htmlFor="pos-max-discount">Max cashier discount %</Label>
            <Input
              id="pos-max-discount"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={maxCashierDiscountPct}
              onChange={(e) => setMaxCashierDiscountPct(e.target.value)}
              disabled={!isOwner}
              className="max-w-[8rem]"
            />
            <p className="text-xs text-muted-foreground">
              Cashiers must enter a manager PIN when cart or line discounts exceed this percentage.
            </p>
          </div>
          {isOwner && <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save changes"}</Button>}
        </form>
      </FormCard>

      <FormCard title="Accounting controls">
        <form onSubmit={handleSave} className="max-w-lg space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={jeRequiresApproval}
              onChange={(e) => setJeRequiresApproval(e.target.checked)}
              disabled={!isOwner}
              className="mt-0.5 rounded border-input"
            />
            <span>
              <span className="font-medium">Require approval for manual journal entries</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                When enabled, manual entries are saved as drafts until a manager approves them from
                Financials → Manual JE. System postings (sales, refunds, period close) are not affected.
              </span>
            </span>
          </label>
          {isOwner && (
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save accounting settings"}
            </Button>
          )}
        </form>
      </FormCard>

      <FormCard title="POS operations">
        <form onSubmit={handleSave} className="max-w-lg space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoPostSales}
              onChange={(e) => setAutoPostSales(e.target.checked)}
              disabled={!isOwner}
              className="mt-0.5 rounded border-input"
            />
            <span>
              <span className="font-medium">Auto-post sales to ledger</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Recommended for businesses using Financial Statements and trial balance. Each completed
                sale posts Dr cash/AR/store-credit liability, Cr revenue and tax, plus COGS — skipped while
                mobile payments are pending confirmation. You can also batch-post historical sales from
                Financials.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={mobilePendingWebhook}
              onChange={(e) => setMobilePendingWebhook(e.target.checked)}
              disabled={!isOwner}
              className="mt-0.5 rounded border-input"
            />
            <span>
              <span className="font-medium">Mobile money pending until webhook</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                When a Telebirr/M-Pesa reference is entered at checkout, mark payment pending until the provider webhook confirms it.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={tipsEnabled}
              onChange={(e) => setTipsEnabled(e.target.checked)}
              disabled={!isOwner}
              className="mt-0.5 rounded border-input"
            />
            <span>
              <span className="font-medium">Enable tips at checkout</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                At cash checkout, enter cash received and change given — any leftover after the order
                total and change is recorded as tip (e.g. order 143, received 150, change 5 → tip 2).
              </span>
            </span>
          </label>
          {tipsEnabled && (
            <div className="space-y-2">
              <Label htmlFor="tip-presets">Tip preset percentages</Label>
              <Input
                id="tip-presets"
                value={tipPresetsInput}
                onChange={(e) => setTipPresetsInput(e.target.value)}
                disabled={!isOwner}
                placeholder="10, 15, 20"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated percentages shown as quick-select buttons at checkout.
              </p>
            </div>
          )}
          {isOwner && (
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save POS settings"}
            </Button>
          )}
        </form>
      </FormCard>
    </div>
  );
}
