import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { PromotionsClient } from "./promotions-client";

export default async function PromotionsPage() {
  const ctx = await requireAppAccess("promotions");
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_promotions", {
    p_organization_id: ctx.organization.id,
  });

  return (
    <PromotionsClient
      organizationId={ctx.organization.id}
      promotions={(data ?? []) as import("./promotions-client").PromotionRow[]}
      canManage={ctx.canManageApp("promotions")}
    />
  );
}
