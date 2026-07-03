import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { HelpdeskClient } from "./helpdesk-client";

export type TicketRow = {
  id: string;
  subject: string;
  description: string | null;
  customer_id: string | null;
  status: string;
  priority: string;
  created_at: string;
  customers: { name: string | null } | { name: string | null }[] | null;
};

export default async function HelpdeskPage() {
  const ctx = await requireAppAccess("helpdesk");

  const supabase = await createClient();
  const [{ data: tickets }, { data: customers }] = await Promise.all([
    supabase
      .from("helpdesk_tickets")
      .select("id, subject, description, customer_id, status, priority, created_at, customers(name)")
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("customers").select("id, name").eq("organization_id", ctx.organization.id).order("name"),
  ]);

  return (
    <HelpdeskClient
      organizationId={ctx.organization.id}
      tickets={(tickets as unknown as TicketRow[]) ?? []}
      customers={(customers as { id: string; name: string | null }[]) ?? []}
    />
  );
}
