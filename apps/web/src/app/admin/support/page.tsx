import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { TenantLookupResult } from "@/lib/admin-types";
import { SupportLookupClient } from "./support-client";

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const initialEmail = params.email?.trim() ?? "";

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Support lookup"
        description="Help desk tool — look up a customer by email and jump to their organizations."
      />
      <Suspense fallback={null}>
        <SupportLookupClient initialEmail={initialEmail} />
      </Suspense>
    </div>
  );
}
