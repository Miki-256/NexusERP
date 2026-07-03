import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/layout/status-badge";
import { SaleDetailClient } from "@/components/sales/sale-detail-client";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { SaleDetailBundle } from "@/lib/sales-register";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAppAccess("sales");

  const supabase = await createClient();
  const { data: bundleRaw, error } = await supabase.rpc("get_sale_detail_bundle", {
    p_sale_id: id,
  });

  if (error || !bundleRaw) notFound();

  const bundle = bundleRaw as SaleDetailBundle;
  const sale = bundle.sale;

  if ((sale.organization_id as string) !== ctx.organization.id) notFound();

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title={`Sale ${sale.receipt_no}`}
        description={new Date(sale.created_at).toLocaleString()}
        action={<StatusBadge status={sale.status} />}
      />
      <SaleDetailClient
        bundle={bundle}
        currency={ctx.organization.currency}
        orgName={ctx.organization.name}
        receiptFooter={ctx.organization.receipt_footer}
        canManage={ctx.canManageApp("sales")}
      />
    </div>
  );
}
