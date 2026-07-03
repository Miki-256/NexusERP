import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { ProductsClient } from "./products-client";

export type CategoryRow = {
  id: string;
  name: string;
  sort_order: number;
};

const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const ctx = await requireAppAccess("products");

  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const search = sp.q?.trim() || null;
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: pageData }, { data: categories }, { data: stores }] = await Promise.all([
    supabase.rpc("list_products_page", {
      p_org_id: orgId,
      p_limit: PAGE_SIZE,
      p_offset: offset,
      p_search: search,
    }),
    supabase
      .from("categories")
      .select("id, name, sort_order")
      .eq("organization_id", orgId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("stores")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_active", true),
  ]);

  const payload = (pageData ?? {}) as {
    rows?: unknown[];
    total?: number;
    category_counts?: Record<string, number>;
  };

  const productCountByCategory: Record<string, number> = {};
  for (const [key, count] of Object.entries(payload.category_counts ?? {})) {
    if (key === "__none__") continue;
    productCountByCategory[key] = Number(count);
  }

  return (
    <ProductsClient
      products={(payload.rows ?? []) as unknown as Parameters<typeof ProductsClient>[0]["products"]}
      categories={(categories as CategoryRow[]) ?? []}
      stores={stores ?? []}
      organizationId={orgId}
      currency={ctx.organization.currency}
      canManage={ctx.canManageApp("products")}
      total={Number(payload.total ?? 0)}
      page={page}
      pageSize={PAGE_SIZE}
      searchQuery={search ?? ""}
      productCountByCategory={productCountByCategory}
    />
  );
}
