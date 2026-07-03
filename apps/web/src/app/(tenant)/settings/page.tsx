import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { SettingsClient } from "./settings-client";

function parseTipPresets(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => Number(v)).filter((v) => Number.isFinite(v));
      }
    } catch {
      /* ignore */
    }
  }
  return [10, 15, 20];
}

export default async function SettingsPage() {
  const ctx = await requireAppAccess("settings");
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select(
      `id, name, currency, tax_rate, tax_inclusive, receipt_prefix, receipt_footer,
       address, tax_id, pos_max_cashier_discount_pct, pos_auto_post_sales,
       pos_mobile_pending_webhook, pos_tips_enabled, pos_tip_presets, je_requires_approval`
    )
    .eq("id", ctx.organization.id)
    .single();

  const organization = {
    id: org?.id ?? ctx.organization.id,
    name: org?.name ?? ctx.organization.name,
    currency: org?.currency ?? ctx.organization.currency,
    tax_rate: org?.tax_rate ?? ctx.organization.tax_rate,
    tax_inclusive: org?.tax_inclusive ?? ctx.organization.tax_inclusive,
    receipt_prefix: org?.receipt_prefix ?? ctx.organization.receipt_prefix,
    receipt_footer: org?.receipt_footer ?? ctx.organization.receipt_footer ?? null,
    address: org?.address ?? ctx.organization.address ?? null,
    tax_id: org?.tax_id ?? ctx.organization.tax_id ?? null,
    pos_max_cashier_discount_pct: org?.pos_max_cashier_discount_pct ?? 15,
    pos_auto_post_sales: org?.pos_auto_post_sales ?? false,
    pos_mobile_pending_webhook: org?.pos_mobile_pending_webhook ?? false,
    pos_tips_enabled: org?.pos_tips_enabled ?? false,
    pos_tip_presets: parseTipPresets(org?.pos_tip_presets),
    je_requires_approval: org?.je_requires_approval ?? false,
  };

  return (
    <SettingsClient
      organization={organization}
      canManage={ctx.canManageApp("settings")}
      isOwner={ctx.member.role === "owner"}
    />
  );
}
