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
import { Panel } from "@/components/layout/panel";
import { PAGE_SHELL } from "@/lib/ui-classes";
import { CreditCard } from "lucide-react";
import { useTranslations } from "next-intl";
import { applyLocaleCookie } from "@/components/i18n/language-switcher";
import { isAppLocale, type AppLocale } from "@/i18n/config";
import { SELECT_CLS } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

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
  pos_loyalty_enabled: boolean;
  pos_loyalty_points_per: number;
  pos_loyalty_spend_per_point: number;
  pos_loyalty_min_redeem_points: number;
  je_requires_approval: boolean;
  address: string | null;
  tax_id: string | null;
  default_locale?: string;
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
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(organization.name);
  const [currency, setCurrency] = useState(organization.currency);
  const [locale, setLocale] = useState<AppLocale>(
    isAppLocale(organization.default_locale) ? organization.default_locale : "en"
  );
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
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(organization.pos_loyalty_enabled ?? false);
  const [loyaltyPointsPer, setLoyaltyPointsPer] = useState(String(organization.pos_loyalty_points_per ?? 1));
  const [loyaltySpendPerPoint, setLoyaltySpendPerPoint] = useState(
    String(organization.pos_loyalty_spend_per_point ?? 0.1)
  );
  const [loyaltyMinRedeem, setLoyaltyMinRedeem] = useState(
    String(organization.pos_loyalty_min_redeem_points ?? 100)
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
        title: t("invalidCurrency"),
        description: t("invalidCurrencyHelp"),
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
        title: t("invalidDiscount"),
        description: t("invalidDiscountHelp"),
        variant: "destructive",
      });
      return;
    }
    const wasAutoPost = organization.pos_auto_post_sales ?? false;
    const { error } = await supabase.from("organizations").update({
      name,
      currency: normalizedCurrency,
      default_locale: locale,
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
      pos_loyalty_enabled: loyaltyEnabled,
      pos_loyalty_points_per: parseFloat(loyaltyPointsPer) || 1,
      pos_loyalty_spend_per_point: parseFloat(loyaltySpendPerPoint) || 0.1,
      pos_loyalty_min_redeem_points: parseInt(loyaltyMinRedeem, 10) || 100,
    }).eq("id", organization.id);
    if (error) {
      setLoading(false);
      return toast({ title: t("saveFailed"), description: error.message, variant: "destructive" });
    }

    let backfillNote = "";
    if (!wasAutoPost && autoPostSales) {
      const { data: batch, error: batchError } = await supabase.rpc("post_unposted_sales_batch", {
        p_org_id: organization.id,
        p_limit: 500,
      });
      if (batchError) {
        backfillNote = t("backfillFailed", { message: batchError.message });
      } else {
        const posted = Number((batch as { posted?: number } | null)?.posted ?? 0);
        const skipped = Number((batch as { skipped?: number } | null)?.skipped ?? 0);
        backfillNote =
          posted > 0 || skipped > 0
            ? [t("backfilled", { posted }), skipped ? t("backfillSkipped", { skipped }) : null]
                .filter(Boolean)
                .join(" ")
            : t("noBackfill");
      }
    }

    setLoading(false);
    applyLocaleCookie(locale);
    toast({ title: t("saved"), description: backfillNote.trim() || undefined });
    // Full reload so Amharic/English messages + Ethiopic font apply immediately
    window.location.reload();
  }

  if (!canManage) {
    return <p className="text-muted-foreground">{t("noPermission")}</p>;
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title={t("title")} description={t("languageHelp")} />

      <Panel title={t("subscription")}>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("subscriptionHelp")}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/billing">
            <CreditCard className="mr-1.5 h-4 w-4" />
            {t("billingPlan")}
          </Link>
        </Button>
      </Panel>

      <FormCard title={t("organization")}>
        <form onSubmit={handleSave} className="max-w-lg space-y-4">
          <div className="space-y-2"><Label>{t("businessName")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} /></div>
          <div className="space-y-2">
            <Label htmlFor="locale">{t("language")}</Label>
            <select
              id="locale"
              className={cn(SELECT_CLS, "h-10 max-w-xs")}
              value={locale}
              disabled={!isOwner}
              onChange={(e) => {
                const next = e.target.value as AppLocale;
                setLocale(next);
                applyLocaleCookie(next);
                void (async () => {
                  const supabase = createClient();
                  await supabase
                    .from("organizations")
                    .update({ default_locale: next })
                    .eq("id", organization.id);
                  window.location.reload();
                })();
              }}
            >
              <option value="en">{tCommon("english")}</option>
              <option value="am">{tCommon("amharic")}</option>
            </select>
            <p className="text-xs text-muted-foreground">{t("languageHelp")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">{t("currency")}</Label>
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
              {t("currencyHelp")}
            </p>
          </div>
          <div className="space-y-2"><Label>{t("taxRate")}</Label><Input type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} disabled={!isOwner} /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} disabled={!isOwner} className="rounded border-input" />
            {t("taxInclusive")}
          </label>
          <div className="space-y-2"><Label>{t("receiptPrefix")}</Label><Input value={receiptPrefix} onChange={(e) => setReceiptPrefix(e.target.value)} disabled={!isOwner} /></div>
          <div className="space-y-2"><Label>{t("receiptFooter")}</Label><Input value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} disabled={!isOwner} /></div>
          <div className="space-y-2">
            <Label htmlFor="pos-max-discount">{t("maxCashierDiscount")}</Label>
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
              {t("maxCashierDiscountHelp")}
            </p>
          </div>
          {isOwner && <Button type="submit" disabled={loading}>{loading ? tCommon("saving") : t("saveChanges")}</Button>}
        </form>
      </FormCard>

      <FormCard title={t("accountingControls")}>
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
              <span className="font-medium">{t("jeApproval")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t("jeApprovalHelp")}</span>
            </span>
          </label>
          {isOwner && (
            <Button type="submit" disabled={loading}>
              {loading ? tCommon("saving") : t("saveAccounting")}
            </Button>
          )}
        </form>
      </FormCard>

      <FormCard title={t("posOperations")}>
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
              <span className="font-medium">{t("autoPost")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t("autoPostHelp")}</span>
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
              <span className="font-medium">{t("mobilePending")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t("mobilePendingHelp")}</span>
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
              <span className="font-medium">{t("tipsEnable")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t("tipsHelp")}</span>
            </span>
          </label>
          {tipsEnabled && (
            <div className="space-y-2">
              <Label htmlFor="tip-presets">{t("tipPresets")}</Label>
              <Input
                id="tip-presets"
                value={tipPresetsInput}
                onChange={(e) => setTipPresetsInput(e.target.value)}
                disabled={!isOwner}
                placeholder="10, 15, 20"
              />
              <p className="text-xs text-muted-foreground">{t("tipPresetsHelp")}</p>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={loyaltyEnabled}
              onChange={(e) => setLoyaltyEnabled(e.target.checked)}
              disabled={!isOwner}
              className="mt-0.5 rounded border-input"
            />
            <span>
              <span className="font-medium">{t("loyalty")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t("loyaltyHelp")}</span>
            </span>
          </label>
          {loyaltyEnabled && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("pointsPer", { currency })}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={loyaltyPointsPer}
                  onChange={(e) => setLoyaltyPointsPer(e.target.value)}
                  disabled={!isOwner}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("valuePerPoint", { currency })}</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={loyaltySpendPerPoint}
                  onChange={(e) => setLoyaltySpendPerPoint(e.target.value)}
                  disabled={!isOwner}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("minRedeem")}</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={loyaltyMinRedeem}
                  onChange={(e) => setLoyaltyMinRedeem(e.target.value)}
                  disabled={!isOwner}
                />
              </div>
            </div>
          )}
          {isOwner && (
            <Button type="submit" disabled={loading}>
              {loading ? tCommon("saving") : t("savePos")}
            </Button>
          )}
        </form>
      </FormCard>
    </div>
  );
}
