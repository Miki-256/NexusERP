import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { CustomersClient } from "./customers-client";

export type ContactSummary = {
  customer_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  total_spent: number;
  order_count: number;
  last_order: string | null;
};

export type CustomerRecord = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  on_account_enabled: boolean;
  credit_limit: number | null;
};

const PAGE_SIZE = 50;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const ctx = await requireAppAccess("customers");

  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const search = sp.q?.trim() || null;
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const { data: pageData } = await supabase.rpc("list_customers_page", {
    p_org_id: orgId,
    p_limit: PAGE_SIZE,
    p_offset: offset,
    p_search: search,
  });

  const payload = (pageData ?? {}) as {
    rows?: Array<
      CustomerRecord & {
        total_spent?: number;
        order_count?: number;
        last_order?: string | null;
      }
    >;
    total?: number;
  };

  const rows = payload.rows ?? [];
  const customers: CustomerRecord[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    notes: r.notes,
    on_account_enabled: Boolean(r.on_account_enabled),
    credit_limit: r.credit_limit,
  }));

  const contacts: ContactSummary[] = rows.map((r) => ({
    customer_id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    total_spent: Number(r.total_spent ?? 0),
    order_count: Number(r.order_count ?? 0),
    last_order: r.last_order ?? null,
  }));

  return (
    <CustomersClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      contacts={contacts}
      customers={customers}
      total={payload.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      searchQuery={search ?? ""}
      canManageCreditTerms={ctx.canManageApp("customers")}
    />
  );
}
