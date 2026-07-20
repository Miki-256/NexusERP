import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { PlatformAuditLog } from "@/lib/admin-types";
import { AuditLogClient } from "./audit-client";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; prefix?: string; since?: string; until?: string }>;
}) {
  const sp = await searchParams;
  const actor = sp.actor?.trim() || "";
  const prefix = sp.prefix?.trim() || "";
  const since = sp.since?.trim() || "";
  const until = sp.until?.trim() || "";

  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_platform_audit_logs", {
    p_limit: 200,
    p_offset: 0,
    p_actor_email: actor || null,
    p_action_prefix: prefix || null,
    p_since: since ? new Date(`${since}T00:00:00.000Z`).toISOString() : null,
    p_until: until ? new Date(`${until}T23:59:59.999Z`).toISOString() : null,
  });

  const payload = (data ?? { total: 0, rows: [] }) as {
    total: number;
    rows: PlatformAuditLog[];
  };

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Platform audit log"
        description="Every super-admin and support action is recorded here for security and compliance."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading filters…</p>}>
        <AuditLogClient
          logs={payload.rows ?? []}
          total={payload.total ?? 0}
          initialActor={actor}
          initialPrefix={prefix}
          initialSince={since}
          initialUntil={until}
        />
      </Suspense>
    </div>
  );
}
