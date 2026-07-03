"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import type { AdminUserSearchResult } from "@/lib/admin-types";

export function UsersClient({
  initialQuery = "",
  initialResults = [],
}: {
  initialQuery?: string;
  initialResults?: AdminUserSearchResult[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<AdminUserSearchResult[]>(initialResults);
  const [searched, setSearched] = useState(!!initialQuery);
  const [loading, setLoading] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_search_users", {
      p_query: q,
      p_limit: 50,
    });
    setLoading(false);
    if (!error) setResults((data as AdminUserSearchResult[]) ?? []);
    setSearched(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set("q", q);
    router.replace(`/admin/users?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex gap-2">
        <Input
          placeholder="Search by email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </form>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Email</DataTableHead>
            <DataTableHead>Orgs</DataTableHead>
            <DataTableHead>Last sign-in</DataTableHead>
            <DataTableHead>Joined</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {!searched ? (
              <DataTableEmpty colSpan={5} message="Enter an email to search users." />
            ) : results.length === 0 ? (
              <DataTableEmpty colSpan={5} message="No users matched your search." />
            ) : (
              results.map((u) => (
                <DataTableRow key={u.user_id}>
                  <DataTableCell>
                    <div className="font-medium">{u.email}</div>
                    {u.is_platform_admin && (
                      <span className="text-xs text-primary">Platform admin</span>
                    )}
                  </DataTableCell>
                  <DataTableCell>{u.org_count}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "Never"}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </DataTableCell>
                  <DataTableCell align="right">
                    <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                      <Link href={`/admin/users/${u.user_id}`}>Profile</Link>
                    </Button>
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
    </div>
  );
}
