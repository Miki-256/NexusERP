import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { SecurityEvent } from "@/lib/admin-types";
import { SecurityEventsClient } from "./security-events-client";

export default async function SecurityEventsPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_security_events", {
    p_limit: 200,
    p_offset: 0,
  });

  const payload = (data ?? { total: 0, rows: [] }) as {
    total: number;
    rows: SecurityEvent[];
  };

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Security events"
        description="Failed logins, account disables, and session revocations."
      />
      <SecurityEventsClient events={payload.rows ?? []} total={payload.total ?? 0} />
    </div>
  );
}
