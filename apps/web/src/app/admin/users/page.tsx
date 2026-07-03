import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { AdminUserSearchResult } from "@/lib/admin-types";
import { UsersClient } from "./users-client";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const initialQuery = params.q?.trim() ?? "";
  let initialResults: AdminUserSearchResult[] = [];

  if (initialQuery) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("admin_search_users", {
      p_query: initialQuery,
      p_limit: 50,
    });
    initialResults = (data as AdminUserSearchResult[]) ?? [];
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Users"
        description="Search all platform users by email and open profiles with org memberships."
      />
      <Suspense fallback={null}>
        <UsersClient initialQuery={initialQuery} initialResults={initialResults} />
      </Suspense>
    </div>
  );
}
